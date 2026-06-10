import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";
import {
  computePF,
  computeESI,
  computeProfessionalTax,
  applyRounding,
  type OrgStatutoryOverrides,
} from "./compliance/india-statutory.service";
import { computeIncomeTax } from "./tax/india-tax.service";
import { TaxRegime } from "@emp-payroll/shared";
import {
  findUsersByOrgId,
  findOrgById,
  getEmpCloudDB,
  findEmployeeProfileByUserId,
} from "../db/empcloud";
import { findEffectiveExitsForUsers, isEmpExitEnabled } from "../db/empexit";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import * as cloudHRMS from "./cloud-hrms.service";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

// All EmpCloud tenants are India-based; payroll periods follow the
// IST calendar regardless of where the server runs. Hardcoded for now;
// when multi-region tenants land this should read from org settings.
const PAYROLL_TZ = "Asia/Kolkata";

/**
 * Lift the migration-029 columns off an `organization_payroll_settings`
 * row into the camelCase shape the statutory service expects. Centralised
 * so every call site (PF, ESI, future Form 16 / gratuity) reads from one
 * place and the snake_case ↔ camelCase mapping doesn't drift.
 */
function buildOrgStatutoryOverrides(orgSettings: any): OrgStatutoryOverrides {
  if (!orgSettings) return {};
  const num = (v: unknown): number | null =>
    v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;
  return {
    pfApplyFullBasic:
      orgSettings.pf_apply_full_basic == null ? null : !!Number(orgSettings.pf_apply_full_basic),
    pfMaxEmployeeContribution: num(orgSettings.pf_max_employee_contribution),
    pfDefaultEmployeeRate: num(orgSettings.pf_default_employee_rate),
    esiWageCeiling: num(orgSettings.esi_wage_ceiling),
    roundingPolicy: orgSettings.rounding_policy ?? null,
    employerPfInCtc:
      orgSettings.employer_pf_in_ctc == null ? null : !!Number(orgSettings.employer_pf_in_ctc),
    // Migration 034 — NOT NULL DEFAULT true; a null here (column absent on
    // an un-migrated row) also means "enabled" so charges keep applying.
    pfEdliEnabled:
      orgSettings.pf_edli_enabled == null ? true : !!Number(orgSettings.pf_edli_enabled),
    pfAdminEnabled:
      orgSettings.pf_admin_enabled == null ? true : !!Number(orgSettings.pf_admin_enabled),
  };
}

// #1655 — true if (year, month) is strictly *after* the current calendar
// month *in the payroll timezone*. The current month is always allowed
// (orgs run payroll mid-month). Server-local time is wrong here: a UTC
// server is up to ~5.5 hours behind IST, which would block the first
// hours of every IST month from creating the new month's run.
function isFuturePeriod(year: number, month: number): boolean {
  const now = dayjs().tz(PAYROLL_TZ);
  const requested = year * 12 + (month - 1);
  const current = now.year() * 12 + now.month();
  return requested > current;
}

// Normalise a date column (mysql2 returns Date for `date` cols, ISO string
// elsewhere) to a YYYY-MM-DD string for plain string comparison.
function toDateIso(v: string | Date | null | undefined): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.slice(0, 10);
  const d = v instanceof Date ? v : new Date(v as any);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Count the number of nights an employee worked under a night shift during
 * [startDate, endDate].
 *
 * Why this isn't a simple `attendance_records.shift_id` join: in practice
 * that column is almost always NULL — EmpCloud records which shift an
 * employee is on via `shift_assignments` (a date-ranged user→shift map),
 * not per attendance row. So we resolve each WORKED day's governing shift
 * from shift_assignments and check `is_night_shift`.
 *
 * Precedence per worked day:
 *   1. If the attendance row carries its own shift_id, that explicit
 *      per-day shift wins (HR stamped it deliberately).
 *   2. Otherwise the governing shift_assignment for that date — the one
 *      with the latest effective_from whose [effective_from, effective_to]
 *      window contains the date (effective_to NULL = open-ended). "Latest
 *      effective_from wins" handles employees reassigned mid-period and
 *      the messy overlapping/back-dated rows seen in real data.
 *
 * Only days actually worked count (present / checked_in = 1 night, the two
 * half-day statuses = 0.5). on_leave / absent never count — no night was
 * worked even if the employee is nominally on a night shift.
 */
async function resolveNightShiftDays(
  empcloudDb: any,
  userId: number,
  orgId: number,
  startDate: string,
  endDate: string,
): Promise<number> {
  const workedDays = (await empcloudDb("attendance_records as ar")
    .leftJoin("shifts as s", "s.id", "ar.shift_id")
    .where("ar.user_id", userId)
    .where("ar.organization_id", orgId)
    .whereBetween("ar.date", [startDate, endDate])
    .whereIn("ar.status", ["present", "checked_in", "half_day", "half_present_half_leave"])
    .select(
      "ar.date as date",
      "ar.status as status",
      "ar.shift_id as shift_id",
      "s.is_night_shift as att_shift_is_night",
    )) as Array<{
    date: string | Date;
    status: string;
    shift_id: number | null;
    att_shift_is_night: number | null;
  }>;
  if (!workedDays.length) return 0;

  const assignments = (await empcloudDb("shift_assignments as sa")
    .join("shifts as s", "s.id", "sa.shift_id")
    .where("sa.user_id", userId)
    .where("sa.organization_id", orgId)
    .where("sa.effective_from", "<=", endDate)
    .where((b: any) => b.whereNull("sa.effective_to").orWhere("sa.effective_to", ">=", startDate))
    .select(
      "sa.id as id",
      "sa.effective_from as effective_from",
      "sa.effective_to as effective_to",
      "sa.created_at as created_at",
      "s.is_night_shift as is_night_shift",
    )) as Array<{
    id: number;
    effective_from: string | Date;
    effective_to: string | Date | null;
    created_at: string | Date | null;
    is_night_shift: number;
  }>;

  // Pre-normalise assignment windows once. `order` is the recency key used
  // to pick the governing assignment when several overlap a date: the most
  // recently CREATED assignment wins (created_at, then id as a monotonic
  // tiebreaker). We deliberately do NOT order by effective_from -- when HR
  // re-assigns an employee's shift for a period that already had an
  // assignment, the newer decision must supersede the older one even if
  // the older one happens to have a later effective_from. (Real case: an
  // employee on Night for Apr 26–May 10, later reassigned to General for
  // all of April; the General reassignment is the operative one.)
  const norm = assignments
    .map((a) => ({
      from: toDateIso(a.effective_from),
      to: toDateIso(a.effective_to),
      isNight: !!Number(a.is_night_shift),
      order: (() => {
        const t = a.created_at ? new Date(a.created_at as any).getTime() : 0;
        return Number.isFinite(t) ? t : 0;
      })(),
      id: Number(a.id) || 0,
    }))
    .filter(
      (a): a is { from: string; to: string | null; isNight: boolean; order: number; id: number } =>
        !!a.from,
    );

  let nights = 0;
  for (const d of workedDays) {
    const dateIso = toDateIso(d.date);
    if (!dateIso) continue;
    const weight = d.status === "half_day" || d.status === "half_present_half_leave" ? 0.5 : 1;

    let isNight: boolean;
    if (d.shift_id != null) {
      // Explicit per-day shift on the attendance row wins.
      isNight = !!Number(d.att_shift_is_night);
    } else {
      // Governing assignment = the most recently created one covering the
      // date (created_at desc, id desc as tiebreaker).
      const covering = norm
        .filter((a) => a.from <= dateIso && (a.to === null || a.to >= dateIso))
        .sort((a, b) => (b.order !== a.order ? b.order - a.order : b.id - a.id));
      isNight = covering.length ? covering[0].isNight : false;
    }
    if (isNight) nights += weight;
  }
  return nights;
}

/**
 * Count "overtime days" an employee worked in [startDate, endDate] — days
 * they were present on a week-off or a holiday. This mirrors the Attendance
 * Grid, which auto-shows WOT/HOT for a full present day on a rest day, so
 * the payslip and the grid agree without HR marking anything by hand.
 *
 * A day counts as 1 OT day when EITHER:
 *   - its attendance status is the explicit `weekoff_overtime` /
 *     `holiday_overtime` (HR set it directly), OR
 *   - the employee was present / checked_in AND that date is a holiday
 *     (company_events event_type='holiday', or legacy organization_holidays)
 *     OR a week-off for their governing shift assignment.
 *
 * Holiday/week-off overlap is counted once. Week-off is resolved from the
 * most-recently-created shift assignment covering the date (same rule the
 * grid + night-shift resolver use).
 */
