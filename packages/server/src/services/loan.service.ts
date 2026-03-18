import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";

export class LoanService {
  private db = getDB();

  async list(orgId: string, filters?: { status?: string; employeeId?: string }) {
    const qf: any = { org_id: orgId };
    if (filters?.status) qf.status = filters.status;
    if (filters?.employeeId) qf.employee_id = filters.employeeId;

    const result = await this.db.findMany<any>("loans", {
      filters: qf,
      sort: { field: "created_at", order: "desc" },
      limit: 100,
    });

    // Enrich with employee names
    const empIds = [...new Set(result.data.map((l: any) => l.employee_id))];
    const empMap: Record<string, any> = {};
    for (const eid of empIds) {
      const emp = await this.db.findById<any>("employees", eid as string);
      if (emp) empMap[eid as string] = emp;
    }

    return {
      ...result,
      data: result.data.map((l: any) => ({
        ...l,
        employee_name: empMap[l.employee_id]
          ? `${empMap[l.employee_id].first_name} ${empMap[l.employee_id].last_name}`
          : "Unknown",
        employee_code: empMap[l.employee_id]?.employee_code || "",
      })),
    };
  }

  async getByEmployee(employeeId: string) {
    return this.db.findMany<any>("loans", {
      filters: { employee_id: employeeId },
      sort: { field: "created_at", order: "desc" },
      limit: 50,
    });
  }

  async create(orgId: string, approverId: string, data: {
    employeeId: string;
    type: string;
    description: string;
    principalAmount: number;
    tenureMonths: number;
    interestRate?: number;
    startDate: string;
    notes?: string;
  }) {
    const rate = data.interestRate || 0;
    const emi = rate > 0
      ? Math.round((data.principalAmount * (1 + rate / 100 * data.tenureMonths / 12)) / data.tenureMonths)
      : Math.round(data.principalAmount / data.tenureMonths);

    return this.db.create("loans", {
      employee_id: data.employeeId,
      org_id: orgId,
      type: data.type,
      description: data.description,
      principal_amount: data.principalAmount,
      outstanding_amount: data.principalAmount,
      tenure_months: data.tenureMonths,
      emi_amount: emi,
      interest_rate: rate,
      status: "active",
      start_date: data.startDate,
      installments_paid: 0,
      approved_by: approverId,
      approved_at: new Date(),
      notes: data.notes || null,
    });
  }

  async recordPayment(loanId: string, amount?: number) {
    const loan = await this.db.findById<any>("loans", loanId);
    if (!loan) throw new AppError(404, "NOT_FOUND", "Loan not found");
    if (loan.status !== "active") throw new AppError(400, "INVALID_STATUS", "Loan is not active");

    const paymentAmount = amount || Number(loan.emi_amount);
    const newOutstanding = Math.max(0, Number(loan.outstanding_amount) - paymentAmount);
    const newInstallments = loan.installments_paid + 1;

    const updates: any = {
      outstanding_amount: newOutstanding,
      installments_paid: newInstallments,
    };

    if (newOutstanding <= 0) {
      updates.status = "completed";
      updates.end_date = new Date().toISOString().slice(0, 10);
    }

    return this.db.update("loans", loanId, updates);
  }

  async cancel(loanId: string) {
    const loan = await this.db.findById<any>("loans", loanId);
    if (!loan) throw new AppError(404, "NOT_FOUND", "Loan not found");
    return this.db.update("loans", loanId, { status: "cancelled" });
  }

  async getActiveEMIs(employeeId: string): Promise<number> {
    const result = await this.db.findMany<any>("loans", {
      filters: { employee_id: employeeId, status: "active" },
    });
    return result.data.reduce((sum: number, l: any) => sum + Number(l.emi_amount), 0);
  }
}
