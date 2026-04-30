import { z } from "zod";
import { getDB } from "../db/adapters";
import { getEmpCloudDB } from "../db/empcloud";
import { AppError } from "../api/middleware/error.middleware";

// Zod schema for loan creation — lives in the service so we don't have to
// fight with parallel agents over packages/server/src/api/validators/index.ts.
// `principalAmount` is `.nonnegative()` (0 is allowed for edge cases like a
// zero-value advance correction); `tenureMonths` must be at least 1 so EMI
// math stays finite; `interestRate` defaults to 0 and must be non-negative.
// (#70)
export const createLoanInputSchema = z.object({
  employeeId: z.string().min(1, "Employee is required"),
  type: z.string().min(1, "Type is required"),
  description: z.string().min(1, "Description is required"),
  principalAmount: z.number().nonnegative("Amount must be zero or greater"),
  tenureMonths: z
    .number()
    .int("Tenure must be a whole number of months")
    .min(1, "Tenure must be at least 1 month"),
  interestRate: z.number().nonnegative("Interest rate must be zero or greater").optional(),
  startDate: z.string().min(1, "Start date is required"),
  notes: z.string().optional(),
});

export type CreateLoanInput = z.infer<typeof createLoanInputSchema>;

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

    // Enrich with employee names. Loans created from the new flow store the
    // EmpCloud user id directly in `employee_id` (the payroll-side `employees`
    // row may never exist), so we have to resolve names against BOTH:
    //   1) the legacy payroll `employees` table (when employee_id is a UUID)
    //   2) EmpCloud `users.id` (when employee_id is numeric, OR when an
    //      `empcloud_user_id` column was explicitly set)
    //
    // #303 — every loan was rendering as "Unknown" because the create path
    // sets `employee_id` to the EmpCloud user id and leaves `empcloud_user_id`
    // null, so neither lookup found a match. Now we treat any numeric
    // `employee_id` as a candidate EmpCloud user id and try both lookups.
    const empIdsRaw = [...new Set(result.data.map((l: any) => l.employee_id).filter(Boolean))];
    const numericEmployeeIds = empIdsRaw
      .map((v: any) => Number(v))
      .filter((n: any) => Number.isFinite(n) && n > 0);
    const explicitUserIds = result.data
      .map((l: any) => Number(l.empcloud_user_id))
      .filter((n: any) => Number.isFinite(n) && n > 0);
    const userIds = [...new Set([...numericEmployeeIds, ...explicitUserIds])];

    const empMap: Record<string, any> = {};
    for (const eid of empIdsRaw) {
      const emp = await this.db.findById<any>("employees", eid as string).catch(() => null);
      if (emp) empMap[eid as string] = emp;
    }

    const userMap: Record<string, any> = {};
    if (userIds.length > 0) {
      try {
        const ecDb = getEmpCloudDB();
        const rows = await ecDb("users")
          .whereIn("id", userIds as number[])
          .select("id", "first_name", "last_name", "emp_code");
        for (const u of rows) {
          userMap[String(u.id)] = u;
        }
      } catch {
        // EmpCloud DB unavailable — fall back to "Unknown"
      }
    }

    return {
      ...result,
      data: result.data.map((l: any) => {
        const emp = empMap[l.employee_id];
        const userByExplicit = l.empcloud_user_id ? userMap[String(l.empcloud_user_id)] : undefined;
        const userByEmployeeId = userMap[String(l.employee_id)];
        const user = userByExplicit || userByEmployeeId;
        const name = emp
          ? `${emp.first_name} ${emp.last_name}`
          : user
            ? `${user.first_name} ${user.last_name}`
            : "Unknown";
        return {
          ...l,
          employee_name: name,
          employee_code: emp?.employee_code || user?.emp_code || "",
        };
      }),
    };
  }

  async getByEmployee(employeeId: string) {
    return this.db.findMany<any>("loans", {
      filters: { employee_id: employeeId },
      sort: { field: "created_at", order: "desc" },
      limit: 50,
    });
  }

  async create(orgId: string, approverId: string, input: CreateLoanInput) {
    // Validate input server-side. Throws a 400 AppError with per-field
    // details so the UI can surface them inline. (#70)
    const parsed = createLoanInputSchema.safeParse(input);
    if (!parsed.success) {
      const details: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".") || "_";
        if (!details[path]) details[path] = [];
        details[path].push(issue.message);
      }
      throw new AppError(400, "VALIDATION_ERROR", "Invalid loan input", details);
    }
    const data = parsed.data;

    const rate = data.interestRate || 0;
    const emi =
      rate > 0
        ? Math.round(
            (data.principalAmount * (1 + ((rate / 100) * data.tenureMonths) / 12)) /
              data.tenureMonths,
          )
        : Math.round(data.principalAmount / data.tenureMonths);

    // #303 — when the supplied employeeId is purely numeric it's an EmpCloud
    // user id (the new dropdown sets `value={user.id}`), so also stamp
    // empcloud_user_id so the list query can do a clean join even after the
    // row is created. Older UUID-style ids (legacy employees table) leave it
    // null and fall back to the employees-table lookup.
    const numericEmployeeId = Number(data.employeeId);
    const empcloudUserId =
      Number.isFinite(numericEmployeeId) && numericEmployeeId > 0 ? numericEmployeeId : null;

    return this.db.create("loans", {
      employee_id: data.employeeId,
      empcloud_user_id: empcloudUserId,
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
