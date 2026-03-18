import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";

const DEFAULT_LEAVE_POLICY = [
  { leaveType: "earned", annual: 15, carryForward: true },
  { leaveType: "casual", annual: 7, carryForward: false },
  { leaveType: "sick", annual: 7, carryForward: false },
];

const LEAVE_TYPE_LABELS: Record<string, string> = {
  earned: "Earned Leave",
  casual: "Casual Leave",
  sick: "Sick Leave",
  privilege: "Privilege Leave",
  maternity: "Maternity Leave",
  paternity: "Paternity Leave",
  comp_off: "Compensatory Off",
};

export class LeaveService {
  private db = getDB();

  // -------------------------------------------------------------------------
  // Balances
  // -------------------------------------------------------------------------
  async getBalances(employeeId: string, financialYear?: string) {
    const fy = financialYear || this.currentFY();
    const result = await this.db.findMany<any>("leave_balances", {
      filters: { employee_id: employeeId, financial_year: fy },
    });

    if (result.data.length === 0) {
      const balances = [];
      for (const policy of DEFAULT_LEAVE_POLICY) {
        const balance = await this.db.create("leave_balances", {
          employee_id: employeeId,
          leave_type: policy.leaveType,
          financial_year: fy,
          opening_balance: 0,
          accrued: policy.annual,
          used: 0,
          lapsed: 0,
          closing_balance: policy.annual,
        });
        balances.push(balance);
      }
      return { data: balances, total: balances.length, page: 1, limit: 20, totalPages: 1 };
    }

    return result;
  }

  async getOrgBalances(orgId: string, financialYear?: string) {
    const fy = financialYear || this.currentFY();
    const employees = await this.db.findMany<any>("employees", {
      filters: { org_id: orgId, is_active: true },
      limit: 1000,
    });

    const results = [];
    for (const emp of employees.data) {
      const balances = await this.getBalances(emp.id, fy);
      results.push({
        employeeId: emp.id,
        employeeName: `${emp.first_name} ${emp.last_name}`,
        employeeCode: emp.employee_code,
        department: emp.department,
        balances: balances.data,
      });
    }
    return results;
  }

  async recordLeave(employeeId: string, leaveType: string, days: number, fy?: string) {
    const financialYear = fy || this.currentFY();
    const balance = await this.db.findOne<any>("leave_balances", {
      employee_id: employeeId,
      leave_type: leaveType,
      financial_year: financialYear,
    });

    if (!balance) throw new AppError(404, "NOT_FOUND", "Leave balance not found");
    if (Number(balance.closing_balance) < days) {
      throw new AppError(400, "INSUFFICIENT_BALANCE", `Only ${balance.closing_balance} ${leaveType} leaves available`);
    }

    return this.db.update("leave_balances", balance.id, {
      used: Number(balance.used) + days,
      closing_balance: Number(balance.closing_balance) - days,
    });
  }

  async adjustBalance(employeeId: string, leaveType: string, adjustment: number, fy?: string) {
    const financialYear = fy || this.currentFY();
    const balance = await this.db.findOne<any>("leave_balances", {
      employee_id: employeeId,
      leave_type: leaveType,
      financial_year: financialYear,
    });

    if (!balance) throw new AppError(404, "NOT_FOUND", "Leave balance not found");
    return this.db.update("leave_balances", balance.id, {
      accrued: Number(balance.accrued) + adjustment,
      closing_balance: Number(balance.closing_balance) + adjustment,
    });
  }

