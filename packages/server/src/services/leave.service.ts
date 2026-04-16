import { getDB } from "../db/adapters";
import { getEmpCloudDB } from "../db/empcloud";
import { AppError } from "../api/middleware/error.middleware";

// Leaves that count as paid leave in attendance
const PAID_LEAVE_TYPES = ["earned", "casual", "sick", "privilege", "maternity", "paternity"];

export class LeaveService {
  private db = getDB();

  // -------------------------------------------------------------------------
  // Balances — read from EmpCloud's leave_balances
  // -------------------------------------------------------------------------
  async getBalances(employeeId: string, financialYear?: string) {
    const empcloudDb = getEmpCloudDB();
    const year = financialYear ? Number(financialYear.split("-")[0]) : this.currentFYYear();

    const balances = await empcloudDb("leave_balances as lb")
      .join("leave_types as lt", "lb.leave_type_id", "lt.id")
      .where("lb.user_id", Number(employeeId))
      .where("lb.year", year)
      .select(
        "lb.id",
        "lb.user_id as employee_id",
        "lt.code as leave_type",
        "lt.name as leave_type_name",
        "lt.is_paid",
        empcloudDb.raw("? as financial_year", [financialYear || this.currentFY()]),
        "lb.total_carry_forward as opening_balance",
        "lb.total_allocated as accrued",
        "lb.total_used as used",
        empcloudDb.raw("0 as lapsed"),
        "lb.balance as closing_balance",
      );

    if (balances.length === 0) {
      // Fall back to local leave_balances
      const fy = financialYear || this.currentFY();
      return this.db.findMany<any>("leave_balances", {
        filters: { employee_id: employeeId, financial_year: fy },
      });
    }

    return { data: balances, total: balances.length, page: 1, limit: 20, totalPages: 1 };
  }

