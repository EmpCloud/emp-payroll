import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";

export class AttendanceService {
  private db = getDB();

  async getSummary(employeeId: string, month?: number, year?: number) {
    const filters: any = { employee_id: employeeId };
    if (month) filters.month = month;
    if (year) filters.year = year;

    if (month && year) {
      const record = await this.db.findOne<any>("attendance_summaries", filters);
      if (!record) throw new AppError(404, "NOT_FOUND", "Attendance summary not found");
      return record;
    }

    return this.db.findMany<any>("attendance_summaries", {
      filters,
      sort: { field: "year", order: "desc" },
    });
  }

  async bulkSummary(orgId: string, month: number, year: number) {
    const employees = await this.db.findMany<any>("employees", {
      filters: { org_id: orgId, is_active: true },
      limit: 1000,
    });
    const empIds = employees.data.map((e: any) => e.id);
    return this.db.findMany<any>("attendance_summaries", {
      filters: { employee_id: empIds, month, year },
      limit: 1000,
    });
  }

  async importRecords(orgId: string, month: number, year: number, records: any[]) {
    const results = [];
    for (const record of records) {
      const existing = await this.db.findOne<any>("attendance_summaries", {
        employee_id: record.employeeId,
        month,
        year,
      });

      const data = {
        employee_id: record.employeeId,
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
    const record = await this.db.findOne<any>("attendance_summaries", {
      employee_id: employeeId,
      month,
      year,
    });
    return { lopDays: record?.lop_days || 0 };
  }

  async overrideLop(employeeId: string, month: number, year: number, lopDays: number) {
    const record = await this.db.findOne<any>("attendance_summaries", {
      employee_id: employeeId,
      month,
      year,
    });
    if (!record) throw new AppError(404, "NOT_FOUND", "Attendance record not found");
    return this.db.update("attendance_summaries", record.id, { lop_days: lopDays });
  }
}