  // -------------------------------------------------------------------------
  // Leave Requests (Application workflow)
  // -------------------------------------------------------------------------
  async applyLeave(employeeId: string, orgId: string, data: {
    leaveType: string;
    startDate: string;
    endDate: string;
    reason: string;
    isHalfDay?: boolean;
    halfDayPeriod?: "first_half" | "second_half";
  }) {
    const days = this.calculateDays(data.startDate, data.endDate, data.isHalfDay);

    // Check balance
    const balances = await this.getBalances(employeeId);
    const bal = balances.data.find((b: any) => b.leave_type === data.leaveType);
    if (!bal) throw new AppError(400, "INVALID_TYPE", `Leave type '${data.leaveType}' not found`);
    if (Number(bal.closing_balance) < days) {
      throw new AppError(400, "INSUFFICIENT_BALANCE",
        `Insufficient ${LEAVE_TYPE_LABELS[data.leaveType] || data.leaveType} balance. Available: ${bal.closing_balance}, Requested: ${days}`);
    }

    // Check for overlapping requests
    const existing = await this.db.findMany<any>("leave_requests", {
      filters: { employee_id: employeeId, status: "pending" },
    });
    const overlap = existing.data.find((r: any) => {
      const rStart = new Date(r.start_date).getTime();
      const rEnd = new Date(r.end_date).getTime();
      const newStart = new Date(data.startDate).getTime();
      const newEnd = new Date(data.endDate).getTime();
      return newStart <= rEnd && newEnd >= rStart;
    });
    if (overlap) throw new AppError(400, "OVERLAP", "You already have a pending leave request for overlapping dates");

    return this.db.create("leave_requests", {
      employee_id: employeeId,
      org_id: orgId,
      leave_type: data.leaveType,
      start_date: data.startDate,
      end_date: data.endDate,
      days,
      is_half_day: data.isHalfDay || false,
      half_day_period: data.isHalfDay ? (data.halfDayPeriod || "first_half") : null,
      reason: data.reason,
      status: "pending",
    });
  }

  async getMyRequests(employeeId: string, status?: string) {
    const filters: any = { employee_id: employeeId };
    if (status) filters.status = status;
    return this.db.findMany<any>("leave_requests", {
      filters,
      sort: { field: "created_at", order: "desc" },
      limit: 100,
    });
  }

  async getOrgRequests(orgId: string, status?: string) {
    const filters: any = { org_id: orgId };
    if (status) filters.status = status;
    const requests = await this.db.findMany<any>("leave_requests", {
      filters,
      sort: { field: "created_at", order: "desc" },
      limit: 200,
    });

    // Enrich with employee info
    const enriched = [];
    for (const req of requests.data) {
      const emp = await this.db.findOne<any>("employees", { id: req.employee_id });
      enriched.push({
        ...req,
        employeeName: emp ? `${emp.first_name} ${emp.last_name}` : "Unknown",
        employeeCode: emp?.employee_code,
        department: emp?.department,
      });
    }

    return { data: enriched, total: requests.total };
  }

  async approveLeave(requestId: string, approverId: string, remarks?: string) {
    const request = await this.db.findOne<any>("leave_requests", { id: requestId });
    if (!request) throw new AppError(404, "NOT_FOUND", "Leave request not found");
    if (request.status !== "pending") throw new AppError(400, "INVALID_STATUS", `Cannot approve a ${request.status} request`);

    // Deduct from balance
    await this.recordLeave(request.employee_id, request.leave_type, Number(request.days));

    return this.db.update("leave_requests", requestId, {
      status: "approved",
      approved_by: approverId,
      approver_remarks: remarks || null,
      approved_at: new Date(),
    });
  }

  async rejectLeave(requestId: string, approverId: string, remarks?: string) {
    const request = await this.db.findOne<any>("leave_requests", { id: requestId });
    if (!request) throw new AppError(404, "NOT_FOUND", "Leave request not found");
    if (request.status !== "pending") throw new AppError(400, "INVALID_STATUS", `Cannot reject a ${request.status} request`);

    return this.db.update("leave_requests", requestId, {
      status: "rejected",
      approved_by: approverId,
      approver_remarks: remarks || null,
      approved_at: new Date(),
    });
  }

  async cancelLeave(requestId: string, employeeId: string) {
    const request = await this.db.findOne<any>("leave_requests", { id: requestId });
    if (!request) throw new AppError(404, "NOT_FOUND", "Leave request not found");
    if (request.employee_id !== employeeId) throw new AppError(403, "FORBIDDEN", "Not your leave request");
    if (request.status === "cancelled") throw new AppError(400, "ALREADY_CANCELLED", "Already cancelled");

    // If approved, restore balance
    if (request.status === "approved") {
      await this.adjustBalance(request.employee_id, request.leave_type, Number(request.days));
    }

    return this.db.update("leave_requests", requestId, { status: "cancelled" });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  private calculateDays(startDate: string, endDate: string, isHalfDay?: boolean): number {
    if (isHalfDay) return 0.5;
    const start = new Date(startDate);
    const end = new Date(endDate);
    let days = 0;
    const current = new Date(start);
    while (current <= end) {
      const day = current.getDay();
      if (day !== 0 && day !== 6) days++; // Exclude weekends
      current.setDate(current.getDate() + 1);
    }
    return days;
  }

  private currentFY(): string {
    const now = new Date();
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return `${year}-${year + 1}`;
  }
}
