import { getDB } from "../db/adapters";
import { getEmpCloudDB } from "../db/empcloud";
import { AppError } from "../api/middleware/error.middleware";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

// Fallback when an employee has no `location_id` or the location row
// has no timezone configured. India default keeps existing single-region
// orgs running unchanged. Multi-region orgs override per-location via
// `organization_locations.timezone` (IANA: "Asia/Kolkata", "America/Chicago", ...).
const DEFAULT_TIMEZONE = "Asia/Kolkata";

/**
 * Format a SQL DATE value (string OR JS Date) as YYYY-MM-DD in the
 * supplied IANA timezone. Used everywhere we compare attendance row
 * dates -- toISOString() shifts dates by the server's UTC offset and
 * silently breaks dedupe sets (a row stored as 2026-05-01 in IST
 * becomes "2026-04-30" when stringified through UTC). Honoring the
 * employee's location timezone (rather than the server's local time)
 * also keeps multi-region orgs correct -- a Chicago-based employee's
 * "May 1" stays May 1 regardless of where the payroll server runs.
 */
function dateToIso(v: unknown, tz: string = DEFAULT_TIMEZONE): string {
  if (v == null) return "";
  if (typeof v === "string") return v.slice(0, 10);
  const d = v instanceof Date ? v : new Date(v as any);
  if (Number.isNaN(d.getTime())) return "";
  return dayjs(d).tz(tz).format("YYYY-MM-DD");
}

/**
 * Last calendar day of a month as a YYYY-MM-DD string. Built from
 * `getDate()` (a local getter) rather than `new Date(...).toISOString()`,
 * which shifts "April 30" to "2026-04-29" on any UTC+ server and silently
 * dropped the last day of the month from attendance date-range queries.
 */
