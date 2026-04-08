import { getDB } from "../db/adapters";
import { getEmpCloudDB } from "../db/empcloud";
import { AppError } from "../api/middleware/error.middleware";

export class PayslipService {
  private db = getDB();

  async list(orgId: string, options?: any) {
    const runs = await this.db.findMany<any>("payroll_runs", {
      filters: { empcloud_org_id: Number(orgId) },
      limit: 1000,
    });
    const runIds = runs.data.map((r: any) => r.id);
    if (runIds.length === 0) return { data: [], total: 0, page: 1, limit: 20, totalPages: 0 };

    const filters: any = { payroll_run_id: runIds };
    if (options?.month) filters.month = Number(options.month);
    if (options?.year) filters.year = Number(options.year);

    const result = await this.db.findMany<any>("payslips", {
      ...options,
      filters,
    });

    // Enrich with employee names from EmpCloud
    return this.enrichPayslips(result);
  }

  async getById(id: string, orgId?: string) {
    const payslip = await this.db.findById<any>("payslips", id);
    if (!payslip) throw new AppError(404, "NOT_FOUND", "Payslip not found");

    if (orgId) {
      const run = await this.db.findOne<any>("payroll_runs", {
        id: payslip.payroll_run_id,
        empcloud_org_id: Number(orgId),
      });
      if (!run) throw new AppError(404, "NOT_FOUND", "Payslip not found");
    }

    // Enrich single payslip
    const enriched = await this.enrichPayslips({
      data: [payslip],
      total: 1,
      page: 1,
      limit: 1,
      totalPages: 1,
    });
    return enriched.data[0];
  }

  async getByEmployee(employeeId: string) {
    const result = await this.db.findMany<any>("payslips", {
      filters: { empcloud_user_id: Number(employeeId) },
      sort: { field: "year", order: "desc" },
      limit: 100,
    });
    return this.enrichPayslips(result);
  }

  async dispute(id: string, userId: string, reason: string) {
    const payslip = await this.db.findById<any>("payslips", id);
    if (!payslip) throw new AppError(404, "NOT_FOUND", "Payslip not found");
    if (payslip.status === "disputed") {
      throw new AppError(400, "ALREADY_DISPUTED", "Payslip already has an open dispute");
    }
    return this.db.update("payslips", id, { status: "disputed" });
  }

  async resolveDispute(id: string, resolution: string) {
    const payslip = await this.db.findById<any>("payslips", id);
    if (!payslip) throw new AppError(404, "NOT_FOUND", "Payslip not found");
    if (payslip.status !== "disputed") {
      throw new AppError(400, "NOT_DISPUTED", "Payslip is not in disputed state");
    }
    return this.db.update("payslips", id, { status: "resolved" });
  }

  private async enrichPayslips(result: any) {
    const ecDb = getEmpCloudDB();
    const userIds = [...new Set(result.data.map((p: any) => p.empcloud_user_id).filter(Boolean))];

    if (userIds.length === 0) return result;

    const users = await ecDb("users")
      .whereIn("users.id", userIds)
      .leftJoin("organization_departments as dept", "users.department_id", "dept.id")
      .select(
        "users.id",
        "users.first_name",
        "users.last_name",
        "users.emp_code",
        "users.email",
        "users.designation",
        "dept.name as department",
      );

    const userMap = new Map(users.map((u: any) => [u.id, u]));

    const enriched = result.data.map((p: any) => {
      const user = userMap.get(p.empcloud_user_id);
      return {
        ...p,
        first_name: user?.first_name || null,
        last_name: user?.last_name || null,
        employee_name: user ? `${user.first_name} ${user.last_name}` : null,
        employee_code: user?.emp_code || null,
        email: user?.email || null,
        department: user?.department || null,
        designation: user?.designation || null,
        earnings: typeof p.earnings === "string" ? JSON.parse(p.earnings) : p.earnings,
        deductions: typeof p.deductions === "string" ? JSON.parse(p.deductions) : p.deductions,
      };
    });

    return { ...result, data: enriched };
  }
}
