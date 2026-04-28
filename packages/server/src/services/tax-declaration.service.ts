import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";
import { computeIncomeTax } from "./tax/india-tax.service";
import { TaxRegime } from "@emp-payroll/shared";

export class TaxDeclarationService {
  private db = getDB();

  async getComputation(employeeId: string, financialYear?: string) {
    const fy = financialYear || this.currentFY();
    const computation = await this.db.findOne<any>("tax_computations", {
      employee_id: employeeId,
      financial_year: fy,
    });
    if (!computation) return null;

    // #269 — `tax_computations` is a snapshot written when computeTax() last
    // ran, which is typically BEFORE any payslips are generated. We were
    // returning that stale snapshot's tax_already_paid (= ₹0) even when
    // months of TDS had since been deducted, so the My-Tax dashboard
    // displayed "TDS Deducted YTD: ₹0". Recompute YTD live from payslips
    // every time the computation is fetched, so the value is always
    // current. Also recompute `remaining_tax` for the same reason.
    const ytdTds = await this.computeYtdTdsFromPayslips(employeeId, fy);
    const totalTax = Number(computation.total_tax || 0);
    return {
      ...computation,
      tax_already_paid: ytdTds,
      remaining_tax: Math.max(0, totalTax - ytdTds),
    };
  }

  /**
   * Sum the TDS line item from each payslip in the given financial year for
   * this employee. The payslip stores deductions as a JSONB array of
   * `{ code, name, amount }` rows; TDS is recorded under `code: "TDS"`.
   *
   * Filters:
   *  - employee match: try local `employee_id` first, fall back to
   *    `empcloud_user_id` for users provisioned via the SSO/payroll-profile
   *    path (same dual-id concern as resolveEmployeeIds).
   *  - financial year: India FY runs Apr → Mar, so an FY of "2026-2027"
   *    means month >= 4 of 2026 OR month <= 3 of 2027.
   *  - status: ignore `cancelled` (the run was cancelled and payslips
   *    were physically deleted, but be defensive). `disputed` payslips
   *    DO count — the deduction physically happened from gross even if
   *    the employee is challenging the line items.
   */
  private async computeYtdTdsFromPayslips(employeeId: string, fy: string): Promise<number> {
    // FY "2026-2027" → startYear 2026
    const startYear = Number(fy.split("-")[0]);
    if (!Number.isFinite(startYear)) return 0;

    // Collect payslips by both id paths so we don't miss any.
    const numericId = Number(employeeId);
    const candidateFilters: Array<Record<string, unknown>> = [{ employee_id: employeeId }];
    if (Number.isFinite(numericId)) {
      candidateFilters.push({ empcloud_user_id: numericId });
    }

    const seen = new Set<string>();
    let total = 0;
    for (const f of candidateFilters) {
      const result = await this.db
        .findMany<any>("payslips", { filters: f, limit: 500 })
        .catch(() => ({ data: [] as any[] }));
      for (const ps of result.data) {
        if (seen.has(ps.id)) continue;
        seen.add(ps.id);
        const status = String(ps.status || "").toLowerCase();
        if (status === "cancelled") continue;
        const inFy =
          (Number(ps.year) === startYear && Number(ps.month) >= 4) ||
          (Number(ps.year) === startYear + 1 && Number(ps.month) <= 3);
        if (!inFy) continue;
        const deductions =
          typeof ps.deductions === "string" ? JSON.parse(ps.deductions) : ps.deductions;
        if (!Array.isArray(deductions)) continue;
        const tds = deductions.find((d: any) => d?.code === "TDS");
        if (tds) total += Number(tds.amount) || 0;
      }
    }
    return Math.round(total);
  }

