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

    // Get active employees from EmpCloud
    const ecEmployees = await findUsersByOrgId(Number(orgId), { limit: 1000 });

    // Org-wide working-days-in-month, computed ONCE for the whole run so
    // every employee shares the same denominator. Previously each employee
    // recomputed their own value AND an imported attendance_summaries row
    // could override it with a different number, so two employees in the
    // same month could end up with totalDays = 21 vs 22 -- a mismatch HR
    // surfaced as BUG-024. Holidays from `organization_holidays` are
    // subtracted from the weekday count to cover BUG-025 (Good Friday
    // wasn't reducing the working-days base).
    //
    // Migration 035 — orgs that operate on weekends can opt in to count
    // Sat/Sun as working days. When they do, those weekend days are PAID
    // rest days: they go into the working-days base AND are credited to
    // every employee's paidDays below, so they never fall into LOP just
    // because no attendance is clocked on a weekend. Default (false) keeps
    // the long-standing weekday-only base and ignores weekends entirely.
    const includeWeekends = !!Number(orgSettings?.include_weekends_in_working_days);
    const daysInMonth = new Date(run.year, run.month, 0).getDate();
    // Classify every day of the month once: Mon–Fri vs Sat/Sun.
    let strictWeekdayCount = 0;
    let weekendDayCount = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(run.year, run.month - 1, d).getDay();
      if (dow === 0 || dow === 6) weekendDayCount++;
      else strictWeekdayCount++;
    }
    const empcloudDb = getEmpCloudDB();
    const monthStart = `${run.year}-${String(run.month).padStart(2, "0")}-01`;
    // TZ-safe month end. `new Date(...).toISOString()` shifts "April 30"
    // to "2026-04-29" on any UTC+ server, which silently dropped the last
    // calendar day from the attendance/holiday window — an employee
    // present on the 30th came out one day short. `getDate()` is a local
    // getter, so build the string from it instead.
    const monthEnd = `${run.year}-${String(run.month).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
    const orgHolidaysRows = await empcloudDb("organization_holidays")
      .where("organization_id", Number(orgId))
      .whereBetween("holiday_date", [monthStart, monthEnd])
      .select("holiday_date");
    // Split holidays by where they land. Weekday holidays always reduce
    // the base; weekend holidays only matter when the org counts weekends.
    // Dedup on a YYYY-MM-DD string built from local getters (not
    // toISOString — same TZ trap) to handle Date/string returns from mysql2.
    const holidaySeen = new Set<string>();
    let weekdayHolidayCount = 0;
    let weekendHolidayCount = 0;
    for (const h of orgHolidaysRows) {
      const hd = h.holiday_date;
      const dStr =
        typeof hd === "string"
          ? hd.slice(0, 10)
          : `${hd.getFullYear()}-${String(hd.getMonth() + 1).padStart(2, "0")}-${String(hd.getDate()).padStart(2, "0")}`;
      if (holidaySeen.has(dStr)) continue;
      holidaySeen.add(dStr);
      const [y, m, d] = dStr.split("-").map(Number);
      const dow = new Date(y, m - 1, d).getDay();
      if (dow === 0 || dow === 6) weekendHolidayCount++;
      else weekdayHolidayCount++;
    }
    // Working-days base (the per-employee denominator):
    //  - default        : Mon–Fri minus weekday holidays.
    //  - includeWeekends : every calendar day minus every holiday.
    const workingDaysInMonth = includeWeekends
      ? Math.max(1, daysInMonth - weekdayHolidayCount - weekendHolidayCount)
      : Math.max(1, strictWeekdayCount - weekdayHolidayCount);
    // Weekend rest days auto-credited as paid when the org opts in.
    // Weekend holidays are already out of the base, so don't double-count.
    const autoPaidWeekendDays = includeWeekends
      ? Math.max(0, weekendDayCount - weekendHolidayCount)
      : 0;

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
      const doe = isoDate(ecAny.date_of_exit);
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

      // (workingDaysInMonth + holiday count are hoisted above this loop --
      //  see the orgHolidays / workingDaysInMonth declarations.)

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
      //
      // The org-wide `workingDaysInMonth` (already hoisted above) is
      // the canonical totalDays for every employee in the run.
      const [attRecord] = (await empcloudDb("attendance_records")
        .where("user_id", ecEmp.id)
        .where("organization_id", Number(orgId))
        .whereBetween("date", [startDate, endDate])
        .select(
          // BUG-Leave-LOP — `half_present_half_leave` (HPL) added to the
          // present-days bucket as 0.5 too, otherwise an employee marked
          // HPL on the grid lost both halves: the 0.5 present half wasn't
          // counted as present AND the 0.5 leave half (handled below) was
          // wrongly booked as LOP.
          empcloudDb.raw(
            "SUM(CASE WHEN status IN ('present','checked_in') THEN 1 " +
              "WHEN status IN ('half_day','half_present_half_leave') THEN 0.5 " +
              "ELSE 0 END) as present_days",
          ),
          empcloudDb.raw("SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent_days"),
          // `leave_days` = days marked as 'on_leave' on the attendance row.
          // HPL contributes 0.5 here too. The engine treats these as PAID by
          // default unless an explicit UNPAID leave_application exists for
          // the same range (handled in the merge below) -- HR who marks L
          // directly on the grid never picks an "unpaid" type, so treating
          // these as paid matches HR's intent.
          empcloudDb.raw(
            "SUM(CASE WHEN status = 'on_leave' THEN 1 " +
              "WHEN status = 'half_present_half_leave' THEN 0.5 " +
              "ELSE 0 END) as leave_days",
          ),
          empcloudDb.raw("COUNT(*) as total_records"),
          // BUG-Weekend-LOP — count weekend rows (Sat/Sun) that already
          // have ANY attendance status. Used below to avoid double-
          // counting weekends when the org has include_weekends_in_
          // working_days=1: presentDays already includes every weekend
          // that was clocked, so the auto-paid-weekend credit must only
          // fill the genuine un-clocked-weekend gap. DAYOFWEEK is MySQL:
          // 1=Sun, 7=Sat.
          empcloudDb.raw(
            "SUM(CASE WHEN DAYOFWEEK(date) IN (1, 7) THEN 1 ELSE 0 END) as weekend_records",
          ),
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
        }
        // else: presentDays stays 0 (initialised above). The guard at the
        // empty-structure / zero-earnings check below pushes the row to
        // skipped[] with code NO_ATTENDANCE so HR sees it on the run-
        // detail banner. No payslip is generated.
      }

      const totalDays = workingDaysInMonth;
      // Cap presentDays at totalDays so an over-imported row (e.g. 30
      // present days against 22 working days) doesn't push proRatio
      // above 1 and inflate gross beyond CTC.
      if (presentDays > totalDays) presentDays = totalDays;
      // Migration 035 — when the org counts weekends as working days, the
      // Sat/Sun rest days are PAID. Fold autoPaidWeekendDays into paidDays
      // (NOT presentDays — mutating presentDays would mask the genuine
      // zero-attendance case the NO_ATTENDANCE guard below depends on).
      // Without this the weekend gap (totalDays − presentDays) is wrongly
      // booked as LOP for an employee who was never actually absent.
      //
      // BUG-Weekend-LOP — only auto-credit weekends that DON'T already
      // have an attendance row. If HR clocks Sat/Sun (presentDays
      // already includes them), adding the full autoPaidWeekendDays on
      // top over-counts. The min(..., totalDays) cap then hides the
      // over-count and erases legitimate weekday LOP -- e.g. an employee
      // present every weekend but absent on 2 weekdays came out with
      // lop_days=0 because (weekdaysPresent + weekendsClocked + autoPaid
      // = workingDays).
      const weekendRecordsAlreadyCounted = Number(attRecord?.weekend_records || 0);
      const effectiveAutoPaidWeekend = Math.max(
        0,
        autoPaidWeekendDays - weekendRecordsAlreadyCounted,
      );
      const paidDays = Math.min(presentDays + paidLeaveDays + effectiveAutoPaidWeekend, totalDays);
      const lopDays = Math.max(0, totalDays - paidDays);

      // Parse salary components
      const components =
        typeof salary.components === "string" ? JSON.parse(salary.components) : salary.components;
      const componentList = Array.isArray(components) ? components : [];

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
      const earnings: any[] = [];
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
          grossSalary: grossEarnings,
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

      // Professional Tax. Two per-employee escape hatches:
      //   - tax_info.deductPT === false: skip entirely (e.g. employee
      //     in a no-PT state like Delhi/Haryana even though the org's
      //     primary state has PT)
      //   - tax_info.state: override the org state for slab lookup so
      //     a Bangalore-HQ company with a Mumbai-resident employee
      //     applies Maharashtra slabs to that one person.
      if (taxInfo?.deductPT !== false) {
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
        if (!Array.isArray(dedList)) continue;
        for (const d of dedList) {
          if (d?.code === "TDS") taxAlreadyPaid += Number(d.amount) || 0;
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

        const taxResult = computeIncomeTax({
          employeeId: String(ecEmp.id),
          financialYear: runFy,
          regime: taxInfo?.regime === "old" ? TaxRegime.OLD : TaxRegime.NEW,
          annualGross: Number(salary.gross_salary) + priorEmployerGross,
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
          const emi = Math.round(Number(loan.emi_amount));
          if (emi > 0) {
            deductions.push({
              code: "LOAN",
              name: `Loan EMI — ${loan.type || "Loan"}`,
              amount: emi,
            });
            totalDed += emi;
            // Update loan tracking
            await this.db.update("loans", loan.id, {
              installments_paid: (Number(loan.installments_paid) || 0) + 1,
              outstanding_amount: Math.max(0, Number(loan.outstanding_amount) - emi),
              ...(Number(loan.outstanding_amount) - emi <= 0 ? { status: "completed" } : {}),
            });
          }
        }
        if (activeLoans.data.length > 0) break; // Found loans, don't query again
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
    if (run.status !== "draft") {
      const priorRes = await this.db.findMany<any>("payslips", {
        filters: { payroll_run_id: runId },
        limit: 1,
      });
      priorPayslipCount = Number(priorRes?.total) || 0;
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
      const warning = `[rerun ${stamp} UTC — wiped ${priorPayslipCount} payslip(s) from prior ${priorStatus} state; previously generated/emailed PDFs are now stale]`;
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
            message: `${priorPayslipCount} previously generated payslip(s) were deleted. Any PDFs already emailed to employees are now out of date — re-send after the next compute.`,
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
    const payslipCount = await this.db.deleteMany("payslips", { payroll_run_id: runId });
    await this.db.deleteMany("payroll_runs", { id: runId, empcloud_org_id: Number(orgId) });
    return {
      id: run.id,
      code: run.code,
      month: run.month,
      year: run.year,
      status: run.status,
      payslips_deleted: payslipCount,
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