async function resolveOvertimeDays(
  empcloudDb: any,
  userId: number,
  orgId: number,
  startDate: string,
  endDate: string,
): Promise<number> {
  const worked = (await empcloudDb("attendance_records")
    .where("user_id", userId)
    .where("organization_id", orgId)
    .whereBetween("date", [startDate, endDate])
    .whereIn("status", ["present", "checked_in", "weekoff_overtime", "holiday_overtime"])
    .select("date as date", "status as status")) as Array<{ date: string | Date; status: string }>;
  if (!worked.length) return 0;

  // Holiday set for the window — ONLY mandatory holidays trigger auto-OT.
  // Optional / restricted holidays (Bakrid, Onam, Holi in many orgs) are
  // days the office stays open: an employee who chooses to come gets
  // regular pay, not OT. Symmetric with resolveCalendarLop, which also
  // treats optional holidays as normal working days when the employee has
  // an attendance status (the same `is_mandatory = 1` filter is used
  // there). HR can still grant OT on an optional holiday by explicitly
  // setting the status to `holiday_overtime` — that's honoured above.
  const holidaySet = new Set<string>();
  const addRange = (startIso: string | null, endIso: string | null) => {
    if (!startIso) return;
    let cur = startIso < startDate ? startDate : startIso;
    const last = (endIso ?? startIso) > endDate ? endDate : (endIso ?? startIso);
    while (cur <= last) {
      holidaySet.add(cur);
      const d = new Date(cur + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 1);
      cur = d.toISOString().split("T")[0];
    }
  };
  try {
    const events = (await empcloudDb("company_events")
      .where({ organization_id: orgId, event_type: "holiday", is_mandatory: 1 })
      .where("start_date", "<=", `${endDate} 23:59:59`)
      .andWhere((b: any) =>
        b.where("end_date", ">=", `${startDate} 00:00:00`).orWhereNull("end_date"),
      )
      .select("start_date as start_date", "end_date as end_date")) as Array<{
      start_date: any;
      end_date: any;
    }>;
    for (const e of events) addRange(toDateIso(e.start_date), toDateIso(e.end_date));
  } catch {
    /* table absent — ignore */
  }
  try {
    const legacy = (await empcloudDb("organization_holidays")
      .where("organization_id", orgId)
      .whereBetween("holiday_date", [startDate, endDate])
      .select("holiday_date as holiday_date")) as Array<{ holiday_date: any }>;
    for (const h of legacy) {
      const iso = toDateIso(h.holiday_date);
      if (iso) holidaySet.add(iso);
    }
  } catch {
    /* table absent — ignore */
  }

  // Shift assignments overlapping the window, for week-off determination.
  const assignments = (await empcloudDb("shift_assignments as sa")
    .join("shifts as s", "s.id", "sa.shift_id")
    .where("sa.user_id", userId)
    .where("sa.organization_id", orgId)
    .where("sa.effective_from", "<=", endDate)
    .where((b: any) => b.whereNull("sa.effective_to").orWhere("sa.effective_to", ">=", startDate))
    .select(
      "sa.id as id",
      "sa.effective_from as effective_from",
      "sa.effective_to as effective_to",
      "sa.created_at as created_at",
      "s.working_days as working_days",
      "s.is_weekoff as is_weekoff",
    )) as Array<{
    id: number;
    effective_from: string | Date;
    effective_to: string | Date | null;
    created_at: string | Date | null;
    working_days: string | null;
    is_weekoff: number;
  }>;
  const norm = assignments
    .map((a) => ({
      from: toDateIso(a.effective_from),
      to: toDateIso(a.effective_to),
      order: a.created_at ? new Date(a.created_at as any).getTime() || 0 : 0,
      id: Number(a.id) || 0,
      isWeekoffShift: !!Number(a.is_weekoff),
      // working_days CSV uses getDay() numbering (0=Sun … 6=Sat), same as
      // the EmpCloud grid. Empty list = no working-day restriction.
      workingDays: String(a.working_days || "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n)),
    }))
    .filter((a): a is typeof a & { from: string } => !!a.from);

  let otDays = 0;
  for (const w of worked) {
    const dateIso = toDateIso(w.date);
    if (!dateIso) continue;
    const status = (w.status || "").toLowerCase();
    if (status === "weekoff_overtime" || status === "holiday_overtime") {
      otDays += 1;
      continue;
    }
    // present / checked_in → OT only if the day is a holiday or week-off.
    if (holidaySet.has(dateIso)) {
      otDays += 1;
      continue;
    }
    const covering = norm
      .filter((a) => a.from <= dateIso && (a.to === null || a.to >= dateIso))
      .sort((a, b) => (b.order !== a.order ? b.order - a.order : b.id - a.id));
    const gov = covering[0];
    if (gov) {
      const dow = new Date(dateIso + "T00:00:00Z").getUTCDay();
      const isWeekoff =
        gov.isWeekoffShift || (gov.workingDays.length > 0 && !gov.workingDays.includes(dow));
      if (isWeekoff) otDays += 1;
    }
  }
  return otDays;
}

/**
 * Per-employee LOP (loss-of-pay) days in [startDate, endDate] under the
 * FULL-CALENDAR-MONTH basis. Every day of the month is paid by default; this
 * returns ONLY the genuine unpaid absences that should reduce pay:
 *
 *   - Weekends / shift week-offs           → paid rest, never LOP.
 *   - Holidays                             → paid, never LOP.
 *   - present / checked_in / WOT / HOT     → paid.
 *   - half_day                             → 0.5 LOP (the unworked half).
 *   - half_present_half_leave              → paid, unless the covering leave is unpaid (0.5).
 *   - on_leave / approved leave            → paid if the leave type is paid, else LOP.
 *   - absent OR no record on a working day → LOP (unless a PAID leave covers it).
 *   - days today-or-later                  → NOT charged — an in-progress month
 *                                            runs whole; future days are assumed worked.
 *
 * "Working day" is resolved from the employee's shift (`working_days`, getDay()
 * numbering 0=Sun…6=Sat) exactly like the Attendance Grid / resolveOvertimeDays;
 * days with no covering assignment fall back to Mon–Fri. The governing
 * assignment is the most-recently-created one covering the date, so the grid,
 * the overtime resolver and this never disagree about which days are rest days.
 */
async function resolveCalendarLop(
  empcloudDb: any,
  userId: number,
  orgId: number,
  startDate: string,
  endDate: string,
  holidaySet: Set<string>,
  todayIso: string,
  optionalHolidaySet: Set<string> = new Set<string>(),
): Promise<number> {
  // Per-day attendance status.
  const attRows = (await empcloudDb("attendance_records")
    .where("user_id", userId)
    .where("organization_id", orgId)
    .whereBetween("date", [startDate, endDate])
    .select("date as date", "status as status")) as Array<{ date: any; status: string }>;
  const statusByDate: Record<string, string> = {};
  for (const r of attRows) {
    const iso = toDateIso(r.date);
    if (iso) statusByDate[iso] = String(r.status || "").toLowerCase();
  }

  // Per-day leave coverage (paid/unpaid), expanded from approved applications.
  // A PAID leave wins over an unpaid one when ranges overlap a date.
  const leaveByDate: Record<string, { paid: boolean }> = {};
  const leaveApps = (await empcloudDb("leave_applications as la")
    .join("leave_types as lt", "la.leave_type_id", "lt.id")
    .where("la.user_id", userId)
    .where("la.organization_id", orgId)
    .where("la.status", "approved")
    .where("la.start_date", "<=", endDate)
    .where("la.end_date", ">=", startDate)
    .select(
      "la.start_date as start_date",
      "la.end_date as end_date",
      "lt.is_paid as is_paid",
    )) as Array<{ start_date: any; end_date: any; is_paid: number }>;
  for (const l of leaveApps) {
    const s = toDateIso(l.start_date);
    if (!s) continue;
    const e = toDateIso(l.end_date) ?? s;
    const paid = !!Number(l.is_paid);
    let cur = s < startDate ? startDate : s;
    const last = e > endDate ? endDate : e;
    while (cur <= last) {
      if (leaveByDate[cur] === undefined || paid) leaveByDate[cur] = { paid };
      const d = new Date(cur + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 1);
      cur = d.toISOString().split("T")[0];
    }
  }

  // Shift assignments → week-off determination (same rule as grid / overtime).
  const assignments = (await empcloudDb("shift_assignments as sa")
    .join("shifts as s", "s.id", "sa.shift_id")
    .where("sa.user_id", userId)
    .where("sa.organization_id", orgId)
    .where("sa.effective_from", "<=", endDate)
    .where((b: any) => b.whereNull("sa.effective_to").orWhere("sa.effective_to", ">=", startDate))
    .select(
      "sa.id as id",
      "sa.effective_from as effective_from",
      "sa.effective_to as effective_to",
      "sa.created_at as created_at",
      "s.working_days as working_days",
      "s.is_weekoff as is_weekoff",
    )) as Array<{
    id: number;
    effective_from: string | Date;
    effective_to: string | Date | null;
    created_at: string | Date | null;
    working_days: string | null;
    is_weekoff: number;
  }>;
  const norm = assignments
    .map((a) => ({
      from: toDateIso(a.effective_from),
      to: toDateIso(a.effective_to),
      order: a.created_at ? new Date(a.created_at as any).getTime() || 0 : 0,
      id: Number(a.id) || 0,
      isWeekoffShift: !!Number(a.is_weekoff),
      workingDays: String(a.working_days || "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n)),
    }))
    .filter((a): a is typeof a & { from: string } => !!a.from);

  let lop = 0;
  let cur = startDate;
  while (cur <= endDate) {
    // Future / today: dates only increase, so once we reach today we're done —
    // the rest of the month is assumed worked and never charged.
    if (cur >= todayIso) break;
    // Holiday → paid, not a working day. Two flavours:
    //   1. MANDATORY (holidaySet)  → office closed, always paid, skip entirely.
    //   2. OPTIONAL (optionalHolidaySet) → office stays open; treatment depends
    //      on whether the employee has an attendance row for the date:
    //        • no attendance status at all → employee was eligible to take it
    //          off, treat as paid holiday (same as mandatory). Auto-treated
    //          as a paid optional leave.
    //        • any explicit status (P / H / HPL / Absent / OnLeave) → fall
    //          through to normal LOP logic so e.g. a half_day on Bakrid still
    //          costs the right 0.5 LOP, and an employee who came to work
    //          gets full pay.
    //    Without this nuance Shaik (no record on Bakrid) was wrongly docked
    //    1 LOP and Aman (half_day on Bakrid) was wrongly given 0 LOP. Now both
    //    cases produce the correct result.
    const statusForDate = statusByDate[cur];
    if (optionalHolidaySet.has(cur) && !statusForDate) {
      // Optional + no record → paid, no LOP.
      const d = new Date(cur + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 1);
      cur = d.toISOString().split("T")[0];
      continue;
    }
    if (!holidaySet.has(cur)) {
      const dow = new Date(cur + "T00:00:00Z").getUTCDay();
      const covering = norm
        .filter((a) => a.from <= cur && (a.to === null || a.to >= cur))
        .sort((a, b) => (b.order !== a.order ? b.order - a.order : b.id - a.id));
      const gov = covering[0];
      const isRest = gov
        ? gov.isWeekoffShift || (gov.workingDays.length > 0 && !gov.workingDays.includes(dow))
        : dow === 0 || dow === 6;
      const status = statusByDate[cur];
      const lv = leaveByDate[cur];
      // Whether this day should contribute to LOP at all:
      //   - elapsed working day  → always evaluated
      //   - weekoff / rest day   → ONLY if HR explicitly marked it 'absent'
      //                            on the Attendance Grid. That's the
      //                            sandwich-leave override (Sat/Sun
      //                            between two LOP weekdays); HR sets the
      //                            cell to A on purpose and payroll must
      //                            honour it. Default rest days remain
      //                            paid as before.
      if (!isRest || status === "absent") {
        if (
          status === "present" ||
          status === "checked_in" ||
          status === "weekoff_overtime" ||
          status === "holiday_overtime"
        ) {
          /* fully worked → paid */
        } else if (status === "half_day") {
          lop += 0.5; // worked half; the other half is unpaid
        } else if (status === "half_present_half_leave") {
          if (lv && !lv.paid) lop += 0.5; // the leave half is unpaid
        } else if (status === "on_leave") {
          if (lv && !lv.paid) lop += 1; // explicit unpaid leave; otherwise paid
        } else {
          // 'absent' (including HR-overridden weekoff) or no record at
          // all on a past working day.
          if (!(lv && lv.paid)) lop += 1; // a paid leave would cover it; else LOP
        }
      }
    }
    const d = new Date(cur + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    cur = d.toISOString().split("T")[0];
  }
  return lop;
}

export class PayrollService {
  private db = getDB();

  async listRuns(orgId: string) {
    // Sort by payroll period (year, month) rather than `created_at` so the
    // list reads as a chronological timeline of pay months. Sorting on
    // created_at meant a back-dated catch-up run would land at the top of
    // the list out of period order — QA reported an order of
    // Feb, Mar, Jan, May, Dec, ... (#6).
    //
    // The adapter only supports a single sort field, so we fetch and sort
    // here. The list is bounded (one row per pay period per org), so the
    // in-memory sort is fine.
    const result = await this.db.findMany<any>("payroll_runs", {
      filters: { empcloud_org_id: Number(orgId) },
      sort: { field: "year", order: "desc" },
      limit: 1000,
    });
    if (Array.isArray(result?.data)) {
      result.data.sort((a: any, b: any) => {
        const ya = Number(a.year) || 0;
        const yb = Number(b.year) || 0;
        if (yb !== ya) return yb - ya;
        const ma = Number(a.month) || 0;
        const mb = Number(b.month) || 0;
        return mb - ma;
      });
    }
    return result;
  }

  async getRun(id: string, orgId: string) {
    const run = await this.db.findOne<any>("payroll_runs", { id, empcloud_org_id: Number(orgId) });
    if (!run) throw new AppError(404, "NOT_FOUND", "Payroll run not found");
    return run;
  }

  async createRun(
    orgId: string,
    userId: string,
    data: { month: number; year: number; payDate?: string; notes?: string },
  ) {
    // #1655 — Reject future periods. The validator already does this for
    // calls coming through the route, but the service guard catches any
    // direct invocation (e.g. seed scripts, future migrations) so the
    // rule is enforced exactly once and at the layer that owns the data.
    if (isFuturePeriod(data.year, data.month)) {
      throw new AppError(
        400,
        "FUTURE_PERIOD",
        `Cannot create a payroll run for ${data.month}/${data.year} — period has not started yet`,
      );
    }

    const existing = await this.db.findOne<any>("payroll_runs", {
      empcloud_org_id: Number(orgId),
      month: data.month,
      year: data.year,
    });
    if (existing)
      throw new AppError(
        409,
        "DUPLICATE_RUN",
        `Payroll for ${data.month}/${data.year} already exists`,
      );

    // Auto-calculate pay date from org settings if not provided
    let payDate = data.payDate;
    if (!payDate) {
      const orgSettings = await this.db.findOne<any>("organization_payroll_settings", {
        empcloud_org_id: Number(orgId),
      });
      const payDay = orgSettings?.pay_day ?? 7;
      // Clamp pay day to valid range for the given month
      const maxDay = new Date(data.year, data.month, 0).getDate();
      const day = Math.min(payDay, maxDay);
      payDate = dayjs(
        `${data.year}-${String(data.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      ).format("YYYY-MM-DD");
    }

    const monthNames = [
      "",
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    return this.db.create("payroll_runs", {
      org_id: "00000000-0000-0000-0000-000000000000",
      empcloud_org_id: Number(orgId),
      name: `${monthNames[data.month]} ${data.year} Payroll`,
      month: data.month,
      year: data.year,
      pay_date: payDate,
      status: "draft",
      processed_by: userId,
      notes: data.notes || null,
    });
  }

  async computePayroll(runId: string, orgId: string, authToken?: string) {
    const run = await this.getRun(runId, orgId);
    if (run.status !== "draft") {
      throw new AppError(400, "INVALID_STATUS", "Only draft payroll runs can be computed");
    }

    // Make compute idempotent. A previous failed compute (or a /rerun
    // that found the run already in draft and short-circuited the
    // payslip delete) can leave orphan payslip rows. The next compute
    // then trips the (payroll_run_id, empcloud_user_id) UNIQUE index
    // on the very first employee already present, taking the entire
    // run down with it. Wipe before we begin so /compute is always
    // safe to retry.
    await this.db.deleteMany("payslips", { payroll_run_id: runId });

    // Get org payroll settings for state info
    const orgSettings = await this.db.findOne<any>("organization_payroll_settings", {
      empcloud_org_id: Number(orgId),
    });

    // Get employees who worked at any point during this pay period from
    // EmpCloud. Passing `periodStart` widens the fetch to include people
    // emp-exit has flipped to inactive but whose last working day is on or
    // after the period start — the existing `doe < monthStart` guard below
    // then correctly skips anyone whose exit was genuinely before the period.
    // Without this, an employee marked-exited with a future last-day was
    // dropped from the run entirely (no final-month payslip).
    const monthStartIso = `${run.year}-${String(run.month).padStart(2, "0")}-01`;
    const ecEmployees = await findUsersByOrgId(Number(orgId), {
      limit: 1000,
      periodStart: monthStartIso,
    });

    // Payroll basis: FULL CALENDAR MONTH. The denominator is every day of the
    // month (`daysInMonth`); weekends, shift week-offs, holidays and PAID leave
    // are all paid, and only genuine unpaid working-day absences reduce pay
    // (computed per-employee by resolveCalendarLop). This replaces the old
    // org-wide working-days base + the `include_weekends` auto-credit, which
    // could mask real absences behind weekend/holiday padding (BUG-024/025 and
    // Migration-035 weekend handling are subsumed by the calendar basis).
    const daysInMonth = new Date(run.year, run.month, 0).getDate();
    const empcloudDb = getEmpCloudDB();
    const monthStart = `${run.year}-${String(run.month).padStart(2, "0")}-01`;
    // TZ-safe month end. `new Date(...).toISOString()` shifts "April 30"
    // to "2026-04-29" on any UTC+ server, which silently dropped the last
    // calendar day from the attendance/holiday window — an employee
    // present on the 30th came out one day short. `getDate()` is a local
    // getter, so build the string from it instead.
    const monthEnd = `${run.year}-${String(run.month).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
    // "Today" for the calendar-day basis. An in-progress month runs WHOLE —
    // days that have not yet elapsed are assumed worked and are never charged
    // as LOP. For a fully-past month every day is < todayIso, so the whole
    // month is evaluated. (payroll basis: full calendar month)
    const todayIso = dayjs().format("YYYY-MM-DD");
    // Holiday set for the working-days base: `company_events`
    // (event_type='holiday', multi-day ranges expanded) UNION the legacy
    // `organization_holidays` table. Previously only the legacy table was
    // read here, but live tenants configure holidays on the EmpCloud
    // Holidays page, which writes to `company_events` — so a public holiday
    // never reduced the payroll working-days base and EVERY employee took an
    // LOP day for it. This now matches the Attendance Grid and the overtime
    // path, both of which already union the two sources. (BUG-026 / holiday F1)
    //
    // Dedup on a YYYY-MM-DD string (local getters, never toISOString — that
    // shifts the day on UTC+ servers) so the same date counted in both
    // sources is only subtracted once.
    // Two separate holiday sets:
    //   holidaySeen           — MANDATORY holidays + legacy organization_holidays
    //                           rows. Always paid; engine skips LOP on these
    //                           dates regardless of attendance.
    //   optionalHolidaySeen   — OPTIONAL / restricted holidays (Bakrid, Onam,
    //                           Holi in many orgs). Treatment depends on
    //                           whether the employee has an attendance row:
    //                             • No record at all → treat as paid holiday
    //                               (employee was eligible to take it off).
    //                             • Has any status (P/H/HPL/Absent/OnLeave) →
    //                               apply that status normally (so a half_day
    //                               on Bakrid correctly costs 0.5 LOP, and an
    //                               employee who came in gets full pay).
    // The Attendance Grid already keeps this distinction via
    // company_events.is_mandatory; the engine now mirrors it the same way.
    const holidaySeen = new Set<string>();
    const optionalHolidaySeen = new Set<string>();
    const addHolidayRange = (set: Set<string>, startIso: string | null, endIso: string | null) => {
      if (!startIso) return;
      let cur = startIso < monthStart ? monthStart : startIso;
      const last = (endIso ?? startIso) > monthEnd ? monthEnd : (endIso ?? startIso);
      while (cur <= last) {
        set.add(cur);
        const dt = new Date(cur + "T00:00:00Z");
        dt.setUTCDate(dt.getUTCDate() + 1);
        cur = dt.toISOString().split("T")[0];
      }
    };
    try {
      const events = (await empcloudDb("company_events")
        .where({ organization_id: Number(orgId), event_type: "holiday" })
        .where("start_date", "<=", `${monthEnd} 23:59:59`)
        .andWhere((b: any) =>
          b.where("end_date", ">=", `${monthStart} 00:00:00`).orWhereNull("end_date"),
        )
        .select("start_date", "end_date", "is_mandatory")) as Array<{
        start_date: any;
        end_date: any;
        is_mandatory: number;
      }>;
      for (const e of events) {
        const set = Number(e.is_mandatory) === 1 ? holidaySeen : optionalHolidaySeen;
        addHolidayRange(set, toDateIso(e.start_date), toDateIso(e.end_date));
      }
    } catch {
      /* company_events table absent (older schema) — ignore */
    }
    // Legacy organization_holidays has no is_mandatory column; treat its rows
    // as mandatory to preserve pre-existing behaviour for older tenants.
    const orgHolidaysRows = await empcloudDb("organization_holidays")
      .where("organization_id", Number(orgId))
      .whereBetween("holiday_date", [monthStart, monthEnd])
      .select("holiday_date");
    for (const h of orgHolidaysRows) {
      const iso = toDateIso(h.holiday_date);
      if (iso) holidaySeen.add(iso);
    }

    let totalGross = 0;
    let totalDeductions = 0;
    let totalNet = 0;
    let totalEmployerContributions = 0;
    let employeeCount = 0;
    // #268 — Track employees skipped because their salary structure has no
    // earning components (or zero monthly amounts). Without this guard the
    // engine generated payslips with gross=0 but deductions still applied
    // (PF/ESI/TDS computed off `salary.gross_salary` rather than the empty
    // components), producing huge negative net pay. Skip the row, surface
    // the failure in the run summary so the admin can fix the structure.
    const skipped: Array<{
      empcloudUserId: number;
      // Display name + emp code so the run-detail "skipped" banner can show
      // "Aayush Gupta (EMP057)" instead of a bare "employee #57" — HR reads
      // names, not internal IDs.
      name: string;
      empCode: string | null;
      reason: string;
      code: string;
    }> = [];
    // BUG-008 — PAN-missing soft warning. Track employees whose TDS was
    // computed under Section 206AA (flat 20% because PAN was missing on
    // both payroll-side `tax_info.pan` AND EmpCloud-side
    // `employee_profiles.pan_number`). Surfaced in the run summary so HR
    // can chase those employees for their PAN before approving the run.
    // We do NOT block compute -- the legal compliance default is to
    // withhold at 20% when PAN is missing, so the calculation is correct
    // even though over-withheld.
    const missingPan: Array<{ empcloudUserId: number; name: string; code: string }> = [];

    // ─── Exit-date truth pull (one query, the whole org) ─────────────────
    // empcloud.users.date_of_exit is populated by a webhook from emp-exit
    // that historically fell back to today() when the payload was missing
    // the date. The authoritative source is the emp-exit module's own
    // `exit_requests.last_working_date`. Override here so the join/exit
    // skip checks below and the mid-month pro-ration clip downstream see
    // the right value. Falls back to empcloud's date_of_exit when the
    // integration is disabled / unreachable.
    const userIds = ecEmployees.map((e: any) => Number(e.id)).filter((n: number) => n > 0);
    const exitByUserId = await findEffectiveExitsForUsers(userIds);

    for (const ecEmp of ecEmployees) {
      // Reset per-employee employer contributions each iteration
      let employeeEmployerContributions = 0;

      // BUG-019 — Status sync. Skip employees whose join/exit dates put
      // them outside this run's pay period. Without these guards an
      // employee who joined in May still got a payslip for the April
      // run, and an employee terminated in February still got payslips
      // for March, April, May... because findUsersByOrgId only filters
      // on `users.status` and HR commonly forgets to flip that flag.
      // Note: a *partial* month (joined mid-month / exited mid-month)
      // still generates a payslip; pro-ration via `paidDays` handles
      // that downstream once attendance reflects the partial period.
      const ecAny = ecEmp as any;
      // Friendly identifier for the skipped[] / missingPan[] banners — HR
      // reads names, not numeric IDs. Falls back to the emp code, then the
      // bare "#id", when the EmpCloud name fields are blank.
      const ecName =
        `${ecAny.first_name || ""} ${ecAny.last_name || ""}`.trim() ||
        ecAny.emp_code ||
        `#${ecEmp.id}`;
      // Knex returns DATE columns as JS Date objects, not strings. We
      // need an ISO YYYY-MM-DD slice for lexicographic comparison
      // against monthStart / monthEnd. The previous `String(dateObj)`
      // produced "Wed Jan 15 2025 ..." which sorts AFTER any
      // "2026-XX-XX" string, so every employee was wrongly skipped as
      // "joined after the pay period" and the run finished with 0
      // payslips.
      const isoDate = (v: unknown): string | null => {
        if (!v) return null;
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        const s = String(v);
        // Already an ISO-ish string like "2025-01-15" or
        // "2025-01-15T00:00:00.000Z" -- safe to slice the head.
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        const d = new Date(s);
        return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
      };
      const doj = isoDate(ecAny.date_of_joining);
      // Prefer emp-exit's last_working_date over empcloud.users.date_of_exit.
      // When emp-exit has an authoritative record for this user we use that;
      // otherwise we fall back to the EmpCloud column (legacy path / when the
      // emp-exit integration is disabled or the user has no exit record at
      // all — both should be treated as "still employed").
      const ecDoe = isoDate(ecAny.date_of_exit);
      const exitRec = exitByUserId.get(Number(ecEmp.id));
      const doe = exitRec?.lastWorkingDate ?? ecDoe;
      if (doj && doj > monthEnd) {
        skipped.push({
          empcloudUserId: ecEmp.id,
          name: ecName,
          empCode: ecAny.emp_code || null,
          code: "JOINED_AFTER_PERIOD",
          reason: `Joined ${doj} — after the pay period (${monthStart} → ${monthEnd})`,
        });
        continue;
      }
      if (doe && doe < monthStart) {
        skipped.push({
          empcloudUserId: ecEmp.id,
          name: ecName,
          empCode: ecAny.emp_code || null,
          code: "EXITED_BEFORE_PERIOD",
          reason: `Exited ${doe} — before the pay period (${monthStart} → ${monthEnd})`,
        });
        continue;
      }

      // Mid-month exit clip. When the employee's last working day falls
      // INSIDE the pay period (e.g. exits on 20 May for a May run), the
      // engine must cap paid_days at (doe - monthStart + 1). Without this
      // we treat them like a full-month employee and over-pay — the bug
      // that caused Santhosh's May payslip to be ₹8.1L instead of ~₹5.2L.
      // The actual clip happens further down once `paidDays` is computed
      // from the attendance source. We just capture the cap here.
      let exitPaidUpperBound: number | null = null;
      if (doe && doe >= monthStart && doe <= monthEnd) {
        const msPerDay = 86400000;
        // Half-open day count works because both strings are YYYY-MM-DD
        // at UTC 00:00; floor handles any DST drift defensively.
        const dayCount =
          Math.floor(
            (Date.parse(doe + "T00:00:00Z") - Date.parse(monthStart + "T00:00:00Z")) / msPerDay,
          ) + 1;
        exitPaidUpperBound = Math.max(0, dayCount);
      }

      // Get payroll profile for this employee
      const profile = await this.db.findOne<any>("employee_payroll_profiles", {
        empcloud_user_id: ecEmp.id,
      });

      const salary = await this.db.findOne<any>("employee_salaries", {
        empcloud_user_id: ecEmp.id,
        is_active: true,
      });
      if (!salary) {
        // Surface the silent skip so HR sees why N-X employees in the
        // org didn't appear in the run. Previously this was a bare
        // `continue` and HR had no signal -- the most common reason a
        // run produces fewer payslips than active headcount.
        skipped.push({
          empcloudUserId: ecEmp.id,
          name: ecName,
          empCode: ecAny.emp_code || null,
          code: "NO_SALARY_ASSIGNED",
          reason: "No active salary structure assigned",
        });
        continue;
      }

      // (daysInMonth + the holiday date-set `holidaySeen` are hoisted above
      //  this loop and shared by every employee.)

      // Resolve attendance for the period.
      //
      // Two data sources can carry the truth:
      //   1. payroll DB → `attendance_summaries`   (populated by Mark All
      //      Present / CSV import / manual entry on the Attendance page)
      //   2. EmpCloud DB → `attendance_records` + `leave_applications`
      //      (live punches and approved leaves from HRMS)
      //
      // Previously this code only read source #2, which is why clicking
      // Mark All Present on the payroll Attendance page made the page show
      // "22 days" but the payroll run still skipped every employee --
      // computePayroll was looking at a different table in a different DB.
      //
      // Prefer the payroll-side summary when present (it's the explicit
      // override -- HR clicked Mark All Present specifically because the
      // EmpCloud data was incomplete). Fall back to the live EmpCloud
      // counts otherwise so attendance flows through automatically for
      // orgs that don't manually import.
      // empcloudDb / monthStart / monthEnd are hoisted above the loop so the
      // holiday and per-employee attendance lookups share the same instance.
      const startDate = monthStart;
      const endDate = monthEnd;

      // Per-employee attendance lookup.
      //
      // Source-of-truth order (EmpCloud-first):
      //   1. EmpCloud `attendance_records` + `leave_applications`
      //   2. Local payroll DB `attendance_summaries` (cache / legacy
      //      Mark All Present writes that haven't been replayed to
      //      EmpCloud yet)
      //
      // Previously the order was inverted -- the local summary won
      // whenever it existed, even if EmpCloud had fresher data. That
      // meant marking attendance on the EmpCloud HRMS UI didn't show
      // up in payroll until HR also re-clicked Mark All Present on
      // the payroll side. The fix flips the preference so EmpCloud
      // is the canonical source and the local summary is a fallback
      // for periods where EmpCloud has no rows yet.
      const [attRecord] = (await empcloudDb("attendance_records")
        .where("user_id", ecEmp.id)
        .where("organization_id", Number(orgId))
        .whereBetween("date", [startDate, endDate])
        .select(
          // present-equivalent days (half_day / HPL count 0.5). Used ONLY by
          // the NO_ATTENDANCE guard below to decide whether the employee has
          // ANY attendance this month — the actual pay / LOP is computed
          // per-day by resolveCalendarLop, not from these sums.
          empcloudDb.raw(
            "SUM(CASE WHEN status IN ('present','checked_in','weekoff_overtime','holiday_overtime') THEN 1 " +
              "WHEN status IN ('half_day','half_present_half_leave') THEN 0.5 " +
              "ELSE 0 END) as present_days",
          ),
          // `leave_days` = 'on_leave' rows (+0.5 for HPL); feeds the paid-leave
          // signal the NO_ATTENDANCE guard also consults.
          empcloudDb.raw(
            "SUM(CASE WHEN status = 'on_leave' THEN 1 " +
              "WHEN status = 'half_present_half_leave' THEN 0.5 " +
              "ELSE 0 END) as leave_days",
          ),
          empcloudDb.raw("COUNT(*) as total_records"),
        )) as any[];

      const leaveResult = (await empcloudDb("leave_applications as la")
        .join("leave_types as lt", "la.leave_type_id", "lt.id")
        .where("la.user_id", ecEmp.id)
        .where("la.organization_id", Number(orgId))
        .where("la.status", "approved")
        .where("la.start_date", "<=", endDate)
        .where("la.end_date", ">=", startDate)
        .select(
          empcloudDb.raw(
            "SUM(CASE WHEN lt.is_paid = 1 THEN la.days_count ELSE 0 END) as paid_leave",
          ),
          empcloudDb.raw(
            "SUM(CASE WHEN lt.is_paid = 0 THEN la.days_count ELSE 0 END) as unpaid_leave",
          ),
        )
        .first()) as any;

      // BUG-001 / BUG-002 — Source-of-truth order:
      //   1. EmpCloud `attendance_records` (canonical, what the
      //      attendance UI shows; bi-direction sync writes here).
      //   2. Local `attendance_summaries` cache (legacy fallback for
      //      Mark All Present clicks done BEFORE the bi-direction sync
      //      landed -- that data only lives locally).
      //   3. presentDays = 0  -> the empty-structure / zero-earnings
      //      guard further down will skip the employee with reason
      //      NO_ATTENDANCE. We previously defaulted to workingDaysInMonth
      //      ("fully present") when both sources were empty, which made
      //      a legitimately-zero-attendance employee (Sachin in HR's
      //      report: 21 working days, 0 present on the dashboard)
      //      get paid for 21 days regardless. The dashboard read the
      //      same EmpCloud table the engine did, so the only "data
      //      anywhere" source it could have come from is the local
      //      cache fallback -- and if that's also empty, the right
      //      answer is "skip with NO_ATTENDANCE" so HR sees the
      //      employee on the orange skipped banner and can mark them
      //      via the Attendance Grid before approving.
      let presentDays = Number(attRecord?.present_days || 0);
      // BUG-Leave-LOP — Merge two leave sources:
      //   (A) attendance_records.status = 'on_leave' (HR marked the cell
      //       directly on the Attendance Grid, no backing application)
      //   (B) approved leave_applications (employee-submitted or HR-applied
      //       through the "Apply leave" flow, classified by leave_type.is_paid)
      //
      // Old behaviour read only source B, so any (A)-only days fell into
      // LOP -- HR's manual grid mark was effectively ignored by payroll.
      // New behaviour: take the bigger of the two paid views, and
      // subtract explicit unpaid applications from the attendance count.
      // The result:
      //   - on_leave cell + no app          -> PAID (HR's grid intent wins)
      //   - on_leave cell + paid app        -> PAID (same day, counted once)
      //   - on_leave cell + unpaid app      -> UNPAID (explicit unpaid wins)
      //   - no cell + paid app              -> PAID
      //   - no cell + unpaid app            -> UNPAID
      const attendanceLeaveDays = Number(attRecord?.leave_days || 0);
      const leaveAppPaid = Number(leaveResult?.paid_leave || 0);
      const leaveAppUnpaid = Number(leaveResult?.unpaid_leave || 0);
      let paidLeaveDays = Math.max(Math.max(0, attendanceLeaveDays - leaveAppUnpaid), leaveAppPaid);
      let unpaidLeaveDays = leaveAppUnpaid;
      const empcloudHasAttendance = Number(attRecord?.total_records || 0) > 0;

      // LOP when we fall back to the imported summary (no live EmpCloud
      // attendance): the summary's own absent + unpaid-leave counts are the
      // only unpaid days; present / paid-leave are paid. Stays 0 when there's
      // no summary, so the NO_ATTENDANCE guard below skips the row.
      let summaryLop = 0;
      if (!empcloudHasAttendance) {
        const importedSummary = await this.db.findOne<any>("attendance_summaries", {
          empcloud_user_id: ecEmp.id,
          month: run.month,
          year: run.year,
        });
        if (importedSummary) {
          // Local cache hit -- legacy Mark All Present row that pre-dates
          // the bi-direction sync. Use it for THIS run AND project it
          // onto EmpCloud so subsequent runs read from the canonical
          // source.
          presentDays =
            Number(importedSummary.present_days || 0) +
            Number(importedSummary.half_days || 0) * 0.5;
          paidLeaveDays = Number(importedSummary.paid_leave || 0);
          unpaidLeaveDays = Number(importedSummary.unpaid_leave || 0);
          summaryLop =
            Number(importedSummary.absent_days || 0) +
            Number(importedSummary.unpaid_leave || 0) +
            Number(importedSummary.half_days || 0) * 0.5;
        }
        // else: presentDays stays 0 (initialised above). The guard at the
        // empty-structure / zero-earnings check below pushes the row to
        // skipped[] with code NO_ATTENDANCE so HR sees it on the run-
        // detail banner. No payslip is generated.
      }

      // === Payroll basis: full calendar month ===
      // The denominator is EVERY day of the month. Weekends, shift week-offs,
      // holidays and PAID leave are all paid; only genuine UNPAID working-day
      // absences (LOP) reduce pay. "Working day" is resolved per-employee from
      // the shift (same source as the Attendance Grid), holidays excluded, and
      // future days of an in-progress month are never charged. This replaces
      // the old working-days denominator + include_weekends auto-credit, which
      // could mask real absences behind weekend padding (a present record on a
      // holiday + auto-paid weekends hid one of an employee's two absences).
      const totalDays = daysInMonth;
      let lopDays = empcloudHasAttendance
        ? await resolveCalendarLop(
            empcloudDb,
            ecEmp.id,
            Number(orgId),
            monthStart,
            monthEnd,
            holidaySeen,
            todayIso,
            optionalHolidaySeen,
          )
        : summaryLop;
      let paidDays = Math.max(0, totalDays - lopDays);
      // Apply the mid-month exit upper bound. Anything beyond
      // (last_working_date - monthStart + 1) is unpaid LOP. We bump up
      // `lopDays` symmetrically so downstream calculations (Form 16, LWF,
      // PT-by-paid-days, etc.) see a consistent (paid + LOP = totalDays)
      // invariant.
      if (exitPaidUpperBound !== null && paidDays > exitPaidUpperBound) {
        const trimmed = paidDays - exitPaidUpperBound;
        paidDays = exitPaidUpperBound;
        lopDays += trimmed;
      }

      // Template-driven component list — read the latest `salary_components`
      // rows for this employee's structure_id and compute amounts off the
      // employee's CTC. The pre-existing JSON snapshot in
      // `employee_salaries.components` is kept only as a fallback when no
      // template rows exist (legacy salaries that pre-date the structure
      // table, or one-off structures).
      //
      // Why: when HR edits a structure on /payroll/structures (adds an OT
      // component, changes a percentage, etc.), the change should apply to
      // every employee on that structure on the next payroll run — without
      // having to re-assign the structure to each employee. The frozen
      // snapshot couldn't do that; this can.
      let componentList: any[] = [];
      if (salary.structure_id) {
        const tplRows = await this.db.findMany<any>("salary_components", {
          filters: { structure_id: salary.structure_id, is_active: 1 },
          sort: { field: "sort_order", order: "asc" },
          limit: 100,
        });
        const gross = Number(salary.gross_salary || 0);
        componentList = (tplRows?.data || []).map((t: any) => {
          const calcType = String(t.calculation_type || "").trim();
          const base: any = {
            code: t.code,
            name: t.name,
            type: t.type,
            calculationType: calcType,
            percentageOf: t.percentage_of || undefined,
            isProratable: t.is_proratable == null ? true : !!Number(t.is_proratable),
            isTaxable: t.is_taxable == null ? true : !!Number(t.is_taxable),
            isStatutory: !!Number(t.is_statutory),
          };
          if (calcType === "percentage") {
            // PercentageOf=GROSS is the common case; if the template names a
            // different basis (e.g. BASIC) we still keep the field so any
            // downstream consumer that cares can use it, but the amount we
            // pre-compute uses GROSS (matches the historical snapshot math).
            const annual = Math.round((gross * Number(t.value || 0)) / 100);
            return { ...base, annualAmount: annual, monthlyAmount: Math.round(annual / 12) };
          }
          if (calcType === "fixed") {
            const monthly = Math.round(Number(t.value || 0));
            return { ...base, annualAmount: monthly * 12, monthlyAmount: monthly };
          }
          // Variable / rate-based (per_ot, per_ot_daily, per_night,
          // per_night_daily, per_night_pct, formula, balance, etc.).
          // monthlyAmount stays 0; the engine multiplies the rate by the
          // actual count further down.
          return { ...base, annualAmount: 0, monthlyAmount: 0, rate: Number(t.value || 0) };
        });
      }
      if (componentList.length === 0) {
        // Fallback: legacy salaries without a structure_id, or structures
        // whose template rows were deleted — use whatever was snapshotted.
        const snap =
          typeof salary.components === "string" ? JSON.parse(salary.components) : salary.components;
        componentList = Array.isArray(snap) ? snap : [];
      }

      // BUG-004 — Capture the un-prorated (contracted) Basic and HRA so the
      // annual TDS projection can use the FULL year-equivalent values rather
      // than this month's pro-rated ones. Using pro-rated values for annual
      // TDS shrank the 50%-of-basic HRA exemption cap during LOP months and
      // pulled `employeePfAnnual` below the actual year-end PF, both of
      // which inflated TDS for any employee with even a single day of LOP.
      const structureBasicMonthly = Number(
        componentList.find((c: any) => c.code === "BASIC")?.monthlyAmount || 0,
      );
      const structureHraMonthly = Number(
        componentList.find((c: any) => c.code === "HRA")?.monthlyAmount || 0,
      );

      // Calculate earnings (pro-rated for LOP)
      const proRatio = totalDays > 0 ? paidDays / totalDays : 0;
      // Nights worked under a shift flagged `is_night_shift=1` -- used by
      // `per_night` / `per_night_daily` components. Resolved from
      // shift_assignments (the canonical "who is on which shift" source),
      // NOT attendance_records.shift_id which is almost always NULL in
      // practice. Only computed when the structure actually has a night
      // component, to avoid two extra DB round-trips per employee on
      // every other run.
      const hasNightComponent = componentList.some(
        (c: any) =>
          c.calculationType === "per_night" ||
          c.calculationType === "per_night_daily" ||
          c.calculationType === "per_night_pct",
      );
      const nightShiftDays = hasNightComponent
        ? await resolveNightShiftDays(empcloudDb, ecEmp.id, Number(orgId), startDate, endDate)
        : 0;
      // Overtime days — present on a week-off or holiday (auto-derived the
      // same way the Attendance Grid shows WOT/HOT). Only computed when the
      // structure has an overtime component, to skip the extra queries
      // otherwise.
      const hasOvertimeComponent = componentList.some(
        (c: any) => c.calculationType === "per_ot" || c.calculationType === "per_ot_daily",
      );
      const overtimeDays = hasOvertimeComponent
        ? await resolveOvertimeDays(empcloudDb, ecEmp.id, Number(orgId), startDate, endDate)
        : 0;
      const earnings: any[] = [];
      // Night-allowance + overtime components, deferred to a second pass
      // (see below) so the `× Day Pay` mode can multiply the fully-summed
      // base gross.
      const nightComps: any[] = [];
      // "% of Net Pay" night-allowance components, deferred even further —
      // past the deductions block — since they need the base net pay.
      const netPctComps: any[] = [];
      let grossEarnings = 0;
      let basicMonthly = 0;

      // Separate earnings from custom deductions defined in salary structure
      const deductions: any[] = [];
      let totalDed = 0;

      // #365 — Apply org-level EPF cap to structure-defined EPF rows.
      // When HR sets a structure deduction like "EPF = 12% of BASIC",
      // the resolver computes raw 12% × basic without consulting the
      // org's pf_max_employee_contribution / pf_apply_full_basic
      // overrides. The cap-aware engine path below skips when a
      // structure-EPF row exists, so the structure's uncapped value
      // ended up on the payslip. Apply the same cap here so a
      // structure-defined EPF behaves identically to the engine-derived
      // EPF when the org has set an override.
      const _normCodeForCap = (code: string | undefined): string =>
        (code || "").toUpperCase().replace(/[^A-Z]/g, "");
      const _isEpfishForCap = (code: string | undefined): boolean => {
        const c = _normCodeForCap(code);
        if (!c) return false;
        if (c.includes("EPF")) return true;
        return c === "PF" || c.startsWith("PFE") || c.startsWith("PFC");
      };
      const _orgOverridesForCap = buildOrgStatutoryOverrides(orgSettings);
      const _epfMaxCap = _orgOverridesForCap.pfMaxEmployeeContribution;

      for (const comp of componentList) {
        if (comp.type === "deduction") {
          // Custom deduction from salary structure (canteen, welfare fund, etc.)
          let amount = Math.round(Number(comp.monthlyAmount || 0) * proRatio);
          if (
            _isEpfishForCap(comp.code) &&
            typeof _epfMaxCap === "number" &&
            Number.isFinite(_epfMaxCap) &&
            _epfMaxCap >= 0 &&
            amount > _epfMaxCap
          ) {
            amount = Math.round(_epfMaxCap * proRatio);
          }
          if (amount > 0) {
            deductions.push({ code: comp.code, name: comp.name || comp.code, amount });
            totalDed += amount;
          }
        } else if (comp.calculationType === "per_night_pct") {
          // "% of Net Pay" night allowance — deferred all the way past the
          // deductions block (it needs the base NET, which isn't known until
          // PF/ESI/PT/TDS are computed). Collected separately from nightComps.
          netPctComps.push(comp);
        } else if (
          comp.calculationType === "per_night" ||
          comp.calculationType === "per_night_daily" ||
          comp.calculationType === "per_ot" ||
          comp.calculationType === "per_ot_daily"
        ) {
          // Night Allowance + Overtime are deferred to a second pass below:
          // the `× Day Pay` night mode multiplies the WHOLE base gross,
          // which isn't fully known until every other earning is summed.
          nightComps.push(comp);
        } else {
          // Earning component
          const amount = Math.round(Number(comp.monthlyAmount || 0) * proRatio);
          earnings.push({
            code: comp.code,
            name: comp.code === "BASIC" ? "Basic Salary" : comp.name || comp.code,
            amount,
          });
          grossEarnings += amount;
          if (comp.code === "BASIC") basicMonthly = amount;
        }
      }

      // Second pass — Night Allowance, now that `grossEarnings` holds the
      // full base (regular earnings, post-LOP-proration).
      //
      // per_night       : flat ₹ rate × nights worked under a night shift.
      //                   amount = rate × nights.
      // per_night_daily : "× Day Pay" — multiplies the WHOLE salary. A
      //                   night-shift employee earns `multiplier ×` their
      //                   normal pay, so the allowance tops the base up to
      //                   that multiple: amount = baseGross × (multiplier − 1).
      //                   Gated on having worked ≥1 night; the night count
      //                   itself is a gate, not a proportional factor (a
      //                   night worker's whole month is paid at the night
      //                   rate). Not pro-rated again — baseGross already is.
      const baseGrossForNight = grossEarnings;
      // Total night allowance paid THIS month — fed into the annual TDS
      // projection below so the variable night pay is actually taxed
      // (otherwise monthly TDS, projected off the contracted salary only,
      // ignores it and the employee faces a year-end shortfall).
      let nightAllowanceThisMonth = 0;
      // Contracted daily salary for the *_daily multiplier modes —
      // un-prorated so a worked night/OT day pays the same regardless of
      // LOP elsewhere in the month.
      const contractedDailySalary = Number(salary.gross_salary || 0) / 12 / Math.max(1, totalDays);
      for (const comp of nightComps) {
        const rate = Number(comp.rate ?? comp.value ?? 0);
        let amount = 0;
        let meta: Record<string, number>;
        if (comp.calculationType === "per_night_daily") {
          // Math.max(0, …) guards a multiplier < 1 (e.g. 0.5), which would
          // otherwise produce a NEGATIVE allowance and silently dock pay.
          // The UI validator also enforces ≥ 1, this is the engine-side net.
          amount = nightShiftDays > 0 ? Math.max(0, Math.round(baseGrossForNight * (rate - 1))) : 0;
          meta = { multiplier: rate, nights: nightShiftDays, baseGross: baseGrossForNight };
        } else if (comp.calculationType === "per_night") {
          amount = Math.round(rate * nightShiftDays);
          meta = { rate, nights: nightShiftDays };
        } else if (comp.calculationType === "per_ot_daily") {
          // Overtime, per OT day: multiplier × daily salary × OT days.
          // Additive per day (NOT whole-salary like the night × Day Pay).
          amount = Math.max(0, Math.round(contractedDailySalary * rate * overtimeDays));
          meta = {
            dailySalary: Math.round(contractedDailySalary),
            multiplier: rate,
            otDays: overtimeDays,
          };
        } else {
          // per_ot — flat ₹ per OT day.
          amount = Math.round(rate * overtimeDays);
          meta = { rate, otDays: overtimeDays };
        }
        if (amount > 0) {
          earnings.push({
            code: comp.code,
            name: comp.name || comp.code,
            // Surfaced on the payslip so HR can verify the math without
            // re-querying attendance.
            amount,
            meta,
          });
          grossEarnings += amount;
          // Both night allowance and overtime are variable taxable pay —
          // fold into the same bucket that feeds the annual TDS projection.
          nightAllowanceThisMonth += amount;
        }
      }

      // #268 — Guard against the "empty salary structure" disaster: if the
      // employee's salary has no active earning components (or all of them
      // pro-rate down to 0 because of zero working days etc.), skip this
      // row entirely. Generating a payslip here would compute PF/ESI/TDS
      // from `salary.gross_salary` while gross_earnings = 0 — that's how
      // we ended up with payslips showing Net Pay of -₹1,17,78,332.
      const hasEarningComponent = componentList.some(
        (c: any) => c.type !== "deduction" && Number(c.monthlyAmount || 0) > 0,
      );
      if (!hasEarningComponent || grossEarnings <= 0) {
        // Differentiate "no salary structure" from "no attendance" so HR
        // can fix the right thing. The previous lumped "EMPTY_SALARY_STRUCTURE"
        // message was misleading when the structure was fine but
        // attendance was 0 (BUG-001/002 — Abhishek/Ananya cases where
        // EmpCloud has zero attendance rows for the period).
        const noAttendance = hasEarningComponent && presentDays === 0 && paidLeaveDays === 0;
        skipped.push({
          empcloudUserId: ecEmp.id,
          name: ecName,
          empCode: ecAny.emp_code || null,
          code: noAttendance ? "NO_ATTENDANCE" : "EMPTY_SALARY_STRUCTURE",
          reason: noAttendance
            ? "No attendance recorded in EmpCloud for this period (0 present + 0 paid leave)"
            : !hasEarningComponent
              ? "Salary structure has no active earning components"
              : "Earning components pro-rated to 0 (no paid days?)",
        });
        continue;
      }

      // BUG-003 — Double EPF deduction. If the salary structure already
      // defines an EPF-style deduction, the statutory engine MUST NOT
      // add another standard EPF row on top. Without this check Priya
      // Patel saw "EEPF D ₹1,801" + "EPF ₹1,800" both deducted, and
      // Abhishek saw "EEPF D ₹86" + "Employee PF ₹152" too -- a
      // previous narrow match list ("EPF" / "EEPF" / "PF" /
      // "EMPLOYEEPF" / "EEPFDED") missed real-world variants like
      // "EEPF D" (which strips to "EEPFD") and any future code that
      // simply CONTAINS "PF" / "EPF". Broadened to a substring test so
      // any code containing "EPF" or starting with "PF" matches. The
      // structure-defined row wins (HR set it explicitly), engine
      // skips its statutory equivalent. ESI mirrors the same rule.
      const normCode = (code: string | undefined): string =>
        (code || "").toUpperCase().replace(/[^A-Z]/g, "");
      const isEpfishCode = (code: string | undefined): boolean => {
        const c = normCode(code);
        if (!c) return false;
        // Any code containing "EPF" (matches EPF, EEPF, EEPFD, EMPEPF,
        // VPF wouldn't match -- VPF is voluntary and NOT a duplicate).
        if (c.includes("EPF")) return true;
        // Bare "PF" prefix (covers "PF", "PF1", "PFEMP", but not "EPF"
        // since that's already caught above). The empty/CONTRIBPF case
        // is a deliberate inclusion.
        return c === "PF" || c.startsWith("PFE") || c.startsWith("PFC");
      };
      const isEsiishCode = (code: string | undefined): boolean => {
        const c = normCode(code);
        return !!c && c.includes("ESI");
      };
      const structureHasEpf = componentList.some(
        (c: any) => c.type === "deduction" && isEpfishCode(c.code),
      );
      const structureHasEsi = componentList.some(
        (c: any) => c.type === "deduction" && isEsiishCode(c.code),
      );

      // PF
      const pfDetails = profile?.pf_details
        ? typeof profile.pf_details === "string"
          ? JSON.parse(profile.pf_details)
          : profile.pf_details
        : {};
      // Track per-component employer contributions so the payslip and
      // payroll detail page can show "the employer also pays X / Y / Z on
      // top of gross" -- previously the breakdown was computed but only
      // the rolled-up total was kept (employer_contributions on the
      // payslip was always JSON.stringify([])), so HR had no way to see
      // where the employer cost came from.
      const employerContribs: Array<{ code: string; name: string; amount: number }> = [];
      if (!pfDetails?.isOptedOut && !structureHasEpf) {
        // Pass org-level statutory overrides (migration 029) so PF can
        // honour pf_apply_full_basic, pf_max_employee_contribution, and
        // pf_default_employee_rate when the org has set them.
        const orgOverrides = buildOrgStatutoryOverrides(orgSettings);
        const pf = computePF({
          employeeId: String(ecEmp.id),
          month: run.month,
          year: run.year,
          basicSalary: basicMonthly,
          contributionRate: pfDetails?.contributionRate || undefined,
          isVoluntaryPF: !!pfDetails?.vpfRate,
          vpfRate: pfDetails?.vpfRate || 0,
          orgOverrides,
        });
        deductions.push({ code: "EPF", name: "Employee PF", amount: pf.employeeEPF });
        totalDed += pf.employeeEPF;
        employeeEmployerContributions += pf.totalEmployer;
        if (pf.employerEPF > 0)
          employerContribs.push({ code: "EMP_EPF", name: "Employer EPF", amount: pf.employerEPF });
        if (pf.employerEPS > 0)
          employerContribs.push({ code: "EMP_EPS", name: "Employer EPS", amount: pf.employerEPS });
        if (pf.adminCharges > 0)
          employerContribs.push({
            code: "EPF_ADMIN",
            name: "EPF Admin Charges",
            amount: pf.adminCharges,
          });
        if (pf.edliCharges > 0)
          employerContribs.push({ code: "EDLI", name: "EDLI Charges", amount: pf.edliCharges });
      }

      // ESI — check eligibility from profile
      const esiDetails = profile?.esi_details
        ? typeof profile.esi_details === "string"
          ? JSON.parse(profile.esi_details)
          : profile.esi_details
        : {};
      if (esiDetails?.isEligible !== false && !structureHasEsi) {
        const esi = computeESI({
          employeeId: String(ecEmp.id),
          month: run.month,
          year: run.year,
          // Use the base gross (BEFORE night allowance) for ESI. The ESI
          // ₹21K eligibility ceiling and contribution must track the
          // employee's regular wage, not a variable night premium —
          // otherwise a low-wage ESI employee could be flipped OUT of
          // ESI in a month they happen to work nights, and their ESI
          // base would swing month to month. `baseGrossForNight` is the
          // gross before the night second-pass; for employees with no
          // night component it equals the full grossEarnings, so this is
          // non-regressive.
          grossSalary: baseGrossForNight,
          orgOverrides: buildOrgStatutoryOverrides(orgSettings),
        });
        if (esi) {
          deductions.push({ code: "ESI", name: "Employee ESI", amount: esi.employeeContribution });
          totalDed += esi.employeeContribution;
          employeeEmployerContributions += esi.employerContribution;
          if (esi.employerContribution > 0)
            employerContribs.push({
              code: "EMP_ESI",
              name: "Employer ESI",
              amount: esi.employerContribution,
            });
        }
      }

      // Tax info is needed for both PT (to read deductPT + state override)
      // and TDS (to read regime + deductTDS + PAN), so parse it once up
      // front instead of separately in each block.
      const taxInfo = profile?.tax_info
        ? typeof profile.tax_info === "string"
          ? JSON.parse(profile.tax_info)
          : profile.tax_info
        : {};

      // Professional Tax. Gates, in precedence order:
      //   - Migration 036: org-level `pt_disabled` kill-switch. When set,
      //     PT is skipped for EVERY employee regardless of the per-employee
      //     flag — the org operates in a no-PT state or opts out entirely.
      //   - tax_info.deductPT === false: per-employee skip (e.g. one
      //     employee in a no-PT state like Delhi/Haryana even though the
      //     org's primary state has PT)
      //   - tax_info.state: override the org state for slab lookup so
      //     a Bangalore-HQ company with a Mumbai-resident employee
      //     applies Maharashtra slabs to that one person.
      const ptDisabledOrgWide = !!Number(orgSettings?.pt_disabled);
      if (!ptDisabledOrgWide && taxInfo?.deductPT !== false) {
        const ptState =
          (typeof taxInfo?.state === "string" && taxInfo.state.trim()) ||
          orgSettings?.state ||
          "KA";
        // BUG-013 — PT slab basis. PT is a fixed monthly statutory levy
        // tied to the employee's contracted gross, NOT the LOP-pro-rated
        // gross. The previous code passed `grossEarnings` (pro-rated),
        // so an employee with a single LOP day in Maharashtra (slab kicks
        // in above ₹10K) saw PT swing to 0 if their pro-rated gross fell
        // below the slab threshold even though their CTC clearly puts
        // them in the bracket -- HR reported Priya's April PT as 0 vs
        // May's ₹200 with the same structure. Use the un-prorated
        // structure-level monthly gross (sum of earning components at
        // their resolver-stored monthlyAmount) so PT stays consistent
        // across LOP months.
        const structureGrossMonthly = componentList
          .filter((c: any) => c.type !== "deduction" && c.type !== "reimbursement")
          .reduce((s: number, c: any) => s + Number(c.monthlyAmount || 0), 0);
        const ptBasis = structureGrossMonthly > 0 ? structureGrossMonthly : grossEarnings;
        const pt = computeProfessionalTax({
          employeeId: String(ecEmp.id),
          month: run.month,
          year: run.year,
          state: ptState,
          grossSalary: ptBasis,
        });
        if (pt.taxAmount > 0) {
          deductions.push({ code: "PT", name: "Professional Tax", amount: pt.taxAmount });
          totalDed += pt.taxAmount;
        }
      }

      // TDS (income tax). tax_info.deductTDS === false skips the
      // calculation entirely -- some employees are below taxable
      // threshold or have a Lower Deduction Certificate from the IT
      // dept and HR doesn't want monthly TDS withheld.
      const fyStartMonth = 4;
      const currentMonth = run.month;
      const monthsRemaining =
        currentMonth >= fyStartMonth
          ? 12 - (currentMonth - fyStartMonth)
          : fyStartMonth - currentMonth;

      // BUG-006 — YTD TDS lookup. Without this, `taxAlreadyPaid` is always
      // 0, so the engine treats every month as if it's the first one of
      // the FY: in March it tries to recoup the full annual tax in a
      // single payslip, blowing out net pay. Sum TDS deducted on the
      // employee's earlier payslips that fall inside the same FY (Apr →
      // Mar of the next year). Reads from `payslips.deductions` JSON,
      // matching code === "TDS".
      const fyAnchorYear = run.month >= fyStartMonth ? run.year : run.year - 1;
      const fyStartDate = `${fyAnchorYear}-04-01`;
      const fyEndDate = `${fyAnchorYear + 1}-03-31`;
      const priorPayslips = await this.db.findMany<any>("payslips", {
        filters: { empcloud_user_id: ecEmp.id },
        limit: 100,
      });
      let taxAlreadyPaid = 0;
      // Night allowance already paid in earlier months of THIS FY. Folded
      // into the annual projection so the engine taxes the full year's
      // night pay, not just the run-rate from the current month forward.
      let nightAllowancePriorThisFy = 0;
      for (const ps of priorPayslips.data) {
        if (ps.payroll_run_id === runId) continue; // current run -- skip
        const psYear = Number(ps.year);
        const psMonth = Number(ps.month);
        if (!psYear || !psMonth) continue;
        const psDate = `${psYear}-${String(psMonth).padStart(2, "0")}-01`;
        if (psDate < fyStartDate || psDate > fyEndDate) continue;
        // Don't include the very same period (defensive — should be
        // wiped already by deleteMany at the top of compute).
        if (psYear === run.year && psMonth === run.month) continue;
        const dedList =
          typeof ps.deductions === "string" ? JSON.parse(ps.deductions || "[]") : ps.deductions;
        if (Array.isArray(dedList)) {
          for (const d of dedList) {
            if (d?.code === "TDS") taxAlreadyPaid += Number(d.amount) || 0;
          }
        }
        // Night allowance lines are tagged with `meta.nights` — sum them
        // for this FY's prior months. (Distinct from any other earning;
        // nothing else sets meta.nights.)
        const earnList =
          typeof ps.earnings === "string" ? JSON.parse(ps.earnings || "[]") : ps.earnings;
        if (Array.isArray(earnList)) {
          for (const e of earnList) {
            // Night allowance lines carry meta.nights; overtime lines carry
            // meta.otDays; the % -of-net night line carries meta.netPct.
            // All are variable taxable pay — sum any of them.
            if (
              e?.meta &&
              (e.meta.nights != null || e.meta.otDays != null || e.meta.netPct != null)
            ) {
              nightAllowancePriorThisFy += Number(e.amount) || 0;
            }
          }
        }
      }

      if (taxInfo?.deductTDS !== false) {
        // BUG-002 / BUG-001 — PAN merge. The HR/payroll profile's `tax_info.pan`
        // is often empty because the source of truth lives on the EmpCloud
        // side (`employee_profiles.pan_number` -- where the employee fills
        // it during onboarding). When payroll computed TDS off the raw
        // payroll-side JSON, every employee whose PAN sat only on the
        // EmpCloud side fell into Section 206AA and got a flat 20% TDS,
        // producing the "everyone's TDS is identical at ₹1.44L" symptom
        // and the "low-income employee still owes TDS" symptom (low income
        // would normally hit the rebate but 206AA bypasses slabs entirely).
        // Fall through to EmpCloud's PAN here so the tax engine sees the
        // same PAN that the My Profile page sees.
        let resolvedPan: string | null =
          typeof taxInfo?.pan === "string" && taxInfo.pan.trim() ? taxInfo.pan.trim() : null;
        if (!resolvedPan) {
          const ecProfile = await findEmployeeProfileByUserId(ecEmp.id);
          if (ecProfile?.pan_number && ecProfile.pan_number.trim()) {
            resolvedPan = ecProfile.pan_number.trim();
          }
        }

        // BUG-MidFY — Mid-FY joiner support via Form 12B. When a new hire
        // brings prior-employer income+TDS for the same FY, the payroll
        // engine must treat the prior income as part of the slab base AND
        // count the prior TDS against `taxAlreadyPaid` -- otherwise the
        // engine projects the full annual tax against this employer alone
        // and over-deducts by the prior-TDS amount. Stored per-FY under
        // `tax_info.priorEmployerTds[fy] = { grossPaid, tdsDeducted, ... }`.
        const runFy =
          run.month >= 4 ? `${run.year}-${run.year + 1}` : `${run.year - 1}-${run.year}`;
        const priorEmp: any = (taxInfo?.priorEmployerTds && taxInfo.priorEmployerTds[runFy]) || {};
        const priorEmployerGross = Number(priorEmp.grossPaid || 0);
        const priorEmployerTds = Number(priorEmp.tdsDeducted || 0);

        // Project the variable night allowance across the FY so it gets
        // taxed: actuals already paid this FY + the current month's amount
        // run-rated over the remaining months. If night work stops, next
        // month's projection drops and the YTD `taxAlreadyPaid` lookup
        // trues the over-withholding back down automatically — so a
        // run-rate projection is safe even when nights are sporadic.
        const projectedAnnualNightAllowance =
          nightAllowancePriorThisFy + nightAllowanceThisMonth * monthsRemaining;

        const taxResult = computeIncomeTax({
          employeeId: String(ecEmp.id),
          financialYear: runFy,
          regime: taxInfo?.regime === "old" ? TaxRegime.OLD : TaxRegime.NEW,
          annualGross:
            Number(salary.gross_salary) + priorEmployerGross + projectedAnnualNightAllowance,
          // BUG-004 — These three feed the ANNUAL tax projection and must
          // use the contracted (un-prorated) salary-structure values, not
          // this month's pro-rated `basicMonthly`. Pro-rating these would
          // make the 50%-of-basic HRA exemption cap shrink during LOP
          // months and the projected employee PF dip below the year-end
          // total — both of which artificially inflate TDS.
          basicAnnual: structureBasicMonthly * 12,
          hraAnnual: structureHraMonthly * 12,
          rentPaidAnnual: 0,
          isMetroCity: false,
          declarations: [],
          employeePfAnnual: structureBasicMonthly * 0.12 * 12,
          monthsWorked: monthsRemaining,
          taxAlreadyPaid,
          priorEmployerTds,
          // #1657 — Section 206AA: when PAN is missing, the tax engine
          // applies a flat 20% rate. Empty / null pan triggers that branch.
          // `resolvedPan` already covers the payroll → EmpCloud merge above.
          panNumber: resolvedPan,
        });

        if (taxResult.monthlyTds > 0) {
          // BUG (May retest) — TDS cap. The tax engine projects monthly
          // TDS off ANNUAL gross divided by remaining months. When an
          // employee has a partial-month payslip (LOP-heavy month), the
          // pro-rated grossEarnings can be tiny while the monthly TDS
          // slug is unchanged -- producing net pay BELOW zero (Abhishek
          // saw -₹1,154 with gross ₹318 vs TDS ₹1,455).
          //
          // Cap TDS at the room left after gross minus other deductions
          // so this month's TDS withholding never pushes net negative.
          // The under-collected portion gets re-projected next month
          // because `taxAlreadyPaid` (YTD lookup) will see the smaller
          // amount, so the engine catches up automatically -- no money
          // lost to the IT department, just smoothed across months.
          const tdsRoom = Math.max(0, grossEarnings - totalDed);
          const cappedTds = Math.min(taxResult.monthlyTds, tdsRoom);
          if (cappedTds > 0) {
            deductions.push({ code: "TDS", name: "Income Tax (TDS)", amount: cappedTds });
            totalDed += cappedTds;
          }
        }
        if (!resolvedPan) {
          missingPan.push({ empcloudUserId: ecEmp.id, name: ecName, code: ecEmp.emp_code || "" });
        }
      }

      // Loan EMI auto-deduction — find active loans for this employee
      // Loans reference the local employees table; try both empcloud user id and profile id
      const loanFilters = [
        { employee_id: String(ecEmp.id), status: "active" },
        ...(profile ? [{ employee_id: profile.id, status: "active" }] : []),
      ];
      for (const lf of loanFilters) {
        const activeLoans = await this.db.findMany<any>("loans", { filters: lf });
        for (const loan of activeLoans.data) {
          // Pick the per-month EMI:
          //  - if loan.custom_emi_amount is set, that's HR's override
          //    (e.g. ₹10,000 instead of the tenure-derived ₹9,578);
          //  - otherwise fall back to loan.emi_amount stored at create
          //    (tenure-based).
          // Then cap at the current outstanding so the FINAL month settles
          // whatever's left (e.g. ₹28,734 − ₹10k − ₹10k = ₹8,734 on the
          // third month). Without the cap the engine would over-deduct on
          // the final month and look right on the loan ledger but wrong
          // on the payslip.
          const baseEmi = Math.round(
            Number(loan.custom_emi_amount != null ? loan.custom_emi_amount : loan.emi_amount),
          );
          const outstanding = Math.max(0, Math.round(Number(loan.outstanding_amount)));
          const emi = Math.min(baseEmi, outstanding);
          if (emi > 0) {
            // Snapshot the loan state BEFORE applying this EMI so
            // deleteRun() can revert exactly even if a later run /
            // manual edit / loan top-up has happened since. Without
            // these snapshots, a revert would have to guess the delta
            // and would mis-correct any loan whose schedule has been
            // touched after this payslip was generated.
            const previousOutstanding = Number(loan.outstanding_amount);
            const previousInstallmentsPaid = Number(loan.installments_paid) || 0;
            const previousStatus = loan.status;
            const newOutstanding = Math.max(0, previousOutstanding - emi);
            const newStatus = newOutstanding <= 0 ? "completed" : previousStatus;
            deductions.push({
              code: "LOAN",
              name: `Loan EMI — ${loan.type || "Loan"}`,
              amount: emi,
              meta: {
                loan_id: loan.id,
                previous_outstanding: previousOutstanding,
                previous_installments_paid: previousInstallmentsPaid,
                previous_status: previousStatus,
              },
            } as any);
            totalDed += emi;
            await this.db.update("loans", loan.id, {
              installments_paid: previousInstallmentsPaid + 1,
              outstanding_amount: newOutstanding,
              ...(newStatus !== previousStatus ? { status: newStatus } : {}),
            });
          }
        }
        if (activeLoans.data.length > 0) break; // Found loans, don't query again
      }

      // Approved reimbursements -- bundle every approved-but-unpaid claim
      // into this run's payslip as a single REIMB earning line per claim.
      // Mirrors the loan pattern: snapshot the previous status / pay-period
      // fields on the line so deleteRun() can revert exactly, then flip
      // the reimbursement row to status='paid' with this run's month+year
      // so the next run won't pick the same claim up again. Reimbursements
      // are post-tax (legit expense returns, not income) so they're added
      // to gross AFTER TDS has been computed -- the deduction has the
      // correct withholding for the salary portion only, and reimbursement
      // flows straight through to net.
      const reimbursementFilters = [
        { employee_id: String(ecEmp.id), status: "approved" },
        ...(profile ? [{ employee_id: profile.id, status: "approved" }] : []),
      ];
      const seenReimbIds = new Set<string>();
      for (const rf of reimbursementFilters) {
        const claims = await this.db.findMany<any>("reimbursements", { filters: rf });
        for (const claim of claims.data) {
          if (seenReimbIds.has(String(claim.id))) continue;
          seenReimbIds.add(String(claim.id));
          const amount = Math.round(Number(claim.amount));
          if (amount <= 0) continue;
          const previousStatus = claim.status;
          const previousPaidMonth = claim.paid_in_month;
          const previousPaidYear = claim.paid_in_year;
          earnings.push({
            code: "REIMB",
            name: `Reimbursement — ${claim.category || "Claim"}`,
            amount,
            meta: {
              reimbursement_id: claim.id,
              expense_date: claim.expense_date,
              description: claim.description,
              previous_status: previousStatus,
              previous_paid_in_month: previousPaidMonth,
              previous_paid_in_year: previousPaidYear,
            },
          } as any);
          grossEarnings += amount;
          await this.db.update("reimbursements", String(claim.id), {
            status: "paid",
            paid_in_month: Number(run.month),
            paid_in_year: Number(run.year),
          });
        }
      }

      // "% of Net Pay" night allowance — computed LAST because it needs the
      // base net (gross − all deductions). Paid once when the employee worked
      // ≥1 night (not scaled by nights). Added to gross so it lands in net.
      // Its own tax isn't withheld this month (TDS is already computed), but
      // each line is tagged meta.netPct so next month's FY projection sees it
      // and trues up the withholding — the same self-correcting path the
      // other variable night/OT pay uses.
      if (netPctComps.length > 0 && nightShiftDays > 0) {
        const baseNetForPct = Math.max(0, grossEarnings - totalDed);
        for (const comp of netPctComps) {
          const pct = Number(comp.rate ?? comp.value ?? 0);
          const amount = Math.max(0, Math.round(baseNetForPct * (pct / 100)));
          if (amount > 0) {
            earnings.push({
              code: comp.code,
              name: comp.name || comp.code,
              amount,
              meta: { netPct: pct, baseNet: baseNetForPct, nights: nightShiftDays },
            });
            grossEarnings += amount;
          }
        }
      }

      // Apply org-level rounding policy (migration 029) to the per-employee
      // totals so the payslip and the payroll-run roll-up use consistent
      // numbers. Default ("none" or unset) is a no-op so existing orgs see
      // no change. Only the totals are rounded -- per-component line items
      // stay at their natural Math.round precision so the math still adds
      // up: rounding the totals is what HR cares about for bank transfers.
      const roundingPolicy = orgSettings?.rounding_policy ?? null;
      const roundedGross = applyRounding(grossEarnings, roundingPolicy);

      // Belt-and-braces net-pay floor. The TDS cap further up already
      // tries to keep net pay non-negative, but loan EMIs and other
      // structure-defined deductions can still push it below zero on a
      // partial-month payslip (Abhishek: gross ₹3,174 with TDS ₹14,546
      // produced -₹11,834). Trim the TDS line one more time here so
      // total deductions never exceed gross. Any TDS shortfall gets
      // re-projected next month via the YTD `taxAlreadyPaid` lookup.
      // Loans / canteen / etc. are NOT trimmed -- those are HR-bound
      // commitments that shouldn't quietly skip; if they push net
      // negative without TDS in the picture, the alert banner already
      // flags it for HR review.
      let totalDedFloored = totalDed;
      if (totalDedFloored > grossEarnings) {
        const overflow = totalDedFloored - grossEarnings;
        const tdsRow = deductions.find((d) => d.code === "TDS");
        if (tdsRow && tdsRow.amount > 0) {
          const reduceBy = Math.min(overflow, tdsRow.amount);
          tdsRow.amount = Math.max(0, tdsRow.amount - reduceBy);
          totalDedFloored -= reduceBy;
          if (tdsRow.amount === 0) {
            const idx = deductions.indexOf(tdsRow);
            if (idx >= 0) deductions.splice(idx, 1);
          }
        }
      }
      const roundedDed = applyRounding(totalDedFloored, roundingPolicy);
      const netPay = roundedGross - roundedDed;
      // Total Cost to Company (TCC) framing depends on the org-wide
      // "Employer PF in CTC" toggle (migration 032):
      //   OFF (default): TCC = gross + employer contributions on top.
      //                  This is the additive model — the offer letter
      //                  CTC is the employee gross, and employer PF/ESI
      //                  are extra company expense.
      //   ON          : TCC = gross. The offer letter CTC already
      //                  includes employer contributions, so we DON'T
      //                  add them on top -- the employer_contributions
      //                  list still records the breakdown for filings,
      //                  but the headline TCC matches what HR negotiated.
      const employerPfInCtc = !!orgSettings?.employer_pf_in_ctc;
      const roundedEmployerCost = applyRounding(
        employerPfInCtc ? roundedGross : roundedGross + employeeEmployerContributions,
        roundingPolicy,
      );

      // Create payslip.
      // `employee_id` is a legacy UUID column (the pre-EmpCloud schema's FK
      // to a local `employees` table that was dropped). The original
      // implementation used the same dummy zero-UUID for every row, which
      // collided with the legacy `UNIQUE (payroll_run_id, employee_id)`
      // index -- the second employee in any run hit ER_DUP_ENTRY and the
      // entire compute aborted. Migration 030 swaps the unique index to
      // (payroll_run_id, empcloud_user_id) which is the correct semantic
      // key; generating a fresh UUID here keeps the insert valid both
      // before and after that migration runs.
      await this.db.create("payslips", {
        payroll_run_id: runId,
        employee_id: uuidv4(),
        empcloud_user_id: ecEmp.id,
        month: run.month,
        year: run.year,
        paid_days: paidDays,
        total_days: totalDays,
        lop_days: lopDays,
        earnings: JSON.stringify(earnings),
        deductions: JSON.stringify(deductions),
        // Per-component employer contributions (Employer EPF / EPS / EDLI
        // / Admin / Employer ESI). Sum of `amount` here equals
        // employeeEmployerContributions, which feeds total_employer_cost
        // below. Stored so the payslip / payroll detail page can render
        // "Employer also pays X" without recomputing.
        employer_contributions: JSON.stringify(employerContribs),
        reimbursements: JSON.stringify([]),
        gross_earnings: roundedGross,
        total_deductions: roundedDed,
        net_pay: netPay,
        total_employer_cost: roundedEmployerCost,
        status: "generated",
      });

      totalGross += roundedGross;
      totalDeductions += roundedDed;
      totalNet += netPay;
      totalEmployerContributions += employeeEmployerContributions;
      employeeCount++;
    }

    // #268 — Append a structured note about any employees we had to skip
    // because of empty/invalid salary structure, so the admin sees it
    // immediately in the run summary instead of finding out via support
    // tickets. Preserve any existing notes the admin set when creating
    // the run.
    let runNotes: string | null = run.notes || null;
    if (skipped.length > 0) {
      const skipSummary = `[skipped ${skipped.length} employee(s) — empty/invalid salary structure: ${skipped
        .slice(0, 5)
        .map((s) => s.name)
        .join(", ")}${skipped.length > 5 ? "..." : ""}]`;
      runNotes = runNotes ? `${runNotes}\n${skipSummary}` : skipSummary;
    }
    // BUG-008 — surface the PAN-missing list in the run notes so HR sees
    // it on the run-detail page without having to drill into individual
    // payslips. Run still computes (Section 206AA flat 20% applied).
    if (missingPan.length > 0) {
      const panSummary = `[PAN missing for ${missingPan.length} employee(s) — Section 206AA flat 20% applied: ${missingPan
        .slice(0, 5)
        .map((s) => s.name)
        .join(", ")}${missingPan.length > 5 ? "..." : ""}]`;
      runNotes = runNotes ? `${runNotes}\n${panSummary}` : panSummary;
    }

    // Update payroll run
    await this.db.update("payroll_runs", runId, {
      status: "computed",
      total_gross: totalGross,
      total_deductions: totalDeductions,
      total_net: totalNet,
      total_employer_contributions: totalEmployerContributions,
      employee_count: employeeCount,
      ...(runNotes !== run.notes ? { notes: runNotes } : {}),
    });

    const updated = await this.getRun(runId, orgId);
    // Surface skip + PAN-missing details to the API caller so the UI can
    // show banners. `skipped` are employees whose payslip was NOT generated
    // (empty structure); `missingPan` are employees whose payslip WAS
    // generated but TDS used the 206AA flat rate.
    return { ...updated, skipped, missingPan };
  }

  async approveRun(runId: string, orgId: string, userId: string) {
    const run = await this.getRun(runId, orgId);
    if (run.status !== "computed") {
      throw new AppError(400, "INVALID_STATUS", "Only computed payroll runs can be approved");
    }
    // #1655 — Same guard as createRun/markPaid. Without this, a future-
    // period row that existed before this fix shipped (the production
    // tenant in the report had several) could still flow computed →
    // approved, leaving the lifecycle inconsistent. Blocking here keeps
    // the whole pipeline future-period-free.
    if (isFuturePeriod(run.year, run.month)) {
      throw new AppError(
        400,
        "FUTURE_PERIOD",
        `Cannot approve a future-period run (${run.month}/${run.year} has not started yet)`,
      );
    }
    return this.db.update("payroll_runs", runId, {
      status: "approved",
      approved_by: userId,
      approved_at: new Date(),
    });
  }

  async markPaid(runId: string, orgId: string, opts?: { force?: boolean }) {
    const run = await this.getRun(runId, orgId);
    if (run.status !== "approved") {
      throw new AppError(400, "INVALID_STATUS", "Only approved payroll runs can be marked as paid");
    }
    // #1655 — A run for a future period that somehow got created and
    // approved must not be marked paid. Defense in depth — the validator
    // and createRun guards block creation, but historical bad rows can
    // still exist (the production tenant in the report had Jul/Aug/Dec
    // 2026 runs marked Paid before this fix shipped).
    if (isFuturePeriod(run.year, run.month)) {
      throw new AppError(
        400,
        "FUTURE_PERIOD",
        `Cannot mark a future-period run as paid (${run.month}/${run.year} has not started yet)`,
      );
    }

    // BUG-029 — Bank-details readiness gate. Marking a run as paid
    // without first reconciling bank details meant HR could check off
    // "paid" while several employees had no account/IFSC on file --
    // they'd later complain "I never got my salary" and HR couldn't
    // tell whether the bank rejected the row or it was simply never
    // attempted. Now we list employees on this run who lack a usable
    // account/IFSC pair and refuse the transition unless `force=true`
    // is passed (the override exists for orgs that pay via cheque or
    // cash). The list is returned in the AppError details so the UI
    // can render a fix-then-retry banner.
    if (!opts?.force) {
      const payslipsRes = await this.db.findMany<any>("payslips", {
        filters: { payroll_run_id: runId },
        limit: 10000,
      });
      const offenders: string[] = [];
      for (const ps of payslipsRes.data) {
        if (!ps.empcloud_user_id) continue;
        const profile = await this.db.findOne<any>("employee_payroll_profiles", {
          empcloud_user_id: ps.empcloud_user_id,
        });
        const bank = profile?.bank_details
          ? typeof profile.bank_details === "string"
            ? JSON.parse(profile.bank_details)
            : profile.bank_details
          : {};
        const acct = String(bank?.accountNumber || "").trim();
        const ifsc = String(bank?.ifscCode || "").trim();
        if (!acct || !ifsc) {
          offenders.push(`#${ps.empcloud_user_id}`);
          if (offenders.length >= 10) break;
        }
      }
      if (offenders.length > 0) {
        throw new AppError(
          400,
          "BANK_DETAILS_MISSING",
          `Cannot mark paid: ${offenders.length}+ employee(s) on this run have missing bank details (${offenders.slice(0, 5).join(", ")}${offenders.length > 5 ? "..." : ""}). Fix the bank details on each employee profile and retry, or pass force=true to override (for cheque/cash payouts).`,
          { offenders },
        );
      }
    }

    await this.db.updateMany("payslips", { payroll_run_id: runId }, { status: "paid" });
    return this.db.update("payroll_runs", runId, { status: "paid" });
  }

  async cancelRun(runId: string, orgId: string) {
    const run = await this.getRun(runId, orgId);
    if (run.status === "paid") {
      throw new AppError(400, "INVALID_STATUS", "Paid payroll runs cannot be cancelled");
    }
    await this.db.deleteMany("payslips", { payroll_run_id: runId });
    return this.db.update("payroll_runs", runId, { status: "cancelled" });
  }

  async revertToDraft(runId: string, orgId: string) {
    const run = await this.getRun(runId, orgId);
    if (run.status === "paid") {
      throw new AppError(
        400,
        "INVALID_STATUS",
        "Paid payroll runs cannot be reverted. Cancel and create a new run.",
      );
    }
    if (run.status === "draft") {
      throw new AppError(400, "ALREADY_DRAFT", "Payroll run is already in draft status");
    }
    if (run.status === "cancelled") {
      return this.db.update("payroll_runs", runId, { status: "draft" });
    }
    await this.db.deleteMany("payslips", { payroll_run_id: runId });
    return this.db.update("payroll_runs", runId, {
      status: "draft",
      total_gross: 0,
      total_deductions: 0,
      total_net: 0,
      total_employer_contributions: 0,
      employee_count: 0,
    });
  }

  /**
   * Re-run a payroll regardless of status -- the "if something went wrong"
   * escape hatch. Wipes payslips, resets totals, and flips status back to
   * draft so the user can recompute. Unlike revertToDraft, this also
   * accepts `paid` runs (with the assumption HR knows what they're doing
   * since the operation is gated by hr_admin and the UI confirm modal
   * spells out the consequences). For `draft` runs it is a no-op except
   * to reset stale totals.
   */
  /**
   * Walk every payslip in a run, restore the loans + reimbursements that
   * were stamped on them, and return the counts. Pulled out of deleteRun
   * so rerunRun can use the same logic — without it, re-running would
   * wipe payslips but leave loan balances / reimbursement statuses
   * untouched, so the next compute would deduct the same EMI on top of
   * an already-reduced outstanding (double-debit) and skip the
   * reimbursement entirely (already-paid).
   *
   * Idempotent: each LOAN deduction line stores a snapshot of the
   * pre-payslip state in meta.{previous_outstanding,
   * previous_installments_paid, previous_status}; replaying the same
   * snapshot twice writes the same values. Same for REIMB earnings.
   */
  private async revertLoansAndReimbursementsForRun(runId: string): Promise<{
    loansReverted: number;
    untrackedLoanLines: number;
    reimbursementsReverted: number;
    untrackedReimbLines: number;
  }> {
    const payslipsRes = await this.db.findMany<any>("payslips", {
      filters: { payroll_run_id: runId },
      limit: 100000,
    });
    let loansReverted = 0;
    let untrackedLoanLines = 0;
    let reimbursementsReverted = 0;
    let untrackedReimbLines = 0;
    for (const p of payslipsRes.data) {
      const rawDeductions =
        typeof p.deductions === "string" ? JSON.parse(p.deductions) : p.deductions || [];
      if (Array.isArray(rawDeductions)) {
        for (const d of rawDeductions) {
          if (!d || d.code !== "LOAN") continue;
          const meta = d.meta || {};
          if (!meta.loan_id) {
            untrackedLoanLines++;
            continue;
          }
          const updateData: Record<string, any> = {
            outstanding_amount: Number(meta.previous_outstanding ?? 0),
            installments_paid: Number(meta.previous_installments_paid ?? 0),
          };
          if (meta.previous_status) updateData.status = meta.previous_status;
          await this.db.update("loans", String(meta.loan_id), updateData);
          loansReverted++;
        }
      }

      const rawEarnings =
        typeof p.earnings === "string" ? JSON.parse(p.earnings) : p.earnings || [];
      if (Array.isArray(rawEarnings)) {
        for (const e of rawEarnings) {
          if (!e || e.code !== "REIMB") continue;
          const meta = e.meta || {};
          if (!meta.reimbursement_id) {
            untrackedReimbLines++;
            continue;
          }
          await this.db.update("reimbursements", String(meta.reimbursement_id), {
            status: meta.previous_status ?? "approved",
            paid_in_month: meta.previous_paid_in_month ?? null,
            paid_in_year: meta.previous_paid_in_year ?? null,
          });
          reimbursementsReverted++;
        }
      }
    }
    return { loansReverted, untrackedLoanLines, reimbursementsReverted, untrackedReimbLines };
  }

  async rerunRun(runId: string, orgId: string) {
    const run = await this.getRun(runId, orgId);
    // BUG-005 — Capture how many payslips were wiped + whether the run
    // had been previously emailed so the response can warn HR. Once
    // rerun completes, any payslip PDFs that were previously
    // downloaded or emailed are stale: the URLs 404 (payslip rows
    // deleted) and the next compute will produce different numbers.
    // We can't recall an email, but we can: (a) tell the caller how
    // many payslips just became stale, (b) record that fact in the
    // run's notes so it shows up on the run-detail page forever.
    let priorPayslipCount = 0;
    let priorStatus = run.status;
    // Loan/reimbursement revert counts so the route can surface them in
    // the response (same shape deleteRun returns). Zero by default for
    // draft runs (nothing was stamped to roll back).
    let loansReverted = 0;
    let untrackedLoanLines = 0;
    let reimbursementsReverted = 0;
    let untrackedReimbLines = 0;
    if (run.status !== "draft") {
      const priorRes = await this.db.findMany<any>("payslips", {
        filters: { payroll_run_id: runId },
        limit: 1,
      });
      priorPayslipCount = Number(priorRes?.total) || 0;
      // BUG-Rerun-Loans — Roll loans + reimbursements BACK to their
      // pre-payslip state BEFORE deleting the payslips. Without this,
      // re-computing the run would deduct each loan EMI again on top of
      // an outstanding balance that already reflected the first
      // computation (double-debit), and reimbursements would stay in
      // 'paid' so the engine wouldn't re-attach them to the new
      // payslip. Same helper deleteRun uses — idempotent so safe to
      // call repeatedly.
      const reverted = await this.revertLoansAndReimbursementsForRun(runId);
      loansReverted = reverted.loansReverted;
      untrackedLoanLines = reverted.untrackedLoanLines;
      reimbursementsReverted = reverted.reimbursementsReverted;
      untrackedReimbLines = reverted.untrackedReimbLines;
      // Wipe computed payslips so a fresh compute starts from zero. We
      // intentionally permit this for `paid` runs because the alternative
      // (cancel + create new run) loses the original period reference and
      // breaks salary continuity for any downstream report keyed off this
      // run's id.
      await this.db.deleteMany("payslips", { payroll_run_id: runId });
    }
    let updatedNotes: string | null = run.notes || null;
    if (priorPayslipCount > 0) {
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      const warning = `[rerun ${stamp} UTC — wiped ${priorPayslipCount} payslip(s) from prior ${priorStatus} state; reverted ${loansReverted} loan(s), ${reimbursementsReverted} reimbursement(s); previously generated/emailed PDFs are now stale]`;
      updatedNotes = updatedNotes ? `${updatedNotes}\n${warning}` : warning;
    }
    const updated = await this.db.update("payroll_runs", runId, {
      status: "draft",
      total_gross: 0,
      total_deductions: 0,
      total_net: 0,
      total_employer_contributions: 0,
      employee_count: 0,
      ...(updatedNotes !== run.notes ? { notes: updatedNotes } : {}),
    });
    return {
      ...updated,
      // Surface to the caller so the UI can render a warning toast.
      _rerun_warning: priorPayslipCount
        ? {
            wiped_payslips: priorPayslipCount,
            prior_status: priorStatus,
            loans_reverted: loansReverted,
            untracked_loan_lines: untrackedLoanLines,
            reimbursements_reverted: reimbursementsReverted,
            untracked_reimbursement_lines: untrackedReimbLines,
            message: `${priorPayslipCount} previously generated payslip(s) were deleted, ${loansReverted} loan(s) and ${reimbursementsReverted} reimbursement(s) rolled back. Any PDFs already emailed to employees are now out of date — re-send after the next compute.`,
          }
        : null,
    } as any;
  }

  /**
   * Hard-delete a payroll run and all its payslips. Destructive, so the
   * route is gated by hr_admin AND the UI requires an explicit
   * type-to-confirm modal. There is no undo: payslips are wiped, the run
   * row is wiped, and any historical payslip URLs / report links for the
   * run will 404 afterwards.
   *
   * Returns the deleted run row's identifying fields so the caller can
   * confirm what was removed (used by the audit log on the API layer).
   */
  async deleteRun(runId: string, orgId: string) {
    // getRun already enforces org-scoping (404 if the run doesn't belong
    // to this org), so by the time we delete we know the row is the
    // caller's. Use deleteMany with both id and org constraint as a
    // belt-and-braces guard against any future change to the adapter
    // delete() signature, which currently doesn't accept an org filter.
    const run = await this.getRun(runId, orgId);

    // Revert loans + reimbursements stamped on this run's payslips BEFORE
    // deleting the payslips. Same helper rerunRun uses — see its docs
    // for the snapshot / idempotency rationale. Older payslips whose
    // LOAN / REIMB lines don't carry meta (pre-stamping era) are
    // reported as untracked so the audit log can flag them for manual
    // reconciliation.
    const { loansReverted, untrackedLoanLines, reimbursementsReverted, untrackedReimbLines } =
      await this.revertLoansAndReimbursementsForRun(runId);

    const payslipCount = await this.db.deleteMany("payslips", { payroll_run_id: runId });
    await this.db.deleteMany("payroll_runs", { id: runId, empcloud_org_id: Number(orgId) });
    return {
      id: run.id,
      code: run.code,
      month: run.month,
      year: run.year,
      status: run.status,
      payslips_deleted: payslipCount,
      loans_reverted: loansReverted,
      untracked_loan_lines: untrackedLoanLines,
      reimbursements_reverted: reimbursementsReverted,
      untracked_reimbursement_lines: untrackedReimbLines,
    };
  }

  async getRunSummary(runId: string, orgId: string) {
    const run = await this.getRun(runId, orgId);
    const payslips = await this.db.findMany<any>("payslips", {
      filters: { payroll_run_id: runId },
      limit: 1000,
    });
    return {
      ...run,
      payslipCount: payslips.total,
    };
  }

  async getRunPayslips(runId: string, orgId: string) {
    // Verify the run belongs to this org before returning payslips
    await this.getRun(runId, orgId);

    // Get payslips from payroll DB
    const payslips = await this.db.findMany<any>("payslips", {
      filters: { payroll_run_id: runId },
      limit: 1000,
    });

    // Enrich with employee info from EmpCloud
    const ecDb = getEmpCloudDB();
    const data = [];
    for (const p of payslips.data) {
      const empcloudUserId = p.empcloud_user_id;
      let empInfo: any = {};
      if (empcloudUserId) {
        empInfo =
          (await ecDb("users")
            .where({ id: empcloudUserId })
            .select("first_name", "last_name", "emp_code", "designation", "department_id")
            .first()) || {};
      }

      let deptName: string | null = null;
      if (empInfo.department_id) {
        const dept = await ecDb("organization_departments")
          .where({ id: empInfo.department_id })
          .first();
        deptName = dept?.name || null;
      }

      data.push({
        ...p,
        first_name: empInfo.first_name || null,
        last_name: empInfo.last_name || null,
        employee_code: empInfo.emp_code || null,
        designation: empInfo.designation || null,
        department: deptName,
        earnings: typeof p.earnings === "string" ? JSON.parse(p.earnings) : p.earnings,
        deductions: typeof p.deductions === "string" ? JSON.parse(p.deductions) : p.deductions,
        employer_contributions:
          typeof p.employer_contributions === "string"
            ? JSON.parse(p.employer_contributions)
            : p.employer_contributions,
        reimbursements:
          typeof p.reimbursements === "string" ? JSON.parse(p.reimbursements) : p.reimbursements,
      });
    }

    return { data, total: data.length, page: 1, limit: 1000, totalPages: 1 };
  }
}
