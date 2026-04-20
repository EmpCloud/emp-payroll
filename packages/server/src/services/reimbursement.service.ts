import { z } from "zod";
import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";

// #38 — Reject negative or non-finite amounts server-side. Using Zod here
// (instead of the shared validators module) keeps validation co-located with
// the service and avoids touching cross-cutting files other agents share.
const submitSchema = z.object({
  category: z.string().min(1, "Category is required"),
  description: z.string().min(1, "Description is required"),
  amount: z
    .number({ invalid_type_error: "Amount must be a number" })
    .finite("Amount must be a valid number")
    .nonnegative("Amount must be zero or a positive number"),
  expenseDate: z.string().min(1, "Expense date is required"),
});

export class ReimbursementService {
  private db = getDB();

  async list(orgId: string, filters?: { status?: string; employeeId?: string }) {
    // Get employees for this org, then filter reimbursements
    const employees = await this.db.findMany<any>("employees", {
      filters: { org_id: orgId, is_active: true },
      limit: 10000,
    });
    const empIds = employees.data.map((e: any) => e.id);
    if (empIds.length === 0) return { data: [], total: 0, page: 1, limit: 50, totalPages: 0 };

    const queryFilters: any = { employee_id: empIds };
    if (filters?.status) queryFilters.status = filters.status;
    if (filters?.employeeId) queryFilters.employee_id = filters.employeeId;

    const result = await this.db.findMany<any>("reimbursements", {
      filters: queryFilters,
      sort: { field: "created_at", order: "desc" },
      limit: 100,
    });

    // Attach employee names
    const empMap: Record<string, any> = {};
    for (const emp of employees.data) empMap[emp.id] = emp;

    const enriched = result.data.map((r: any) => ({
      ...r,
      employee_name: empMap[r.employee_id]
        ? `${empMap[r.employee_id].first_name} ${empMap[r.employee_id].last_name}`
        : "Unknown",
      employee_code: empMap[r.employee_id]?.employee_code || "",
    }));

    return { ...result, data: enriched };
  }

  async getByEmployee(employeeId: string) {
    // #130 — Accept either the payroll UUID or the EmpCloud user ID and
    // match on whichever column holds a value. Historically self-service
    // passed the EmpCloud numeric id; some older rows may only have
    // empcloud_user_id populated, while new rows have both.
    const resolved = await this.resolveEmployeeRow(employeeId);
    const filters: any[] = [];
    if (resolved) filters.push({ employee_id: resolved.id });
    const numeric = Number(employeeId);
    if (Number.isFinite(numeric)) filters.push({ empcloud_user_id: numeric });
    if (filters.length === 0) {
      return { data: [], total: 0, page: 1, limit: 100, totalPages: 0 };
    }

    // If only one filter is applicable, use findMany directly
    if (filters.length === 1) {
      return this.db.findMany<any>("reimbursements", {
        filters: filters[0],
        sort: { field: "created_at", order: "desc" },
        limit: 100,
      });
    }

    // Both filters — union results. Dedupe by id.
    const results = await Promise.all(
      filters.map((f) =>
        this.db.findMany<any>("reimbursements", {
          filters: f,
          sort: { field: "created_at", order: "desc" },
          limit: 100,
        }),
      ),
    );
    const seen = new Set<string>();
    const merged: any[] = [];
    for (const r of results) {
      for (const row of r.data) {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          merged.push(row);
        }
      }
    }
    merged.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return { data: merged, total: merged.length, page: 1, limit: 100, totalPages: 1 };
  }

  async submit(
    employeeId: string,
    data: {
      category: string;
      description: string;
      amount: number;
      expenseDate: string;
    },
  ) {
    const parsed = submitSchema.safeParse({
      ...data,
      // Coerce from string/bigint/null just in case the caller forwarded raw
      // body values without pre-conversion.
      amount: typeof data.amount === "number" ? data.amount : Number(data.amount),
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new AppError(400, "VALIDATION_ERROR", first?.message || "Invalid claim data");
    }

    // #130 — Self-service callers pass the numeric EmpCloud user ID, but the
    // reimbursements.employee_id column stores the payroll employees.id UUID
    // (which is what the admin list() filters against). Without this resolution
    // step, employee submissions are invisible in the admin panel because the
    // raw EmpCloud id never matches any UUID in the employees table.
    const resolved = await this.resolveEmployeeRow(employeeId);
    if (!resolved) {
      throw new AppError(
        400,
        "EMPLOYEE_NOT_IN_PAYROLL",
        "You don't have a payroll profile yet. Please ask your admin to add you to payroll before submitting reimbursements.",
      );
    }

    return this.db.create("reimbursements", {
      employee_id: resolved.id,
      empcloud_user_id: resolved.empcloud_user_id,
      category: parsed.data.category,
      description: parsed.data.description,
      amount: parsed.data.amount,
      expense_date: parsed.data.expenseDate,
      status: "pending",
    });
  }

  /**
   * Accepts either a payroll employees.id (UUID) or an EmpCloud user ID
   * (numeric string) and returns the employees row with { id, empcloud_user_id }.
   * Returns null when the user isn't mapped to any payroll employee.
   */
  private async resolveEmployeeRow(
    employeeId: string,
  ): Promise<{ id: string; empcloud_user_id: number | null } | null> {
    // Try direct lookup by employees.id (UUID case)
    const byId = await this.db.findById<any>("employees", employeeId).catch(() => null);
    if (byId) return { id: byId.id, empcloud_user_id: byId.empcloud_user_id ?? null };

    // Numeric → look up by empcloud_user_id
    const numeric = Number(employeeId);
    if (Number.isFinite(numeric)) {
      const byEmpcloud = await this.db
        .findOne<any>("employees", { empcloud_user_id: numeric })
        .catch(() => null);
      if (byEmpcloud) return { id: byEmpcloud.id, empcloud_user_id: numeric };
    }
    return null;
  }

  async approve(id: string, approverId: string, amount?: number) {
    const claim = await this.db.findById<any>("reimbursements", id);
    if (!claim) throw new AppError(404, "NOT_FOUND", "Claim not found");
    if (claim.status !== "pending")
      throw new AppError(400, "INVALID_STATUS", "Only pending claims can be approved");

    // #38 — Mirror the submit-time nonnegative guard for approver overrides.
    if (amount !== undefined && amount !== null) {
      const amt = typeof amount === "number" ? amount : Number(amount);
      const amountCheck = z.number().finite().nonnegative().safeParse(amt);
      if (!amountCheck.success) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Approved amount must be zero or a positive number",
        );
      }
      amount = amountCheck.data;
    }

    return this.db.update("reimbursements", id, {
      status: "approved",
      approved_by: approverId,
      approved_at: new Date(),
      amount: amount || claim.amount,
    });
  }

  async reject(id: string, approverId: string) {
    const claim = await this.db.findById<any>("reimbursements", id);
    if (!claim) throw new AppError(404, "NOT_FOUND", "Claim not found");
    if (claim.status !== "pending")
      throw new AppError(400, "INVALID_STATUS", "Only pending claims can be rejected");

    return this.db.update("reimbursements", id, {
      status: "rejected",
      approved_by: approverId,
      approved_at: new Date(),
    });
  }

  async markPaid(id: string, month: number, year: number) {
    return this.db.update("reimbursements", id, {
      status: "paid",
      paid_in_month: month,
      paid_in_year: year,
    });
  }
}
