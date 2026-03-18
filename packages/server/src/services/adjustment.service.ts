import { v4 as uuid } from "uuid";
import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";

export class AdjustmentService {
  private db = getDB();

  async create(params: {
    orgId: string;
    employeeId: string;
    type: "bonus" | "incentive" | "arrear" | "deduction" | "reimbursement";
    description: string;
    amount: number;
    isTaxable?: boolean;
    isRecurring?: boolean;
    recurringMonths?: number;
    effectiveMonth?: string;
    createdBy: string;
  }) {
    const id = uuid();
    return this.db.create("payroll_adjustments", {
      id,
      org_id: params.orgId,
      employee_id: params.employeeId,
      type: params.type,
      description: params.description,
      amount: params.amount,
      is_taxable: params.isTaxable !== false ? 1 : 0,
      is_recurring: params.isRecurring ? 1 : 0,
      recurring_months: params.recurringMonths || null,
      effective_month: params.effectiveMonth || null,
      status: "pending",
      created_by: params.createdBy,
    });
  }

  async list(orgId: string, filters?: { employeeId?: string; status?: string; type?: string }) {
    const where: any = { org_id: orgId };
    if (filters?.employeeId) where.employee_id = filters.employeeId;
    if (filters?.status) where.status = filters.status;
    if (filters?.type) where.type = filters.type;
    return this.db.findMany<any>("payroll_adjustments", {
      filters: where,
      sort: { field: "created_at", order: "desc" },
      limit: 200,
    });
  }

  async getPendingForRun(orgId: string, employeeId: string) {
    return this.db.findMany<any>("payroll_adjustments", {
      filters: { org_id: orgId, employee_id: employeeId, status: "pending" },
      limit: 100,
    });
  }

  async markApplied(adjustmentId: string, payrollRunId: string) {
    return this.db.update("payroll_adjustments", adjustmentId, {
      status: "applied",
      payroll_run_id: payrollRunId,
    });
  }

  async cancel(adjustmentId: string, orgId: string) {
    const adj = await this.db.findById<any>("payroll_adjustments", adjustmentId);
    if (!adj || adj.org_id !== orgId) throw new AppError(404, "NOT_FOUND", "Adjustment not found");
    if (adj.status === "applied") throw new AppError(400, "ALREADY_APPLIED", "Cannot cancel an applied adjustment");
    return this.db.update("payroll_adjustments", adjustmentId, { status: "cancelled" });
  }
}