function monthEndIso(year: number, month: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

export class AttendanceService {
  private db = getDB();

  /**
   * Get attendance summary for a single employee from EmpCloud's attendance_records.
   * Falls back to local attendance_summaries if EmpCloud has no data.
   */
  async getSummary(employeeId: string, month?: number, year?: number) {
    if (month && year) {
      // #397 — Fetch both sources in parallel, then merge. The cloud result
      // carries per-day aggregates (present / absent / leave / overtime
      // minutes from EmpCloud's attendance_records). The local row carries
      // HR's manual overrides for fields EmpCloud doesn't model (lop_days
      // entered through the Mark Attendance popup, overtime_hours /
      // overtime_rate / overtime_amount, holidays, weekoffs). Previously
      // this method short-circuited on `cloud` and never consulted the
      // local row -- so manually-entered LOP and overtime values silently
      // disappeared the moment any present/absent row landed in EmpCloud.
      const [cloud, local] = await Promise.all([
        this.getFromEmpCloud(Number(employeeId), month, year),
        this.db
          .findOne<any>("attendance_summaries", {
            empcloud_user_id: Number(employeeId),
            month,
            year,
          })
          .catch(() => null),
      ]);

      if (!cloud && !local) {
        throw new AppError(404, "NOT_FOUND", "Attendance summary not found");
      }
      if (!cloud) return local;
      if (!local) return cloud;

      // Both sides exist — merge, preferring local for the HR-manual fields.
      const localLop = Number(local.lop_days) || 0;
      const localOt = Number(local.overtime_hours) || 0;
      return {
        ...cloud,
        lop_days: localLop > 0 ? localLop : Number(cloud.lop_days) || 0,
        overtime_hours: localOt > 0 ? localOt : Number(cloud.overtime_hours) || 0,
        overtime_rate: Number(local.overtime_rate) || Number(cloud.overtime_rate) || 0,
        overtime_amount: Number(local.overtime_amount) || Number(cloud.overtime_amount) || 0,
        holidays: Number(local.holidays) || Number(cloud.holidays) || 0,
        weekoffs: Number(local.weekoffs) || Number(cloud.weekoffs) || 0,
      };
    }

    return this.db.findMany<any>("attendance_summaries", {
      filters: { empcloud_user_id: Number(employeeId) },
      sort: { field: "year", order: "desc" },
    });
  }

  /**
   * Get bulk attendance summaries for all employees in an org.
   * Queries EmpCloud's attendance_records + leave_applications directly.
   */
  async bulkSummary(orgId: string, month: number, year: number) {
    const empcloudDb = getEmpCloudDB();
    const orgIdNum = Number(orgId);
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDate = monthEndIso(year, month);
    const totalWorkingDays = this.getWorkingDaysInMonth(month, year);

    // Get attendance summary from EmpCloud
    const records = await empcloudDb("attendance_records as ar")
      .join("users as u", function () {
        this.on("ar.user_id", "u.id").andOn("ar.organization_id", "u.organization_id");
      })
      .leftJoin("organization_departments as dept", "u.department_id", "dept.id")
      .where("ar.organization_id", orgIdNum)
      .where("u.status", 1)
      .whereNot("u.role", "super_admin")
      .whereBetween("ar.date", [startDate, endDate])
      .select(
        "ar.user_id as empcloud_user_id",
        "u.first_name",
        "u.last_name",
        "u.emp_code",
        empcloudDb.raw("? as month", [month]),
        empcloudDb.raw("? as year", [year]),
        empcloudDb.raw("? as total_days", [totalWorkingDays]),
        empcloudDb.raw(
          "SUM(CASE WHEN ar.status IN ('present','checked_in') THEN 1 ELSE 0 END) as present_days",
        ),
        empcloudDb.raw("SUM(CASE WHEN ar.status = 'half_day' THEN 1 ELSE 0 END) as half_days"),
        empcloudDb.raw("SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END) as absent_days"),
        empcloudDb.raw("SUM(CASE WHEN ar.status = 'on_leave' THEN 1 ELSE 0 END) as leave_days"),
        empcloudDb.raw("ROUND(SUM(COALESCE(ar.overtime_minutes, 0)) / 60, 1) as overtime_hours"),
      )
      .groupBy("ar.user_id", "u.first_name", "u.last_name", "u.emp_code");

    if (records.length === 0) {
      // No attendance records in EmpCloud for this month. #308 — but the
      // local `attendance_summaries` table may have rows from "Mark All
      // Present" writes; surface those before falling back to all-zero.
      const users = await empcloudDb("users")
        .where({ organization_id: orgIdNum, status: 1 })
        .whereNot("role", "super_admin")
        .select("id as empcloud_user_id", "first_name", "last_name", "emp_code");

      const localOverrides = await this.db.findMany<any>("attendance_summaries", {
        filters: { month, year },
        limit: 10000,
      });
      const localMap: Record<number, any> = {};
      for (const r of localOverrides.data) {
        if (r.empcloud_user_id != null) localMap[Number(r.empcloud_user_id)] = r;
      }

      const data = users.map((u: any) => {
        const local = localMap[u.empcloud_user_id];
        if (local) {
          return {
            ...u,
            month,
            year,
            total_days: Number(local.total_days) || totalWorkingDays,
            present_days: Number(local.present_days) || 0,
            half_days: Number(local.half_days) || 0,
            absent_days: Number(local.absent_days) || 0,
            leave_days: Number(local.paid_leave || 0) + Number(local.unpaid_leave || 0),
            overtime_hours: Number(local.overtime_hours) || 0,
            paid_leave: Number(local.paid_leave) || 0,
            unpaid_leave: Number(local.unpaid_leave) || 0,
            lop_days: Number(local.lop_days) || 0,
            holidays: Number(local.holidays) || 0,
            weekoffs: Number(local.weekoffs) || 0,
            overtime_rate: Number(local.overtime_rate) || 0,
            overtime_amount: Number(local.overtime_amount) || 0,
          };
        }
        return {
          ...u,
          month,
          year,
          total_days: totalWorkingDays,
          present_days: 0,
          half_days: 0,
          absent_days: 0,
          leave_days: 0,
          overtime_hours: 0,
          paid_leave: 0,
          unpaid_leave: 0,
          lop_days: 0,
          holidays: 0,
          weekoffs: 0,
          overtime_rate: 0,
          overtime_amount: 0,
        };
      });

      return { data, total: data.length, page: 1, limit: 1000, totalPages: 1 };
    }

    // Get approved leaves from EmpCloud for the same period
    const leaves = await empcloudDb("leave_applications as la")
      .join("leave_types as lt", "la.leave_type_id", "lt.id")
      .where("la.organization_id", orgIdNum)
      .where("la.status", "approved")
      .where("la.start_date", "<=", endDate)
      .where("la.end_date", ">=", startDate)
      .select("la.user_id", "la.days_count", "lt.is_paid");

    // Build a leave map: userId -> { paid, unpaid }
    const leaveMap: Record<number, { paid: number; unpaid: number }> = {};
    for (const leave of leaves) {
      if (!leaveMap[leave.user_id]) leaveMap[leave.user_id] = { paid: 0, unpaid: 0 };
      if (leave.is_paid) {
        leaveMap[leave.user_id].paid += Number(leave.days_count);
      } else {
        leaveMap[leave.user_id].unpaid += Number(leave.days_count);
      }
    }

    // #109 — The query above INNER JOINs attendance_records and users, so
    // only employees who have at least one attendance row for this month
    // appear. Meanwhile the Mark Attendance popup pulls employees from
    // /employees (every active payroll user), and the dashboard was
    // comparing the two. The result: popup shows 10 employees, dashboard
    // shows 3 (the ones who already have records). Merge a full-user row
    // set into the output so both lists match.
    const allUsers = await empcloudDb("users")
      .where({ organization_id: orgIdNum, status: 1 })
      .whereNot("role", "super_admin")
      .select("id as empcloud_user_id", "first_name", "last_name", "emp_code");

    const recordMap: Record<number, any> = {};
    for (const r of records) recordMap[r.empcloud_user_id] = r;

    // #308 — Mark All Present writes to the local `attendance_summaries`
    // table (importRecords), but bulkSummary previously only read from
    // EmpCloud's `attendance_records`. The result was a "Marked successful"
    // toast followed by an unchanged dashboard. Pull the local override
    // rows for this period and use them as a fallback for users who
    // have no EmpCloud rows yet.
    const localOverrides = await this.db.findMany<any>("attendance_summaries", {
      filters: { month, year },
      limit: 10000,
    });
    const localMap: Record<number, any> = {};
    for (const r of localOverrides.data) {
      if (r.empcloud_user_id != null) localMap[Number(r.empcloud_user_id)] = r;
    }

    const enriched = allUsers.map((u: any) => {
      const r = recordMap[u.empcloud_user_id];
      const userLeave = leaveMap[u.empcloud_user_id] || { paid: 0, unpaid: 0 };
      if (r) {
        // #397 — When EmpCloud has any attendance row, this branch used to
        // drop the local `attendance_summaries` overrides entirely, so
        // HR's manually-entered `lop_days`, `overtime_hours`,
        // `overtime_rate`, and `overtime_amount` never made it to the
        // dashboard (only `present`/`absent` are projected to EmpCloud's
        // per-day attendance_records). Still consult the local row and
        // prefer it for fields EmpCloud doesn't carry. Order of precedence
        // per field: explicit HR input (local) → EmpCloud aggregate (where
        // applicable) → leave-applications fallback → zero.
        const local = localMap[u.empcloud_user_id];
        const localLop = local ? Number(local.lop_days) : 0;
        const localOt = local ? Number(local.overtime_hours) : 0;
        return {
          ...r,
          paid_leave: userLeave.paid,
          unpaid_leave: userLeave.unpaid,
          lop_days: localLop > 0 ? localLop : userLeave.unpaid,
          holidays: local ? Number(local.holidays) || 0 : 0,
          weekoffs: local ? Number(local.weekoffs) || 0 : 0,
          // EmpCloud `attendance_records.overtime_minutes` is aggregated into
          // `r.overtime_hours` by the SELECT above; fall back to it if HR
          // didn't enter an explicit override.
          overtime_hours: localOt > 0 ? localOt : Number(r.overtime_hours) || 0,
          overtime_rate: local ? Number(local.overtime_rate) || 0 : 0,
          overtime_amount: local ? Number(local.overtime_amount) || 0 : 0,
        };
      }
      const local = localMap[u.empcloud_user_id];
      if (local) {
        return {
          empcloud_user_id: u.empcloud_user_id,
          first_name: u.first_name,
          last_name: u.last_name,
          emp_code: u.emp_code,
          month,
          year,
          total_days: Number(local.total_days) || totalWorkingDays,
          present_days: Number(local.present_days) || 0,
          half_days: Number(local.half_days) || 0,
          absent_days: Number(local.absent_days) || 0,
          leave_days: Number(local.paid_leave || 0) + Number(local.unpaid_leave || 0),
          overtime_hours: Number(local.overtime_hours) || 0,
          paid_leave: Number(local.paid_leave) || userLeave.paid,
          unpaid_leave: Number(local.unpaid_leave) || userLeave.unpaid,
          lop_days: Number(local.lop_days) || userLeave.unpaid,
          holidays: Number(local.holidays) || 0,
          weekoffs: Number(local.weekoffs) || 0,
          overtime_rate: Number(local.overtime_rate) || 0,
          overtime_amount: Number(local.overtime_amount) || 0,
        };
      }
      // Employee has no attendance rows this month — surface as a
      // zero-row so the dashboard and the Mark Attendance popup agree on
      // who is present in the org.
      return {
        empcloud_user_id: u.empcloud_user_id,
        first_name: u.first_name,
        last_name: u.last_name,
        emp_code: u.emp_code,
        month,
        year,
        total_days: totalWorkingDays,
        present_days: 0,
        half_days: 0,
        absent_days: 0,
        leave_days: 0,
        overtime_hours: 0,
        paid_leave: userLeave.paid,
        unpaid_leave: userLeave.unpaid,
        lop_days: userLeave.unpaid,
        holidays: 0,
        weekoffs: 0,
        overtime_rate: 0,
        overtime_amount: 0,
      };
    });

    return { data: enriched, total: enriched.length, page: 1, limit: 1000, totalPages: 1 };
  }

  /**
   * Fetch a single employee's attendance from EmpCloud.
   */
  private async getFromEmpCloud(userId: number, month: number, year: number) {
    try {
      const empcloudDb = getEmpCloudDB();
      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const endDate = monthEndIso(year, month);
      const totalWorkingDays = this.getWorkingDaysInMonth(month, year);

      const [record] = (await empcloudDb("attendance_records")
        .where("user_id", userId)
        .whereBetween("date", [startDate, endDate])
        .select(
          empcloudDb.raw("? as empcloud_user_id", [userId]),
          empcloudDb.raw("? as month", [month]),
          empcloudDb.raw("? as year", [year]),
          empcloudDb.raw("? as total_days", [totalWorkingDays]),
          empcloudDb.raw(
            "SUM(CASE WHEN status IN ('present','checked_in') THEN 1 ELSE 0 END) as present_days",
          ),
          empcloudDb.raw("SUM(CASE WHEN status = 'half_day' THEN 1 ELSE 0 END) as half_days"),
          empcloudDb.raw("SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent_days"),
          empcloudDb.raw("SUM(CASE WHEN status = 'on_leave' THEN 1 ELSE 0 END) as leave_days"),
          empcloudDb.raw("ROUND(SUM(COALESCE(overtime_minutes, 0)) / 60, 1) as overtime_hours"),
        )) as any[];

      if (!record || !record.present_days) return null;

      // Get leave data
      const leaves = await empcloudDb("leave_applications as la")
        .join("leave_types as lt", "la.leave_type_id", "lt.id")
        .where("la.user_id", userId)
        .where("la.status", "approved")
        .where("la.start_date", "<=", endDate)
        .where("la.end_date", ">=", startDate)
        .select("la.days_count", "lt.is_paid");

      let paidLeave = 0;
      let unpaidLeave = 0;
      for (const l of leaves) {
        if (l.is_paid) paidLeave += Number(l.days_count);
        else unpaidLeave += Number(l.days_count);
      }

      return {
        ...record,
        paid_leave: paidLeave,
        unpaid_leave: unpaidLeave,
        lop_days: unpaidLeave,
        holidays: 0,
        weekoffs: 0,
        overtime_rate: 0,
        overtime_amount: 0,
      };
    } catch {
      return null;
    }
  }

  async importRecords(orgId: string, month: number, year: number, records: any[]) {
    // Bi-directional attendance sync. When HR uses Mark All Present /
    // Mark Attendance / CSV import on the payroll Attendance page, we
    // (a) update the local payroll-side `attendance_summaries` cache so
    //     existing UIs that read the cache stay snappy, AND
    // (b) project the summary onto EmpCloud's `attendance_records` table
    //     (one row per workday, status='present' for the present-day
    //     count, 'absent' for absent days). EmpCloud is the canonical
    //     source of truth and payroll compute reads from it first now,
    //     so we MUST write through to keep the two stores aligned.
    //
    // We never overwrite an existing EmpCloud row -- if HR or the
    // employee already marked a day on EmpCloud, that record wins.
    const results = [];
    // #337 — Track per-user EmpCloud-projection failures so the route
    // can surface "marked locally but EmpCloud sync failed" instead of
    // a misleading flat "successful" toast.
    const empcloudProjectionFailures: Array<{ empcloudUserId: number; message: string }> = [];
    // Track per-batch projection counts so the response can tell HR
    // whether the EmpCloud write actually added new rows or was a no-op
    // because EmpCloud already had attendance for those dates (the
    // existing-rows-win pattern silently skipped them).
    let empcloudInserted = 0;
    let empcloudPreserved = 0;
    const orgIdNum = Number(orgId);
    const empcloudDb = getEmpCloudDB();
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const monthEnd = monthEndIso(year, month);

    // Pre-compute the workday list once -- the same set of dates is
    // used for every employee in this batch. Days are tagged in YYYY-MM-DD
    // form (no timezone) since the calendar question is "which dates of
    // this month are weekdays" -- the answer is identical in every
    // timezone (no DST ambiguity in India).
    const daysInMonth = new Date(year, month, 0).getDate();
    const allWorkdays: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      if (dow !== 0 && dow !== 6) {
        allWorkdays.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
      }
    }

    // Resolve each employee's timezone via their EmpCloud location
    // (`users.location_id` -> `organization_locations.timezone`). Pre-fetch
    // ALL active locations for the org so we don't N+1 -- the map is
    // small (<10 rows for almost every org). Falls back to
    // DEFAULT_TIMEZONE when the user has no location or the location
    // row has no timezone string.
    const locationRows = await empcloudDb("organization_locations")
      .where("organization_id", orgIdNum)
      .select("id", "timezone");
    const tzByLocation = new Map<number, string>();
    for (const loc of locationRows) {
      if (loc.timezone) tzByLocation.set(Number(loc.id), String(loc.timezone));
    }
    // Fetch user.location_id for everyone in this batch so per-row
    // timezone resolution doesn't trigger another N+1.
    const userIds = records.map((r: any) => Number(r.employeeId)).filter((n: number) => !!n);
    const userRows =
      userIds.length > 0
        ? await empcloudDb("users").whereIn("id", userIds).select("id", "location_id")
        : [];
    const tzByUser = new Map<number, string>();
    for (const u of userRows) {
      const tz = u.location_id ? tzByLocation.get(Number(u.location_id)) : null;
      tzByUser.set(Number(u.id), tz || DEFAULT_TIMEZONE);
    }

    for (const record of records) {
      const empcloudUserId = Number(record.employeeId);
      const existing = await this.db.findOne<any>("attendance_summaries", {
        empcloud_user_id: empcloudUserId,
        month,
        year,
      });

      // employee_id is a legacy UUID column from the pre-EmpCloud schema.
      // It's nullable since migration 011 (drop_legacy_fk_constraints) and
      // should stay NULL for empcloud-sourced records. The old unique index
      // (employee_id, month, year) still exists, but MySQL treats NULL as
      // distinct in unique indexes so multiple NULL rows don't collide.
      // Uniqueness per empcloud user is enforced by the findOne upsert above.
      const data = {
        employee_id: null,
        empcloud_user_id: empcloudUserId,
        month,
        year,
        total_days: record.totalDays,
        present_days: record.presentDays,
        absent_days: record.absentDays || 0,
        half_days: record.halfDays || 0,
        paid_leave: record.paidLeave || 0,
        unpaid_leave: record.unpaidLeave || 0,
        holidays: record.holidays || 0,
        weekoffs: record.weekoffs || 0,
        lop_days: record.lopDays || 0,
        overtime_hours: record.overtimeHours || 0,
        overtime_rate: record.overtimeRate || 0,
        overtime_amount: (record.overtimeHours || 0) * (record.overtimeRate || 0),
      };

      if (existing) {
        results.push(await this.db.update("attendance_summaries", existing.id, data));
      } else {
        results.push(await this.db.create("attendance_summaries", data));
      }

      // -- Project to EmpCloud attendance_records --------------------
      // Skip if the user_id can't be resolved (defensive).
      if (!empcloudUserId) continue;
      try {
        const userTz = tzByUser.get(empcloudUserId) || DEFAULT_TIMEZONE;
        const presentTarget = Math.min(Number(record.presentDays) || 0, allWorkdays.length);
        // Find dates already populated on EmpCloud so we don't touch
        // anything HR/the employee marked themselves. Normalise existing
        // dates in the EMPLOYEE's location timezone -- not via
        // toISOString() which shifts dates by the server's UTC offset
        // and silently broke the dedupe set (the IST 2026-05-01 row
        // was being stringified as "2026-04-30" through UTC, so the
        // dedupe missed it, the projection re-inserted May 1, hit the
        // UNIQUE (user_id, date) constraint, and the catch dropped the
        // whole batch).
        const existingRows = await empcloudDb("attendance_records")
          .where("user_id", empcloudUserId)
          .where("organization_id", orgIdNum)
          .whereBetween("date", [monthStart, monthEnd])
          .select("date");
        const existingDates = new Set<string>(
          existingRows.map((r: any) => dateToIso(r.date, userTz)),
        );
        const availableDates = allWorkdays.filter((d) => !existingDates.has(d));

        const presentDates = availableDates.slice(0, presentTarget);
        const absentTarget = Math.min(
          Number(record.absentDays) || 0,
          availableDates.length - presentDates.length,
        );
        const absentDates = availableDates.slice(presentTarget, presentTarget + absentTarget);

        const inserts: any[] = [];
        const now = new Date();
        for (const d of presentDates) {
          inserts.push({
            user_id: empcloudUserId,
            organization_id: orgIdNum,
            date: d,
            status: "present",
            created_at: now,
            updated_at: now,
          });
        }
        for (const d of absentDates) {
          inserts.push({
            user_id: empcloudUserId,
            organization_id: orgIdNum,
            date: d,
            status: "absent",
            created_at: now,
            updated_at: now,
          });
        }
        if (inserts.length > 0) {
          // Use ON DUPLICATE KEY UPDATE so a race condition (employee
          // checks in via EmpCloud while HR clicks Mark All Present)
          // doesn't tank the whole batch on the UNIQUE (user_id, date)
          // constraint. EmpCloud's mark wins -- we only update the
          // row's status if it was somehow missing, otherwise leave it.
          await empcloudDb("attendance_records")
            .insert(inserts)
            .onConflict(["user_id", "date"])
            .ignore();
          empcloudInserted += inserts.length;
        }
        empcloudPreserved += existingDates.size;
      } catch (err) {
        // Don't fail the whole import if EmpCloud write fails (table
        // schema mismatch on older EmpCloud DBs, transient connection
        // issue, etc.). The local cache write succeeded above so the
        // payroll UI still reflects the import; surface the cause to
        // the server log for triage AND track the failure so the
        // response can warn the caller (#337 — Mark All Present
        // returned a "successful" toast even when the bi-directional
        // EmpCloud write silently failed for every user).
        // eslint-disable-next-line no-console
        console.warn(
          `[attendance.import] EmpCloud projection failed for user ${empcloudUserId} ${month}/${year}:`,
          (err as any)?.message || err,
        );
        empcloudProjectionFailures.push({
          empcloudUserId,
          message: (err as any)?.message ? String((err as any).message).slice(0, 200) : String(err),
        });
      }
    }
    // #337 — Surface partial-success state so the UI can warn HR when
    // the local cache wrote OK but the EmpCloud projection failed.
    return {
      imported: results.length,
      records: results,
      empcloudProjectionFailures,
      empcloudInserted,
      empcloudPreserved,
    };
  }

  async getLopDays(employeeId: string, month: number, year: number) {
    // Try EmpCloud first
    const cloud = await this.getFromEmpCloud(Number(employeeId), month, year);
    if (cloud) return { lopDays: cloud.lop_days || 0 };

    const record = await this.db.findOne<any>("attendance_summaries", {
      empcloud_user_id: Number(employeeId),
      month,
      year,
    });
    return { lopDays: record?.lop_days || 0 };
  }

  async overrideLop(employeeId: string, month: number, year: number, lopDays: number) {
    const record = await this.db.findOne<any>("attendance_summaries", {
      empcloud_user_id: Number(employeeId),
      month,
      year,
    });
    if (!record) throw new AppError(404, "NOT_FOUND", "Attendance record not found");
    return this.db.update("attendance_summaries", record.id, { lop_days: lopDays });
  }

  async computeOvertimePay(employeeId: string, month: number, year: number, monthlyBasic: number) {
    // Try EmpCloud first
    const cloud = (await this.getFromEmpCloud(Number(employeeId), month, year)) as any;
    const otHours = cloud ? Number(cloud.overtime_hours || 0) : 0;

    if (!otHours) {
      // Fall back to local
      const record = await this.db.findOne<any>("attendance_summaries", {
        empcloud_user_id: Number(employeeId),
        month,
        year,
      });

      if (!record || !Number(record.overtime_hours)) {
        return { overtimeHours: 0, overtimePay: 0, breakdown: [] };
      }

      const hourlyRate = Math.round(monthlyBasic / 26 / 8);
      const localOtHours = Number(record.overtime_hours);
      const localOtRate = Number(record.overtime_rate) || 1.5;
      const overtimePay = Math.round(localOtHours * hourlyRate * localOtRate);

      return {
        overtimeHours: localOtHours,
        hourlyRate,
        multiplier: localOtRate,
        overtimePay,
        breakdown: [
          {
            type: "Regular OT",
            hours: localOtHours,
            rate: hourlyRate * localOtRate,
            amount: overtimePay,
          },
        ],
      };
    }

    const hourlyRate = Math.round(monthlyBasic / 26 / 8);
    const otRate = 1.5;
    const overtimePay = Math.round(otHours * hourlyRate * otRate);

    return {
      overtimeHours: otHours,
      hourlyRate,
      multiplier: otRate,
      overtimePay,
      breakdown: [
        { type: "Regular OT", hours: otHours, rate: hourlyRate * otRate, amount: overtimePay },
      ],
    };
  }

  private getWorkingDaysInMonth(month: number, year: number): number {
    let days = 0;
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const day = new Date(year, month - 1, d).getDay();
      if (day !== 0 && day !== 6) days++;
    }
    return days;
  }
}
