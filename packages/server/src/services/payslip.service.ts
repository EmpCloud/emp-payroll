import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";

export class PayslipService {
  private db = getDB();

  async list(orgId: string, options?: any) {
    // Join through payroll_runs to filter by org
    const runs = await this.db.findMany<any>("payroll_runs", {
      filters: { empcloud_org_id: Number(orgId) },
      limit: 1000,
    });
    const runIds = runs.data.map((r: any) => r.id);
    if (runIds.length === 0) return { data: [], total: 0, page: 1, limit: 20, totalPages: 0 };

    return this.db.findMany<any>("payslips", {
      ...options,
      filters: { ...options?.filters, payroll_run_id: runIds },
    });
  }

  async getById(id: string, orgId?: string) {
    const payslip = await this.db.findById<any>("payslips", id);
    if (!payslip) throw new AppError(404, "NOT_FOUND", "Payslip not found");

    // If orgId provided, verify payslip belongs to this org via its payroll run
    if (orgId) {
      const run = await this.db.findOne<any>("payroll_runs", {
        id: payslip.payroll_run_id,
        empcloud_org_id: Number(orgId),
      });
      if (!run) throw new AppError(404, "NOT_FOUND", "Payslip not found");
    }

    return payslip;
  }

  async getByEmployee(employeeId: string) {
    return this.db.findMany<any>("payslips", {
      filters: { empcloud_user_id: Number(employeeId) },
      sort: { field: "year", order: "desc" },
      limit: 100,
    });
  }

  async dispute(id: string, userId: string, reason: string) {
    const payslip = await this.getById(id);
    if (payslip.status === "disputed") {
      throw new AppError(400, "ALREADY_DISPUTED", "Payslip already has an open dispute");
    }
    return this.db.update("payslips", id, { status: "disputed" });
  }

  async resolveDispute(id: string, resolution: string) {
    const payslip = await this.getById(id);
    if (payslip.status !== "disputed") {
      throw new AppError(400, "NOT_DISPUTED", "Payslip is not in disputed state");
    }
    return this.db.update("payslips", id, { status: "resolved" });
  }
}