  async computeTax(employeeId: string) {
    const fy = this.currentFY();
    const employee = await this.db.findById<any>("employees", employeeId);
    if (!employee) throw new AppError(404, "NOT_FOUND", "Employee not found");

    const salary = await this.db.findOne<any>("employee_salaries", {
      employee_id: employeeId,
      is_active: true,
    });
    if (!salary) throw new AppError(404, "NOT_FOUND", "No active salary for employee");

    const taxInfo =
      typeof employee.tax_info === "string" ? JSON.parse(employee.tax_info) : employee.tax_info;
    const components =
      typeof salary.components === "string" ? JSON.parse(salary.components) : salary.components;

    const basicAnnual = (components.find((c: any) => c.code === "BASIC")?.monthlyAmount || 0) * 12;
    const hraAnnual = (components.find((c: any) => c.code === "HRA")?.monthlyAmount || 0) * 12;

    // Get declarations
    const declarations = await this.db.findMany<any>("tax_declarations", {
      filters: { employee_id: employeeId, financial_year: fy, approval_status: "approved" },
      limit: 100,
    });

    const declInput = declarations.data.map((d: any) => ({
      section: d.section,
      amount: Number(d.approved_amount),
    }));

    // #269 — Tax already paid this FY. Use the shared helper so the FY
    // window + status filter + dual-id (employee_id / empcloud_user_id)
    // resolution match what getComputation() returns. Previously this
    // queried payslips with ONLY `employee_id` and no FY filter, summing
    // TDS across years.
    const taxAlreadyPaid = await this.computeYtdTdsFromPayslips(employeeId, fy);

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const monthsRemaining = currentMonth >= 4 ? 12 - (currentMonth - 4) : 4 - currentMonth;

    const result = computeIncomeTax({
      employeeId,
      financialYear: fy,
      regime: taxInfo?.regime === "old" ? TaxRegime.OLD : TaxRegime.NEW,
      annualGross: Number(salary.gross_salary),
      basicAnnual,
      hraAnnual,
      rentPaidAnnual: 0,
      isMetroCity: false,
      declarations: declInput,
      employeePfAnnual: basicAnnual * 0.12,
      monthsWorked: monthsRemaining,
      taxAlreadyPaid,
    });

    // Save computation
    const existing = await this.db.findOne<any>("tax_computations", {
      employee_id: employeeId,
      financial_year: fy,
    });

    const compData = {
      employee_id: employeeId,
      financial_year: fy,
      regime: result.regime,
      gross_income: result.grossIncome,
      exemptions: JSON.stringify(result.exemptions),
      total_exemptions: result.totalExemptions,
      deductions: JSON.stringify(result.deductions),
      total_deductions: result.totalDeductions,
      taxable_income: result.taxableIncome,
      tax_on_income: result.taxOnIncome,
      surcharge: result.surcharge,
      health_and_education_cess: result.healthAndEducationCess,
      total_tax: result.totalTax,
      tax_already_paid: taxAlreadyPaid,
      remaining_tax: result.remainingTax,
      monthly_tds: result.monthlyTds,
    };

    if (existing) {
      await this.db.update("tax_computations", existing.id, compData);
    } else {
      await this.db.create("tax_computations", compData);
    }

    return result;
  }

  async getDeclarations(employeeId: string, financialYear?: string) {
    const fy = financialYear || this.currentFY();
    return this.db.findMany<any>("tax_declarations", {
      filters: { employee_id: employeeId, financial_year: fy },
    });
  }

  async submitDeclarations(employeeId: string, fy: string, declarations: any[]) {
    // Input validation — surface a meaningful 400 instead of a cryptic DB error.
    if (!employeeId) {
      throw new AppError(400, "INVALID_EMPLOYEE", "Employee ID is required");
    }
    if (!fy || typeof fy !== "string") {
      throw new AppError(400, "INVALID_FY", "Financial year is required");
    }
    if (!Array.isArray(declarations) || declarations.length === 0) {
      throw new AppError(400, "INVALID_DECLARATIONS", "At least one declaration is required");
    }

    const normalized: Array<{
      section: string;
      description: string;
      declaredAmount: number;
    }> = [];
    for (let i = 0; i < declarations.length; i++) {
      const decl = declarations[i];
      if (!decl || typeof decl !== "object") {
        throw new AppError(400, "INVALID_DECLARATION", `Declaration #${i + 1} is invalid`);
      }
      const section = typeof decl.section === "string" ? decl.section.trim() : "";
      const description = typeof decl.description === "string" ? decl.description.trim() : "";
      // Accept either `declaredAmount` (client payload) or `amount` (legacy).
      const rawAmount = decl.declaredAmount ?? decl.amount;
      const amount = Number(rawAmount);
      if (!section) {
        throw new AppError(400, "INVALID_SECTION", `Declaration #${i + 1}: section is required`);
      }
      if (!description) {
        throw new AppError(
          400,
          "INVALID_DESCRIPTION",
          `Declaration #${i + 1}: description is required`,
        );
      }
      if (!Number.isFinite(amount) || amount < 0) {
        throw new AppError(
          400,
          "INVALID_AMOUNT",
          `Declaration #${i + 1}: amount must be a non-negative number`,
        );
      }
      normalized.push({ section, description, declaredAmount: amount });
    }

    // Resolve employee: callers may pass either the payroll employees.id (UUID)
    // or the EmpCloud user id. The tax_declarations table stores both — the FK
    // employee_id must be a valid employees.id UUID, so we resolve it here.
    const { empcloudUserId, employeeRowId } = await this.resolveEmployeeIds(employeeId);

    // #137 — When a user has logged in via SSO but isn't yet onboarded in the
    // payroll `employees` table, employeeRowId is null. The FK is NOT NULL, so
    // the insert below would fail with a cryptic DB error ("Column 'employee_id'
    // cannot be null") surfaced to the client as a generic 500. Return a clear
    // 400 so the admin knows this user needs to be added to payroll first.
    if (!employeeRowId) {
      throw new AppError(
        400,
        "EMPLOYEE_NOT_IN_PAYROLL",
        "You don't have a payroll profile yet. Please ask your admin to add you to payroll before submitting declarations.",
      );
    }

    const results = [];
    for (const decl of normalized) {
      try {
        results.push(
          await this.db.create("tax_declarations", {
            employee_id: employeeRowId,
            empcloud_user_id: empcloudUserId,
            financial_year: fy,
            section: decl.section,
            description: decl.description,
            declared_amount: decl.declaredAmount,
            approval_status: "pending",
          }),
        );
      } catch (err: any) {
        throw new AppError(
          500,
          "DECLARATION_SAVE_FAILED",
          `Failed to save declaration for section ${decl.section}: ${err?.message || "unknown error"}`,
        );
      }
    }
    return results;
  }

