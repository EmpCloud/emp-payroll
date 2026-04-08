import { getDB } from "../db/adapters";
import { getEmpCloudDB } from "../db/empcloud";
import { AppError } from "../api/middleware/error.middleware";

export class AttendanceService {
  private db = getDB();

  /**
   * Get attendance summary for a single employee from EmpCloud's attendance_records.
   * Falls back to local attendance_summaries if EmpCloud has no data.
   */
  async getSummary(employeeId: string, month?: number, year?: number) {
    if (month && year) {
      // Try EmpCloud first
      const cloud = await this.getFromEmpCloud(Number(employeeId), month, year);
      if (cloud) return cloud;

      // Fall back to local
      const record = await this.db.findOne<any>("attendance_summaries", {
        empcloud_user_id: Number(employeeId),
        month,
        year,
      });
      if (!record) throw new AppError(404, "NOT_FOUND", "Attendance summary not found");
      return record;
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
    const endDate = new Date(year, month, 0).toISOString().slice(0, 10);
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
      // No attendance records in EmpCloud for this month — return all org users with zero attendance
      const users = await empcloudDb("users")
        .where({ organization_id: orgIdNum, status: 1 })
        .whereNot("role", "super_admin")
        .select("id as empcloud_user_id", "first_name", "last_name", "emp_code");

      const zeroData = users.map((u: any) => ({
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
      }));

      return { data: zeroData, total: zeroData.length, page: 1, limit: 1000, totalPages: 1 };
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

    // Merge leave data into attendance records
    const enriched = records.map((r: any) => {
      const userLeave = leaveMap[r.empcloud_user_id] || { paid: 0, unpaid: 0 };
      return {
        ...r,
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
      const endDate = new Date(year, month, 0).toISOString().slice(0, 10);
      const totalWorkingDays = this.getWorkingDaysInMonth(month, year);

      const [record] = await empcloudDb("attendance_records")
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
        );

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
    const results = [];
    for (const record of records) {
      const empcloudUserId = Number(record.employeeId);
      const existing = await this.db.findOne<any>("attendance_summaries", {
        empcloud_user_id: empcloudUserId,
        month,
        year,
      });

      const data = {
        employee_id: "00000000-0000-0000-0000-000000000000",
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
    }
    return { imported: results.length, records: results };
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
    const cloud = await this.getFromEmpCloud(Number(employeeId), month, year);
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