  async getOrgBalances(orgId: string, financialYear?: string) {
    const empcloudDb = getEmpCloudDB();
    const orgIdNum = Number(orgId);
    const year = financialYear ? Number(financialYear.split("-")[0]) : this.currentFYYear();

    // Get all active users in the org
    const users = await empcloudDb("users")
      .where({ organization_id: orgIdNum, status: 1 })
      .whereNot("role", "super_admin")
      .select("id", "first_name", "last_name", "emp_code")
      .limit(1000);

    const results = [];
    for (const user of users) {
      const balances = await this.getBalances(String(user.id), financialYear);
      results.push({
        employeeId: String(user.id),
        employeeName: `${user.first_name} ${user.last_name}`,
        employeeCode: user.emp_code,
        department: "",
        balances: balances.data,
      });
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // Leave Requests — read from EmpCloud's leave_applications
  // -------------------------------------------------------------------------
  async getMyRequests(employeeId: string, status?: string) {
    const empcloudDb = getEmpCloudDB();
    let query = empcloudDb("leave_applications as la")
      .join("leave_types as lt", "la.leave_type_id", "lt.id")
      .leftJoin("users as approver", "la.current_approver_id", "approver.id")
      .where("la.user_id", Number(employeeId));

    if (status) query = query.where("la.status", status);

    const requests = await query
      .select(
        "la.id",
        "la.user_id as employee_id",
        "lt.code as leave_type",
        "lt.name as leave_type_name",
        "la.start_date",
        "la.end_date",
        "la.days_count as days",
        "la.is_half_day",
        "la.half_day_type as half_day_period",
        "la.reason",
        "la.status",
        "la.current_approver_id as assigned_to",
        empcloudDb.raw(
          "CONCAT(COALESCE(approver.first_name, ''), ' ', COALESCE(approver.last_name, '')) as assignedToName",
        ),
        "la.created_at",
        "la.updated_at",
      )
      .orderBy("la.created_at", "desc")
      .limit(100);

    return { data: requests, total: requests.length };
  }

  async getTeamRequests(managerId: string, status?: string) {
    const empcloudDb = getEmpCloudDB();
    let query = empcloudDb("leave_applications as la")
      .join("leave_types as lt", "la.leave_type_id", "lt.id")
      .join("users as emp", "la.user_id", "emp.id")
      .where("la.current_approver_id", Number(managerId));

    if (status) query = query.where("la.status", status);

    const requests = await query
      .select(
        "la.id",
        "la.user_id as employee_id",
        empcloudDb.raw("CONCAT(emp.first_name, ' ', emp.last_name) as employeeName"),
        "emp.emp_code as employeeCode",
        "lt.code as leave_type",
        "lt.name as leave_type_name",
        "la.start_date",
        "la.end_date",
        "la.days_count as days",
        "la.is_half_day",
        "la.reason",
        "la.status",
        "la.created_at",
      )
      .orderBy("la.created_at", "desc")
      .limit(200);

    return { data: requests, total: requests.length };
  }

  async getOrgRequests(orgId: string, status?: string) {
    const empcloudDb = getEmpCloudDB();
    let query = empcloudDb("leave_applications as la")
      .join("leave_types as lt", "la.leave_type_id", "lt.id")
      .join("users as emp", "la.user_id", "emp.id")
      .leftJoin("users as approver", "la.current_approver_id", "approver.id")
      .where("la.organization_id", Number(orgId));

    if (status) query = query.where("la.status", status);

    const requests = await query
      .select(
        "la.id",
        "la.user_id as employee_id",
        empcloudDb.raw("CONCAT(emp.first_name, ' ', emp.last_name) as employeeName"),
        "emp.emp_code as employeeCode",
        "lt.code as leave_type",
        "lt.name as leave_type_name",
        "la.start_date",
        "la.end_date",
        "la.days_count as days",
        "la.is_half_day",
        "la.reason",
        "la.status",
        "la.current_approver_id as assigned_to",
        empcloudDb.raw(
          "CONCAT(COALESCE(approver.first_name, ''), ' ', COALESCE(approver.last_name, '')) as assignedToName",
        ),
        "la.created_at",
      )
      .orderBy("la.created_at", "desc")
      .limit(200);

    return { data: requests, total: requests.length };
  }

  // -------------------------------------------------------------------------
  // Leave Actions — proxy to EmpCloud's leave_applications
  // List active leave types for an org — used by the Apply Leave form so the
  // dropdown shows the real codes/names instead of a hardcoded list that
  // didn't match what EmpCloud stored (issue #12).
  async listLeaveTypes(orgId: string) {
    const empcloudDb = getEmpCloudDB();
    return empcloudDb("leave_types")
      .where({ organization_id: Number(orgId), is_active: true })
      .select("id", "code", "name", "leave_category", "max_days_per_year")
      .orderBy("name", "asc");
  }

  // -------------------------------------------------------------------------
  async applyLeave(
    employeeId: string,
    orgId: string,
    data: {
      leaveTypeId?: string | number;
      leaveType?: string;
      startDate: string;
      endDate: string;
      reason: string;
      isHalfDay?: boolean;
      halfDayPeriod?: "first_half" | "second_half";
    },
  ) {
    const empcloudDb = getEmpCloudDB();
    const orgIdNum = Number(orgId);
    const userIdNum = Number(employeeId);

    // Resolve the leave type — prefer the numeric PK (leaveTypeId) since
    // EmpCloud's leave_types.code is tenant-configurable and varies per org
    // (e.g. CL / SL / EL) so a hardcoded code like "earned" never matched.
    // Falling back to code lookup keeps older clients working. (#26)
    let leaveType: any = null;
    if (data.leaveTypeId !== undefined && data.leaveTypeId !== null && data.leaveTypeId !== "") {
      leaveType = await empcloudDb("leave_types")
        .where({ id: Number(data.leaveTypeId), organization_id: orgIdNum, is_active: true })
        .first();
    } else if (data.leaveType) {
      leaveType = await empcloudDb("leave_types")
        .where({ organization_id: orgIdNum, code: data.leaveType, is_active: true })
        .first();
    }
    if (!leaveType) {
      const label = data.leaveTypeId ?? data.leaveType ?? "";
      throw new AppError(400, "INVALID_TYPE", `Leave type '${label}' not found`);
    }

    // Guard: end date must be on/after start date. Duplicates the Zod
    // refinement so direct service calls (tests, seeds) also fail loudly. (#36)
    if (new Date(data.endDate).getTime() < new Date(data.startDate).getTime()) {
      throw new AppError(
        400,
        "INVALID_DATE_RANGE",
        "End date must be greater than start date",
      );
    }

    const days = data.isHalfDay ? 0.5 : this.calculateDays(data.startDate, data.endDate);

    // Check balance
    const year =
      new Date(data.startDate).getMonth() >= 3
        ? new Date(data.startDate).getFullYear()
        : new Date(data.startDate).getFullYear() - 1;
    const balance = await empcloudDb("leave_balances")
      .where({ user_id: userIdNum, leave_type_id: leaveType.id, year })
      .first();
    if (balance && Number(balance.balance) < days) {
      throw new AppError(
        400,
        "INSUFFICIENT_BALANCE",
        `Insufficient ${leaveType.name} balance. Available: ${balance.balance}, Requested: ${days}`,
      );
    }

    // Check overlapping applications
    const overlap = await empcloudDb("leave_applications")
      .where("user_id", userIdNum)
      .whereIn("status", ["pending", "approved"])
      .where("start_date", "<=", data.endDate)
      .where("end_date", ">=", data.startDate)
      .first();
    if (overlap)
      throw new AppError(
        400,
        "OVERLAP",
        "You already have a pending/approved leave for overlapping dates",
      );

    // Get reporting manager
    const user = await empcloudDb("users").where({ id: userIdNum }).first();
    const approverId = user?.reporting_manager_id || null;

    const [id] = await empcloudDb("leave_applications").insert({
      organization_id: orgIdNum,
      user_id: userIdNum,
      leave_type_id: leaveType.id,
      start_date: data.startDate,
      end_date: data.endDate,
      days_count: days,
      is_half_day: data.isHalfDay || false,
      half_day_type: data.isHalfDay ? data.halfDayPeriod || "first_half" : null,
      reason: data.reason,
      status: "pending",
      current_approver_id: approverId,
      created_at: new Date(),
      updated_at: new Date(),
    });

    return { id, status: "pending", days };
  }

  async approveLeave(
    requestId: string,
    approverId: string,
    approverRole: string,
    remarks?: string,
  ) {
    const empcloudDb = getEmpCloudDB();
    const app = await empcloudDb("leave_applications")
      .where({ id: Number(requestId) })
      .first();
    if (!app) throw new AppError(404, "NOT_FOUND", "Leave request not found");
    if (app.status !== "pending")
      throw new AppError(400, "INVALID_STATUS", `Cannot approve a ${app.status} request`);

    this.checkApproverAuth(app, Number(approverId), approverRole);

    // Deduct from balance
    const balance = await empcloudDb("leave_balances")
      .where({ user_id: app.user_id, leave_type_id: app.leave_type_id })
      .where(
        "year",
        new Date(app.start_date).getMonth() >= 3
          ? new Date(app.start_date).getFullYear()
          : new Date(app.start_date).getFullYear() - 1,
      )
      .first();
    if (balance) {
      await empcloudDb("leave_balances")
        .where({ id: balance.id })
        .update({
          total_used: Number(balance.total_used) + Number(app.days_count),
          balance: Number(balance.balance) - Number(app.days_count),
          updated_at: new Date(),
        });
    }

    await empcloudDb("leave_applications")
      .where({ id: Number(requestId) })
      .update({
        status: "approved",
        updated_at: new Date(),
      });

    // Insert approval record
    await empcloudDb("leave_approvals").insert({
      leave_application_id: Number(requestId),
      approver_id: Number(approverId),
      status: "approved",
      remarks: remarks || null,
      created_at: new Date(),
    });

    return { id: requestId, status: "approved" };
  }

  async rejectLeave(requestId: string, approverId: string, approverRole: string, remarks?: string) {
    const empcloudDb = getEmpCloudDB();
    const app = await empcloudDb("leave_applications")
      .where({ id: Number(requestId) })
      .first();
    if (!app) throw new AppError(404, "NOT_FOUND", "Leave request not found");
    if (app.status !== "pending")
      throw new AppError(400, "INVALID_STATUS", `Cannot reject a ${app.status} request`);

    this.checkApproverAuth(app, Number(approverId), approverRole);

    await empcloudDb("leave_applications")
      .where({ id: Number(requestId) })
      .update({
        status: "rejected",
        updated_at: new Date(),
      });

    await empcloudDb("leave_approvals").insert({
      leave_application_id: Number(requestId),
      approver_id: Number(approverId),
      status: "rejected",
      remarks: remarks || null,
      created_at: new Date(),
    });

    return { id: requestId, status: "rejected" };
  }

  async cancelLeave(requestId: string, employeeId: string, reason: string) {
    const empcloudDb = getEmpCloudDB();
    const app = await empcloudDb("leave_applications")
      .where({ id: Number(requestId) })
      .first();
    if (!app) throw new AppError(404, "NOT_FOUND", "Leave request not found");
    if (app.user_id !== Number(employeeId))
      throw new AppError(403, "FORBIDDEN", "Not your leave request");
    if (app.status === "cancelled")
      throw new AppError(400, "ALREADY_CANCELLED", "Already cancelled");
    if (app.status === "rejected")
      throw new AppError(400, "INVALID_STATUS", "Cannot cancel a rejected request");

    // If approved: restore balance
    if (app.status === "approved") {
      const balance = await empcloudDb("leave_balances")
        .where({ user_id: app.user_id, leave_type_id: app.leave_type_id })
        .where(
          "year",
          new Date(app.start_date).getMonth() >= 3
            ? new Date(app.start_date).getFullYear()
            : new Date(app.start_date).getFullYear() - 1,
        )
        .first();
      if (balance) {
        await empcloudDb("leave_balances")
          .where({ id: balance.id })
          .update({
            total_used: Math.max(0, Number(balance.total_used) - Number(app.days_count)),
            balance: Number(balance.balance) + Number(app.days_count),
            updated_at: new Date(),
          });
      }
    }

    await empcloudDb("leave_applications")
      .where({ id: Number(requestId) })
      .update({
        status: "cancelled",
        updated_at: new Date(),
      });

    return { id: requestId, status: "cancelled" };
  }

  // -------------------------------------------------------------------------
  // Leave Summary for Attendance Page
  // -------------------------------------------------------------------------
  async getLeaveSummaryForMonth(orgId: string, month: number, year: number) {
    const empcloudDb = getEmpCloudDB();
    const startOfMonth = `${year}-${String(month).padStart(2, "0")}-01`;
    const endOfMonth = new Date(year, month, 0).toISOString().slice(0, 10);

    const leaves = await empcloudDb("leave_applications as la")
      .join("leave_types as lt", "la.leave_type_id", "lt.id")
      .where("la.organization_id", Number(orgId))
      .where("la.status", "approved")
      .where("la.start_date", "<=", endOfMonth)
      .where("la.end_date", ">=", startOfMonth)
      .select(
        "la.user_id",
        "lt.code as leave_type",
        "la.start_date",
        "la.end_date",
        "la.days_count as days",
        "la.is_half_day",
      );

    const byEmployee: Record<string, any[]> = {};
    for (const leave of leaves) {
      const key = String(leave.user_id);
      if (!byEmployee[key]) byEmployee[key] = [];
      byEmployee[key].push({
        leaveType: leave.leave_type,
        startDate: leave.start_date,
        endDate: leave.end_date,
        days: Number(leave.days),
        isHalfDay: leave.is_half_day,
      });
    }
    return byEmployee;
  }

  // -------------------------------------------------------------------------
  // Record/Adjust (kept for backward compatibility with local tables)
  // -------------------------------------------------------------------------
  async recordLeave(employeeId: string, leaveType: string, days: number) {
    const fy = this.currentFY();
    const balance = await this.db.findOne<any>("leave_balances", {
      employee_id: employeeId,
      leave_type: leaveType,
      financial_year: fy,
    });
    if (!balance) throw new AppError(404, "NOT_FOUND", "Leave balance not found");
    if (Number(balance.closing_balance) < days) {
      throw new AppError(
        400,
        "INSUFFICIENT_BALANCE",
        `Only ${balance.closing_balance} ${leaveType} leaves available`,
      );
    }
    return this.db.update("leave_balances", balance.id, {
      used: Number(balance.used) + days,
      closing_balance: Number(balance.closing_balance) - days,
    });
  }

  async adjustBalance(employeeId: string, leaveType: string, adjustment: number) {
    const fy = this.currentFY();
    const balance = await this.db.findOne<any>("leave_balances", {
      employee_id: employeeId,
      leave_type: leaveType,
      financial_year: fy,
    });
    if (!balance) throw new AppError(404, "NOT_FOUND", "Leave balance not found");
    const updates: any = { closing_balance: Number(balance.closing_balance) + adjustment };
    if (adjustment > 0) {
      updates.used = Math.max(0, Number(balance.used) - adjustment);
    } else {
      updates.accrued = Number(balance.accrued) + adjustment;
    }
    return this.db.update("leave_balances", balance.id, updates);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  private checkApproverAuth(app: any, approverId: number, approverRole: string) {
    const isAssigned = app.current_approver_id === approverId;
    const isHrAdmin = approverRole === "hr_admin" || approverRole === "org_admin";
    if (!isAssigned && !isHrAdmin) {
      throw new AppError(
        403,
        "NOT_AUTHORIZED",
        "Only the reporting manager or HR admin can approve/reject this leave",
      );
    }
  }

  private calculateDays(startDate: string, endDate: string): number {
    const start = new Date(startDate);
    const end = new Date(endDate);
    let days = 0;
    const current = new Date(start);
    while (current <= end) {
      const day = current.getDay();
      if (day !== 0 && day !== 6) days++;
      current.setDate(current.getDate() + 1);
    }
    return days;
  }

  private currentFY(): string {
    const now = new Date();
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return `${year}-${year + 1}`;
  }

  private currentFYYear(): number {
    const now = new Date();
    return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  }
}
