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
    return computation;
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

    // Get tax already paid this FY
    const paidPayslips = await this.db.findMany<any>("payslips", {
      filters: { employee_id: employeeId },
      limit: 100,
    });
    let taxAlreadyPaid = 0;
    for (const ps of paidPayslips.data) {
      const deductions =
        typeof ps.deductions === "string" ? JSON.parse(ps.deductions) : ps.deductions;
      const tds = deductions.find((d: any) => d.code === "TDS");
      if (tds) taxAlreadyPaid += tds.amount;
    }

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
    // Try direct lookup by employees.id
    const byId = await this.db.findById<any>("employees", employeeId).catch(() => null);
    if (byId) {
      return {
        empcloudUserId: byId.empcloud_user_id ?? null,
        employeeRowId: byId.id,
      };
    }

    // Try numeric empcloud_user_id
    const numeric = Number(employeeId);
    if (Number.isFinite(numeric)) {
      const byEmpcloud = await this.db
        .findOne<any>("employees", { empcloud_user_id: numeric })
        .catch(() => null);
      if (byEmpcloud) {
        return { empcloudUserId: numeric, employeeRowId: byEmpcloud.id };
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
