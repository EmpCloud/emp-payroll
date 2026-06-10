import { z } from "zod";
import { getDB } from "../db/adapters";
import { getEmpCloudDB, findSeatedUserIdsForFilters } from "../db/empcloud";
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
  // Optional per-month override. When set, payroll deducts this amount
  // every month (capped at the outstanding so the final month auto-settles
  // whatever's left). Leave unset to use the default tenure-based EMI.
  customEmiAmount: z.number().positive("Custom monthly EMI must be greater than zero").optional(),
});

export type CreateLoanInput = z.infer<typeof createLoanInputSchema>;

export class LoanService {
  private db = getDB();

  async list(
    orgId: string,
    filters?: {
      status?: string;
      employeeId?: string;
      q?: string;
      locationId?: number;
      departmentId?: number;
      page?: number;
      limit?: number;
    },
  ) {
    const page = Math.max(1, Number(filters?.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(filters?.limit) || 20));

    const qf: any = { org_id: orgId };
    if (filters?.status) qf.status = filters.status;
    if (filters?.employeeId) qf.employee_id = filters.employeeId;

    // Push q / location / department through the seated-users join in
    // EmpCloud, then intersect by `empcloud_user_id`. The list endpoint
    // belongs to the payroll org admin, so empcloudOrgId is the same as
    // `Number(orgId)` (the legacy `org_id` column on loans is a stringified
    // empcloud org id).
    const ecOrgId = Number(orgId);
    const hasUserFilter = !!(filters?.q || filters?.locationId || filters?.departmentId);
    if (hasUserFilter && Number.isFinite(ecOrgId)) {
      const matchedUserIds = await findSeatedUserIdsForFilters(ecOrgId, "emp-payroll", {
        q: filters?.q,
        locationId: filters?.locationId,
        departmentId: filters?.departmentId,
      });
      if (matchedUserIds.length === 0) {
        return { data: [], total: 0, page, limit, totalPages: 0 };
      }
      qf.empcloud_user_id = matchedUserIds;
    }

    const result = await this.db.findMany<any>("loans", {
      filters: qf,
      sort: { field: "created_at", order: "desc" },
      page,
      limit,
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
    // Custom monthly EMI must be > 0 and ≤ the principal — anything outside
    // that range is a data-entry error (you can't deduct more than the loan
    // itself, and a zero/negative override would never close the loan).
    const customEmi =
      data.customEmiAmount != null && data.customEmiAmount > 0
        ? Math.round(data.customEmiAmount)
        : null;
    if (customEmi != null && customEmi > data.principalAmount) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "Custom monthly EMI cannot exceed the loan amount",
        { customEmiAmount: ["Must be ≤ the loan amount"] },
      );
    }

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
      custom_emi_amount: customEmi,
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

  /**
   * Edit a loan/advance. Recomputes EMI (and outstanding, preserving the
   * amount already repaid) whenever principal / tenure / rate change. Only
   * the supplied fields are touched; org ownership is enforced.
   */
  async update(loanId: string, orgId: string, input: any) {
    const loan = await this.db.findById<any>("loans", loanId);
    if (!loan || String(loan.org_id) !== String(orgId)) {
      throw new AppError(404, "NOT_FOUND", "Loan not found");
    }
    if (loan.status === "cancelled") {
      throw new AppError(400, "INVALID_STATUS", "Cannot edit a cancelled loan");
    }

    const principal =
      input.principalAmount != null ? Number(input.principalAmount) : Number(loan.principal_amount);
    const tenure =
      input.tenureMonths != null ? Number(input.tenureMonths) : Number(loan.tenure_months);
    const rate =
      input.interestRate != null ? Number(input.interestRate) : Number(loan.interest_rate);
    if (!Number.isFinite(principal) || principal < 0) {
      throw new AppError(400, "VALIDATION_ERROR", "Amount must be zero or greater");
    }
    if (!Number.isFinite(tenure) || tenure < 1) {
      throw new AppError(400, "VALIDATION_ERROR", "Tenure must be at least 1 month");
    }
    if (!Number.isFinite(rate) || rate < 0) {
      throw new AppError(400, "VALIDATION_ERROR", "Interest rate must be zero or greater");
    }

    // Same EMI formula as create().
    const emi =
      rate > 0
        ? Math.round((principal * (1 + ((rate / 100) * tenure) / 12)) / tenure)
        : Math.round(principal / tenure);
    // Preserve what's already been repaid so an amount edit doesn't wipe
    // prior payments: paidSoFar = oldPrincipal − oldOutstanding.
    const paidSoFar = Math.max(0, Number(loan.principal_amount) - Number(loan.outstanding_amount));
    const newOutstanding = Math.max(0, principal - paidSoFar);

    const updates: any = {
      type: typeof input.type === "string" && input.type.trim() ? input.type.trim() : loan.type,
      description:
        typeof input.description === "string" && input.description.trim()
          ? input.description.trim()
          : loan.description,
      principal_amount: principal,
      tenure_months: tenure,
      interest_rate: rate,
      emi_amount: emi,
      outstanding_amount: newOutstanding,
    };
    // customEmiAmount is editable independently — `undefined` leaves it
    // untouched; explicit `null` clears the override (falls back to
    // tenure-based EMI); a positive number sets / replaces it.
    if (input.customEmiAmount !== undefined) {
      if (input.customEmiAmount === null) {
        updates.custom_emi_amount = null;
      } else {
        const v = Number(input.customEmiAmount);
        if (!Number.isFinite(v) || v <= 0) {
          throw new AppError(
            400,
            "VALIDATION_ERROR",
            "Custom monthly EMI must be greater than zero",
            { customEmiAmount: ["Must be > 0"] },
          );
        }
        if (v > principal) {
          throw new AppError(
            400,
            "VALIDATION_ERROR",
            "Custom monthly EMI cannot exceed the loan amount",
            { customEmiAmount: ["Must be ≤ the loan amount"] },
          );
        }
        updates.custom_emi_amount = Math.round(v);
      }
    }
    if (typeof input.startDate === "string" && input.startDate.trim()) {
      updates.start_date = input.startDate;
    }
    if (input.notes !== undefined) updates.notes = input.notes || null;
    // Reflect completion if the edit fully covers the outstanding.
    if (newOutstanding <= 0 && loan.status === "active") {
      updates.status = "completed";
      updates.end_date = new Date().toISOString().slice(0, 10);
    }

    return this.db.update("loans", loanId, updates);
  }

  /**
   * Permanently delete a loan/advance record (org-scoped).
   */
  async delete(loanId: string, orgId: string) {
    const loan = await this.db.findById<any>("loans", loanId);
    if (!loan || String(loan.org_id) !== String(orgId)) {
      throw new AppError(404, "NOT_FOUND", "Loan not found");
    }
    await this.db.delete("loans", loanId);
    return { deleted: true };
  }

  async getActiveEMIs(employeeId: string): Promise<number> {
    const result = await this.db.findMany<any>("loans", {
      filters: { employee_id: employeeId, status: "active" },
    });
    // Mirror the payroll engine: custom override wins, capped at the
    // outstanding so the last instalment is the natural settlement.
    return result.data.reduce((sum: number, l: any) => {
      const base = Number(l.custom_emi_amount ?? l.emi_amount);
      const cap = Math.max(0, Number(l.outstanding_amount));
      return sum + Math.min(base, cap);
    }, 0);
  }
}