  /**
   * Accepts either a payroll employees.id (UUID) or an EmpCloud user id (numeric
   * string) and returns both identifiers. Falls back gracefully when the row
   * cannot be resolved so that the caller can still persist via
   * empcloud_user_id only.
   */
  private async resolveEmployeeIds(
    employeeId: string,
  ): Promise<{ empcloudUserId: number | null; employeeRowId: string | null }> {
    // Try direct lookup by employees.id (legacy layout)
    const byId = await this.db.findById<any>("employees", employeeId).catch(() => null);
    if (byId) {
      return {
        empcloudUserId: byId.empcloud_user_id ?? null,
        employeeRowId: byId.id,
      };
    }

    // Numeric → EmpCloud user id. Check legacy employees table, then the
    // newer employee_payroll_profiles table (current source of truth for
    // users provisioned via Apply-to-Payroll). See reimbursement.service
    // for the same dual-lookup and the #159/#160 motivation.
    const numeric = Number(employeeId);
    if (Number.isFinite(numeric)) {
      const byEmpcloud = await this.db
        .findOne<any>("employees", { empcloud_user_id: numeric })
        .catch(() => null);
      if (byEmpcloud) {
        return { empcloudUserId: numeric, employeeRowId: byEmpcloud.id };
      }
      const profile = await this.db
        .findOne<any>("employee_payroll_profiles", {
          empcloud_user_id: numeric,
          is_active: 1,
        })
        .catch(() => null);
      if (profile) {
        return { empcloudUserId: numeric, employeeRowId: profile.id };
      }
      return { empcloudUserId: numeric, employeeRowId: null };
    }

    return { empcloudUserId: null, employeeRowId: employeeId };
  }

  async updateDeclaration(employeeId: string, declId: string, data: any) {
    const decl = await this.db.findOne<any>("tax_declarations", {
      id: declId,
      employee_id: employeeId,
    });
    if (!decl) throw new AppError(404, "NOT_FOUND", "Declaration not found");
    return this.db.update("tax_declarations", declId, data);
  }

  async approveDeclarations(employeeId: string, approverId: string, fy?: string) {
    const financialYear = fy || this.currentFY();
    const pending = await this.db.findMany<any>("tax_declarations", {
      filters: {
        employee_id: employeeId,
        financial_year: financialYear,
        approval_status: "pending",
      },
      limit: 100,
    });

    for (const decl of pending.data) {
      await this.db.update("tax_declarations", decl.id, {
        approval_status: "approved",
        approved_amount: decl.declared_amount,
        approved_by: approverId,
        approved_at: new Date(),
      });
    }

    return { approved: pending.data.length };
  }

  async getRegime(employeeId: string) {
    const emp = await this.db.findById<any>("employees", employeeId);
    if (!emp) throw new AppError(404, "NOT_FOUND", "Employee not found");
    const taxInfo = typeof emp.tax_info === "string" ? JSON.parse(emp.tax_info) : emp.tax_info;
    return { regime: taxInfo?.regime || "new" };
  }

  async updateRegime(employeeId: string, regime: string) {
    const emp = await this.db.findById<any>("employees", employeeId);
    if (!emp) throw new AppError(404, "NOT_FOUND", "Employee not found");
    const taxInfo = typeof emp.tax_info === "string" ? JSON.parse(emp.tax_info) : emp.tax_info;
    taxInfo.regime = regime;
    await this.db.update("employees", employeeId, { tax_info: JSON.stringify(taxInfo) });
    return { regime };
  }

  private currentFY(): string {
    const now = new Date();
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return `${year}-${year + 1}`;
  }
}
