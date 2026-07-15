import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";
import { computeZAPayroll } from "./tax/za-tax.service";
import { computeUSPayroll } from "./tax/us-tax.service";
import { computeUKPayroll } from "./tax/uk-tax.service";
import { COUNTRY_CONFIGS } from "./tax/country-configs";
import { deductionsFromConfig } from "./tax/country-payroll.service";

// ---------------------------------------------------------------------------
// Country-specific tax/deduction calculation helpers
// ---------------------------------------------------------------------------

interface DeductionResult {
  tax_amount: number;
  social_security_employee: number;
  social_security_employer: number;
  pension_employee: number;
  pension_employer: number;
  health_insurance_employee: number;
  health_insurance_employer: number;
  other_deductions: number;
}

function parseComplianceNotes(notes: string | null): Record<string, any> {
  if (!notes) return {};
  try {
    return JSON.parse(notes);
  } catch {
    return {};
  }
}

/**
 * Calculate deductions based on country compliance rules.
 * Uses the compliance_notes JSON to determine rates.
 * Falls back to simple percentage-based estimates.
 */
function calculateDeductions(grossMonthly: number, country: any): DeductionResult {
  const rules = parseComplianceNotes(country.compliance_notes);
  const code = country.code;

  // Config-driven engine: any country with a data config uses its real ruleset
  // (progressive income tax + capped contribution funds + levies) instead of the
  // flat per-country estimates in the switch below. Dedicated engines (IN, US,
  // GB, ZA) are handled in the switch and are intentionally NOT in the config map.
  const cfg = COUNTRY_CONFIGS[code];
  if (cfg) {
    return deductionsFromConfig(cfg, grossMonthly);
  }

  let tax_amount = 0;
  let ss_employee = 0;
  let ss_employer = 0;
  let pension_employee = 0;
  let pension_employer = 0;
  let hi_employee = 0;
  let hi_employer = 0;
  let other = 0;

  switch (code) {
    case "IN": {
      // EPF
      pension_employee = Math.round(grossMonthly * 0.12);
      pension_employer = Math.round(grossMonthly * 0.12);
      // ESI (if below threshold)
      if (grossMonthly <= 2100000) {
        hi_employee = Math.round(grossMonthly * 0.0075);
        hi_employer = Math.round(grossMonthly * 0.0325);
      }
      // Simple flat tax estimate (~15% effective for mid-range)
      tax_amount = Math.round(grossMonthly * 0.15);
      // Professional tax
      other = Math.min(20000, Math.round(grossMonthly * 0.002));
      break;
    }
    case "US": {
      // United States — real federal + FICA (SS wage-capped) + Medicare (+
      // additional) + progressive state engine, replacing the prior flat
      // 7.65%/22% estimate. grossMonthly is in cents; the US engine works in
      // dollars. W-4 / state / YTD default (single filer, no state, fresh YTD)
      // since global-payroll doesn't capture them — override upstream when known.
      const us = computeUSPayroll({
        employeeId: "",
        grossPay: grossMonthly / 100,
        payFrequency: "monthly",
        w4: {
          filingStatus: "single",
          otherIncome: 0,
          deductions: 0,
          dependentCredit: 0,
          extraWithholding: 0,
        },
        stateCode: "",
        ytdGross: 0,
        ytdSocialSecurity: 0,
        pretaxDeductions: 0,
      });
      tax_amount = Math.round((us.federalTax + us.stateTax) * 100); // income tax (federal + state)
      ss_employee = Math.round((us.socialSecurity + us.medicare + us.additionalMedicare) * 100); // FICA (employee)
      ss_employer = Math.round(
        (us.employerSocialSecurity + us.employerMedicare + us.employerFuta) * 100,
      ); // employer payroll taxes
      break;
    }
    case "GB": {
      // United Kingdom — real PAYE (tax code + personal allowance + bands) + NIC
      // (thresholds) + auto-enrolment pension, replacing the prior flat 20%/12%
      // estimate that taxed from the first pound. grossMonthly is in pence; the
      // UK engine works in pounds. Tax code / region / NIC category / YTD default
      // (1257L, England, category A, fresh) since global-payroll doesn't capture
      // them — override upstream when known.
      const uk = computeUKPayroll({
        employeeId: "",
        grossPay: grossMonthly / 100,
        payFrequency: "monthly",
        taxCode: "1257L",
        region: "england",
        nicCategory: "A",
        studentLoanPlans: [],
        pensionMethod: "relief_at_source",
        pensionEmployeeRate: 5,
        pensionEmployerRate: 3,
        periodNumber: 1,
        ytdGross: 0,
        ytdTaxPaid: 0,
        ytdNicPaid: 0,
      });
      tax_amount = Math.round(uk.incomeTax * 100);
      ss_employee = Math.round(uk.employeeNIC * 100);
      ss_employer = Math.round(uk.employerNIC * 100);
      pension_employee = Math.round(uk.employeePension * 100);
      pension_employer = Math.round(uk.employerPension * 100);
      break;
    }
    case "DE": {
      pension_employee = Math.round(grossMonthly * 0.093);
      pension_employer = Math.round(grossMonthly * 0.093);
      hi_employee = Math.round(grossMonthly * 0.073);
      hi_employer = Math.round(grossMonthly * 0.073);
      ss_employee = Math.round(grossMonthly * 0.013); // unemployment
      ss_employer = Math.round(grossMonthly * 0.013);
      other = Math.round(grossMonthly * 0.01525); // care insurance
      tax_amount = Math.round(grossMonthly * 0.25);
      break;
    }
    case "FR": {
      ss_employee = Math.round(grossMonthly * 0.22);
      ss_employer = Math.round(grossMonthly * 0.45);
      tax_amount = Math.round(grossMonthly * 0.2);
      break;
    }
    case "SG": {
      pension_employee = Math.round(grossMonthly * 0.2); // CPF employee
      pension_employer = Math.round(grossMonthly * 0.17); // CPF employer
      tax_amount = Math.round(grossMonthly * 0.1);
      break;
    }
    case "AE": {
      // No income tax; pension only for nationals (approximate as 0 for EOR)
      tax_amount = 0;
      break;
    }
    case "JP": {
      hi_employee = Math.round(grossMonthly * 0.0499);
      hi_employer = Math.round(grossMonthly * 0.0499);
      pension_employee = Math.round(grossMonthly * 0.0915);
      pension_employer = Math.round(grossMonthly * 0.0915);
      ss_employee = Math.round(grossMonthly * 0.006); // employment insurance
      ss_employer = Math.round(grossMonthly * 0.0095);
      tax_amount = Math.round(grossMonthly * 0.15);
      break;
    }
    case "AU": {
      pension_employer = Math.round(grossMonthly * 0.11); // super
      tax_amount = Math.round(grossMonthly * 0.25);
      other = Math.round(grossMonthly * 0.02); // medicare levy
      break;
    }
    case "CA": {
      pension_employee = Math.round(grossMonthly * 0.0595); // CPP
      pension_employer = Math.round(grossMonthly * 0.0595);
      ss_employee = Math.round(grossMonthly * 0.0163); // EI
      ss_employer = Math.round(grossMonthly * 0.02282);
      tax_amount = Math.round(grossMonthly * 0.2);
      break;
    }
    case "ZA": {
      // South Africa — real SARS engine (progressive PAYE + rebate + capped UIF
      // + SDL). grossMonthly is in cents; the ZA engine works in rand. Age /
      // medical / retirement default (primary rebate only) since global-payroll
      // does not capture them — override upstream when that data is available.
      const za = computeZAPayroll({ employeeId: "", grossMonthly: grossMonthly / 100 });
      tax_amount = Math.round(za.paye * 100); // PAYE (employee)
      ss_employee = Math.round(za.uifEmployee * 100); // UIF (employee)
      ss_employer = Math.round((za.uifEmployer + za.sdl) * 100); // UIF + SDL (employer)
      break;
    }
    default: {
      // Generic fallback using country flags
      if (country.has_social_security) {
        ss_employee = Math.round(grossMonthly * 0.05);
        ss_employer = Math.round(grossMonthly * 0.08);
      }
      if (country.has_pension) {
        pension_employee = Math.round(grossMonthly * 0.05);
        pension_employer = Math.round(grossMonthly * 0.05);
      }
      if (country.has_health_insurance) {
        hi_employee = Math.round(grossMonthly * 0.03);
        hi_employer = Math.round(grossMonthly * 0.03);
      }
      tax_amount = Math.round(grossMonthly * 0.15);
      break;
    }
  }

  return {
    tax_amount,
    social_security_employee: ss_employee,
    social_security_employer: ss_employer,
    pension_employee,
    pension_employer,
    health_insurance_employee: hi_employee,
    health_insurance_employer: hi_employer,
    other_deductions: other,
  };
}

// Default compliance checklist items for new global employees
const DEFAULT_CHECKLIST: Array<{ item: string; category: string }> = [
  { item: "Employment contract signed", category: "legal" },
  { item: "Tax ID / tax registration collected", category: "tax" },
  { item: "Bank account details verified", category: "payroll" },
  { item: "Background check completed", category: "legal" },
  { item: "Work permit / visa verified", category: "immigration" },
  { item: "Benefits enrollment completed", category: "benefits" },
  { item: "Payroll registered with local authorities", category: "payroll" },
  { item: "Local labor law orientation", category: "legal" },
  { item: "Social security registration", category: "tax" },
  { item: "Health insurance enrollment", category: "benefits" },
];

// ============================================================================
// GLOBAL PAYROLL SERVICE
// ============================================================================

export class GlobalPayrollService {
  private db = getDB();

  // ---------------------------------------------------------------------------
  // Countries
  // ---------------------------------------------------------------------------

  async listCountries(filters?: { region?: string; isActive?: string }) {
    const where: Record<string, any> = {};
    if (filters?.region) where.region = filters.region;
    if (filters?.isActive !== undefined) where.is_active = filters.isActive === "true" ? 1 : 0;
    else where.is_active = 1;

    return this.db.findMany<any>("countries", {
      filters: where,
      sort: { field: "name", order: "asc" },
      limit: 100,
    });
  }

  async getCountry(countryId: string) {
    const country = await this.db.findById<any>("countries", countryId);
    if (!country) throw new AppError(404, "NOT_FOUND", "Country not found");
    return {
      ...country,
      compliance_notes:
        typeof country.compliance_notes === "string"
          ? JSON.parse(country.compliance_notes)
          : country.compliance_notes,
    };
  }

  // ---------------------------------------------------------------------------
  // Global Employees
  // ---------------------------------------------------------------------------

  async addGlobalEmployee(orgId: string, data: any) {
    const numOrgId = Number(orgId);

    // Verify country exists
    const country = await this.db.findById<any>("countries", data.countryId);
    if (!country) throw new AppError(404, "NOT_FOUND", "Country not found");

    // #123 — Block duplicate adds of the same employee (by email within the
    // org). Previously nothing prevented clicking Save twice, so a single
    // person appeared 2+ times in the list. The email+org pair is a natural
    // uniqueness key for this table even without a DB constraint.
    if (data.email) {
      const existing = await this.db.findOne<any>("global_employees", {
        empcloud_org_id: numOrgId,
        email: data.email,
      });
      if (existing) {
        throw new AppError(
          409,
          "DUPLICATE_EMPLOYEE",
          `A global employee with email ${data.email} already exists in this organization.`,
        );
      }
    }

    const employee = await this.db.create("global_employees", {
      empcloud_org_id: numOrgId,
      empcloud_user_id: data.empcloudUserId ? Number(data.empcloudUserId) : null,
      first_name: data.firstName,
      last_name: data.lastName,
      email: data.email,
      country_id: data.countryId,
      employment_type: data.employmentType,
      contract_type: data.contractType,
      job_title: data.jobTitle,
      department: data.department || null,
      start_date: data.startDate,
      end_date: data.endDate || null,
      salary_amount: data.salaryAmount,
      salary_currency: data.salaryCurrency || country.currency,
      salary_frequency: data.salaryFrequency || "monthly",
      status: "onboarding",
      tax_id: data.taxId || null,
      bank_name: data.bankName || null,
      bank_account: data.bankAccount || null,
      bank_routing: data.bankRouting || null,
      contract_document_url: data.contractDocumentUrl || null,
      notes: data.notes || null,
    });

    // Auto-create compliance checklist
    for (const item of DEFAULT_CHECKLIST) {
      await this.db.create("compliance_checklist", {
        empcloud_org_id: numOrgId,
        global_employee_id: (employee as any).id,
        item: item.item,
        is_completed: false,
        category: item.category,
      });
    }

    return employee;
  }

  async listGlobalEmployees(
    orgId: string,
    filters?: { countryId?: string; employmentType?: string; status?: string; search?: string },
  ) {
    const where: Record<string, any> = { empcloud_org_id: Number(orgId) };
    if (filters?.countryId) where.country_id = filters.countryId;
    if (filters?.employmentType) where.employment_type = filters.employmentType;
    if (filters?.status) where.status = filters.status;

    const result = await this.db.findMany<any>("global_employees", {
      filters: where,
      sort: { field: "created_at", order: "desc" },
      limit: 500,
    });

    // Enrich with country info
    const countryIds = [...new Set(result.data.map((e: any) => e.country_id))];
    const countryMap: Record<string, any> = {};
    for (const cid of countryIds) {
      const c = await this.db.findById<any>("countries", cid as string);
      if (c) countryMap[cid as string] = c;
    }

    // Filter by search if provided
    let data = result.data.map((e: any) => ({
      ...e,
      country_name: countryMap[e.country_id]?.name || "Unknown",
      country_code: countryMap[e.country_id]?.code || "",
      country_currency_symbol: countryMap[e.country_id]?.currency_symbol || "",
    }));

    if (filters?.search) {
      const q = filters.search.toLowerCase();
      data = data.filter(
        (e: any) =>
          e.first_name.toLowerCase().includes(q) ||
          e.last_name.toLowerCase().includes(q) ||
          e.email.toLowerCase().includes(q) ||
          e.country_name.toLowerCase().includes(q),
      );
    }

    return { ...result, data };
  }

  async getGlobalEmployee(orgId: string, empId: string) {
    const emp = await this.db.findOne<any>("global_employees", {
      id: empId,
      empcloud_org_id: Number(orgId),
    });
    if (!emp) throw new AppError(404, "NOT_FOUND", "Global employee not found");

    const country = await this.db.findById<any>("countries", emp.country_id);
    const checklist = await this.db.findMany<any>("compliance_checklist", {
      filters: { empcloud_org_id: Number(orgId), global_employee_id: empId },
      sort: { field: "category", order: "asc" },
      limit: 100,
    });

    return {
      ...emp,
      country: country
        ? {
            ...country,
            compliance_notes: parseComplianceNotes(country.compliance_notes),
          }
        : null,
      compliance_checklist: checklist.data,
      compliance_percentage: checklist.data.length
        ? Math.round(
            (checklist.data.filter((c: any) => c.is_completed).length / checklist.data.length) *
              100,
          )
        : 0,
    };
  }

  async updateGlobalEmployee(orgId: string, empId: string, data: any) {
    const emp = await this.db.findOne<any>("global_employees", {
      id: empId,
      empcloud_org_id: Number(orgId),
    });
    if (!emp) throw new AppError(404, "NOT_FOUND", "Global employee not found");

    const updateData: Record<string, any> = {};
    if (data.firstName !== undefined) updateData.first_name = data.firstName;
    if (data.lastName !== undefined) updateData.last_name = data.lastName;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.countryId !== undefined) updateData.country_id = data.countryId;
    if (data.employmentType !== undefined) updateData.employment_type = data.employmentType;
    if (data.contractType !== undefined) updateData.contract_type = data.contractType;
    if (data.jobTitle !== undefined) updateData.job_title = data.jobTitle;
    if (data.department !== undefined) updateData.department = data.department;
    if (data.startDate !== undefined) updateData.start_date = data.startDate;
    if (data.endDate !== undefined) updateData.end_date = data.endDate;
    if (data.salaryAmount !== undefined) updateData.salary_amount = data.salaryAmount;
    if (data.salaryCurrency !== undefined) updateData.salary_currency = data.salaryCurrency;
    if (data.salaryFrequency !== undefined) updateData.salary_frequency = data.salaryFrequency;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.taxId !== undefined) updateData.tax_id = data.taxId;
    if (data.bankName !== undefined) updateData.bank_name = data.bankName;
    if (data.bankAccount !== undefined) updateData.bank_account = data.bankAccount;
    if (data.bankRouting !== undefined) updateData.bank_routing = data.bankRouting;
    if (data.contractDocumentUrl !== undefined)
      updateData.contract_document_url = data.contractDocumentUrl;
    if (data.notes !== undefined) updateData.notes = data.notes;

    return this.db.update("global_employees", empId, updateData);
  }

  async terminateGlobalEmployee(orgId: string, empId: string, reason?: string) {
    const emp = await this.db.findOne<any>("global_employees", {
      id: empId,
      empcloud_org_id: Number(orgId),
    });
    if (!emp) throw new AppError(404, "NOT_FOUND", "Global employee not found");
    if (emp.status === "terminated") {
      throw new AppError(400, "ALREADY_TERMINATED", "Employee is already terminated");
    }

    return this.db.update("global_employees", empId, {
      status: "offboarding",
      end_date: new Date().toISOString().split("T")[0],
      notes: reason
        ? `${emp.notes ? emp.notes + "\n" : ""}Termination reason: ${reason}`
        : emp.notes,
    });
  }

  // ---------------------------------------------------------------------------
  // Global Payroll Runs
  // ---------------------------------------------------------------------------

  async createPayrollRun(orgId: string, countryId: string, month: number, year: number) {
    const numOrgId = Number(orgId);

    const country = await this.db.findById<any>("countries", countryId);
    if (!country) throw new AppError(404, "NOT_FOUND", "Country not found");

    // Check for duplicate run
    const existing = await this.db.findOne<any>("global_payroll_runs", {
      empcloud_org_id: numOrgId,
      country_id: countryId,
      period_month: month,
      period_year: year,
    });
    if (existing && existing.status !== "cancelled") {
      throw new AppError(
        409,
        "DUPLICATE_RUN",
        `A payroll run already exists for ${country.name} ${month}/${year}`,
      );
    }

    // Get active employees in this country
    const employees = await this.db.findMany<any>("global_employees", {
      filters: {
        empcloud_org_id: numOrgId,
        country_id: countryId,
        status: "active",
        employment_type: "eor", // Only EOR and direct_hire go through payroll
      },
      limit: 1000,
    });

    // Also include direct_hire
    const directHires = await this.db.findMany<any>("global_employees", {
      filters: {
        empcloud_org_id: numOrgId,
        country_id: countryId,
        status: "active",
        employment_type: "direct_hire",
      },
      limit: 1000,
    });

    const allEmployees = [...employees.data, ...directHires.data];

    if (allEmployees.length === 0) {
      throw new AppError(
        400,
        "NO_EMPLOYEES",
        `No active EOR/direct-hire employees found in ${country.name}`,
      );
    }

    // Create payroll run
    const run = await this.db.create<any>("global_payroll_runs", {
      empcloud_org_id: numOrgId,
      country_id: countryId,
      period_month: month,
      period_year: year,
      status: "draft",
      currency: country.currency,
      exchange_rate_to_base: 1,
    });

    let totalGross = 0;
    let totalDeductions = 0;
    let totalEmployerCost = 0;
    let totalNet = 0;

    // Calculate payroll items for each employee
    for (const emp of allEmployees) {
      // Convert salary to monthly if needed
      let monthlyGross = Number(emp.salary_amount);
      switch (emp.salary_frequency) {
        case "annual":
          monthlyGross = Math.round(monthlyGross / 12);
          break;
        case "biweekly":
          monthlyGross = Math.round((monthlyGross * 26) / 12);
          break;
        case "weekly":
          monthlyGross = Math.round((monthlyGross * 52) / 12);
          break;
      }

      const deductions = calculateDeductions(monthlyGross, country);

      const totalEmployeeDeductions =
        deductions.tax_amount +
        deductions.social_security_employee +
        deductions.pension_employee +
        deductions.health_insurance_employee +
        deductions.other_deductions;

      const totalEmployerContributions =
        deductions.social_security_employer +
        deductions.pension_employer +
        deductions.health_insurance_employer;

      const netSalary = monthlyGross - totalEmployeeDeductions;
      const employerCost = monthlyGross + totalEmployerContributions;

      await this.db.create("global_payroll_items", {
        payroll_run_id: run.id,
        empcloud_org_id: numOrgId,
        global_employee_id: emp.id,
        gross_salary: monthlyGross,
        tax_amount: deductions.tax_amount,
        social_security_employee: deductions.social_security_employee,
        social_security_employer: deductions.social_security_employer,
        pension_employee: deductions.pension_employee,
        pension_employer: deductions.pension_employer,
        health_insurance_employee: deductions.health_insurance_employee,
        health_insurance_employer: deductions.health_insurance_employer,
        other_deductions: deductions.other_deductions,
        net_salary: netSalary,
        total_employer_cost: employerCost,
        currency: emp.salary_currency || country.currency,
      });

      totalGross += monthlyGross;
      totalDeductions += totalEmployeeDeductions;
      totalEmployerCost += employerCost;
      totalNet += netSalary;
    }

    // Update run totals
    await this.db.update("global_payroll_runs", run.id, {
      total_gross: totalGross,
      total_deductions: totalDeductions,
      total_employer_cost: totalEmployerCost,
      total_net: totalNet,
    });

    return {
      ...(await this.db.findById<any>("global_payroll_runs", run.id)),
      employee_count: allEmployees.length,
    };
  }

  async listPayrollRuns(
    orgId: string,
    filters?: { countryId?: string; status?: string; year?: number },
  ) {
    const where: Record<string, any> = { empcloud_org_id: Number(orgId) };
    if (filters?.countryId) where.country_id = filters.countryId;
    if (filters?.status) where.status = filters.status;
    if (filters?.year) where.period_year = filters.year;

    const result = await this.db.findMany<any>("global_payroll_runs", {
      filters: where,
      sort: { field: "created_at", order: "desc" },
      limit: 200,
    });

    // Enrich with country names
    const countryIds = [...new Set(result.data.map((r: any) => r.country_id))];
    const countryMap: Record<string, any> = {};
    for (const cid of countryIds) {
      const c = await this.db.findById<any>("countries", cid as string);
      if (c) countryMap[cid as string] = c;
    }

    return {
      ...result,
      data: result.data.map((r: any) => ({
        ...r,
        country_name: countryMap[r.country_id]?.name || "Unknown",
        country_code: countryMap[r.country_id]?.code || "",
        currency_symbol: countryMap[r.country_id]?.currency_symbol || "",
      })),
    };
  }

  async getPayrollRun(orgId: string, runId: string) {
    const run = await this.db.findOne<any>("global_payroll_runs", {
      id: runId,
      empcloud_org_id: Number(orgId),
    });
    if (!run) throw new AppError(404, "NOT_FOUND", "Payroll run not found");

    const country = await this.db.findById<any>("countries", run.country_id);

    const items = await this.db.findMany<any>("global_payroll_items", {
      filters: { payroll_run_id: runId },
      limit: 1000,
    });

    // Enrich items with employee names
    const empIds = [...new Set(items.data.map((i: any) => i.global_employee_id))];
    const empMap: Record<string, any> = {};
    for (const eid of empIds) {
      const emp = await this.db.findById<any>("global_employees", eid as string);
      if (emp) empMap[eid as string] = emp;
    }

    return {
      ...run,
      country_name: country?.name || "Unknown",
      country_code: country?.code || "",
      currency_symbol: country?.currency_symbol || "",
      items: items.data.map((i: any) => ({
        ...i,
        employee_name: empMap[i.global_employee_id]
          ? `${empMap[i.global_employee_id].first_name} ${empMap[i.global_employee_id].last_name}`
          : "Unknown",
        employee_email: empMap[i.global_employee_id]?.email || "",
      })),
    };
  }

  async approvePayrollRun(orgId: string, runId: string, userId: string) {
    const run = await this.db.findOne<any>("global_payroll_runs", {
      id: runId,
      empcloud_org_id: Number(orgId),
    });
    if (!run) throw new AppError(404, "NOT_FOUND", "Payroll run not found");
    if (run.status !== "draft" && run.status !== "processing") {
      throw new AppError(400, "INVALID_STATUS", `Cannot approve a run with status "${run.status}"`);
    }

    return this.db.update("global_payroll_runs", runId, {
      status: "approved",
      approved_by: Number(userId),
    });
  }

  async markPayrollRunPaid(orgId: string, runId: string) {
    const run = await this.db.findOne<any>("global_payroll_runs", {
      id: runId,
      empcloud_org_id: Number(orgId),
    });
    if (!run) throw new AppError(404, "NOT_FOUND", "Payroll run not found");
    if (run.status !== "approved") {
      throw new AppError(400, "INVALID_STATUS", "Only approved runs can be marked as paid");
    }

    return this.db.update("global_payroll_runs", runId, {
      status: "paid",
      paid_at: new Date(),
    });
  }

  // ---------------------------------------------------------------------------
  // Contractor Invoices
  // ---------------------------------------------------------------------------

  async submitContractorInvoice(orgId: string, empId: string, data: any) {
    const numOrgId = Number(orgId);

    const emp = await this.db.findOne<any>("global_employees", {
      id: empId,
      empcloud_org_id: numOrgId,
    });
    if (!emp) throw new AppError(404, "NOT_FOUND", "Global employee not found");
    if (emp.employment_type !== "contractor") {
      throw new AppError(400, "NOT_CONTRACTOR", "Only contractors can submit invoices");
    }

    // Generate invoice number
    const year = new Date().getFullYear();
    const count = await this.db.count("contractor_invoices", { empcloud_org_id: numOrgId });
    const invoiceNumber = `INV-${year}-${String(count + 1).padStart(5, "0")}`;

    return this.db.create("contractor_invoices", {
      empcloud_org_id: numOrgId,
      global_employee_id: empId,
      invoice_number: invoiceNumber,
      amount: data.amount,
      currency: data.currency || emp.salary_currency,
      description: data.description || null,
      period_start: data.periodStart,
      period_end: data.periodEnd,
      status: "pending",
      submitted_at: new Date(),
    });
  }

  async listContractorInvoices(orgId: string, filters?: { status?: string; employeeId?: string }) {
    const where: Record<string, any> = { empcloud_org_id: Number(orgId) };
    if (filters?.status) where.status = filters.status;
    if (filters?.employeeId) where.global_employee_id = filters.employeeId;

    const result = await this.db.findMany<any>("contractor_invoices", {
      filters: where,
      sort: { field: "submitted_at", order: "desc" },
      limit: 200,
    });

    // Enrich with contractor names
    const empIds = [...new Set(result.data.map((i: any) => i.global_employee_id))];
    const empMap: Record<string, any> = {};
    for (const eid of empIds) {
      const emp = await this.db.findById<any>("global_employees", eid as string);
      if (emp) empMap[eid as string] = emp;
    }

    return {
      ...result,
      data: result.data.map((i: any) => ({
        ...i,
        contractor_name: empMap[i.global_employee_id]
          ? `${empMap[i.global_employee_id].first_name} ${empMap[i.global_employee_id].last_name}`
          : "Unknown",
        contractor_email: empMap[i.global_employee_id]?.email || "",
      })),
    };
  }

  async approveContractorInvoice(orgId: string, invoiceId: string, userId: string) {
    const invoice = await this.db.findOne<any>("contractor_invoices", {
      id: invoiceId,
      empcloud_org_id: Number(orgId),
    });
    if (!invoice) throw new AppError(404, "NOT_FOUND", "Invoice not found");
    if (invoice.status !== "pending") {
      throw new AppError(
        400,
        "INVALID_STATUS",
        `Cannot approve an invoice with status "${invoice.status}"`,
      );
    }

    return this.db.update("contractor_invoices", invoiceId, {
      status: "approved",
      approved_by: Number(userId),
    });
  }

  async rejectContractorInvoice(orgId: string, invoiceId: string) {
    const invoice = await this.db.findOne<any>("contractor_invoices", {
      id: invoiceId,
      empcloud_org_id: Number(orgId),
    });
    if (!invoice) throw new AppError(404, "NOT_FOUND", "Invoice not found");
    if (invoice.status !== "pending") {
      throw new AppError(
        400,
        "INVALID_STATUS",
        `Cannot reject an invoice with status "${invoice.status}"`,
      );
    }

    return this.db.update("contractor_invoices", invoiceId, { status: "rejected" });
  }

  async markInvoicePaid(orgId: string, invoiceId: string) {
    const invoice = await this.db.findOne<any>("contractor_invoices", {
      id: invoiceId,
      empcloud_org_id: Number(orgId),
    });
    if (!invoice) throw new AppError(404, "NOT_FOUND", "Invoice not found");
    if (invoice.status !== "approved") {
      throw new AppError(400, "INVALID_STATUS", "Only approved invoices can be marked as paid");
    }

    return this.db.update("contractor_invoices", invoiceId, {
      status: "paid",
      paid_at: new Date(),
    });
  }

  // ---------------------------------------------------------------------------
  // Compliance Checklist
  // ---------------------------------------------------------------------------

  async getComplianceChecklist(orgId: string, empId: string) {
    const emp = await this.db.findOne<any>("global_employees", {
      id: empId,
      empcloud_org_id: Number(orgId),
    });
    if (!emp) throw new AppError(404, "NOT_FOUND", "Global employee not found");

    const checklist = await this.db.findMany<any>("compliance_checklist", {
      filters: { empcloud_org_id: Number(orgId), global_employee_id: empId },
      sort: { field: "category", order: "asc" },
      limit: 100,
    });

    const total = checklist.data.length;
    const completed = checklist.data.filter((c: any) => c.is_completed).length;

    return {
      employee: `${emp.first_name} ${emp.last_name}`,
      items: checklist.data,
      total,
      completed,
      percentage: total ? Math.round((completed / total) * 100) : 0,
    };
  }

  async updateChecklistItem(orgId: string, itemId: string, completed: boolean, userId?: string) {
    const item = await this.db.findOne<any>("compliance_checklist", {
      id: itemId,
      empcloud_org_id: Number(orgId),
    });
    if (!item) throw new AppError(404, "NOT_FOUND", "Checklist item not found");

    return this.db.update("compliance_checklist", itemId, {
      is_completed: completed,
      completed_at: completed ? new Date() : null,
      completed_by: completed && userId ? Number(userId) : null,
    });
  }

  async addChecklistItem(
    orgId: string,
    empId: string,
    data: { item: string; category: string; dueDate?: string },
  ) {
    const emp = await this.db.findOne<any>("global_employees", {
      id: empId,
      empcloud_org_id: Number(orgId),
    });
    if (!emp) throw new AppError(404, "NOT_FOUND", "Global employee not found");

    return this.db.create("compliance_checklist", {
      empcloud_org_id: Number(orgId),
      global_employee_id: empId,
      item: data.item,
      is_completed: false,
      category: data.category,
      due_date: data.dueDate || null,
    });
  }

  // ---------------------------------------------------------------------------
  // Dashboard & Analytics
  // ---------------------------------------------------------------------------

  async getGlobalDashboard(orgId: string) {
    const numOrgId = Number(orgId);

    // Total employees by status
    const totalActive = await this.db.count("global_employees", {
      empcloud_org_id: numOrgId,
      status: "active",
    });
    const totalOnboarding = await this.db.count("global_employees", {
      empcloud_org_id: numOrgId,
      status: "onboarding",
    });
    const totalContractors = await this.db.count("global_employees", {
      empcloud_org_id: numOrgId,
      employment_type: "contractor",
    });
    const totalEOR = await this.db.count("global_employees", {
      empcloud_org_id: numOrgId,
      employment_type: "eor",
    });

    // Employees by country
    const allEmployees = await this.db.findMany<any>("global_employees", {
      filters: { empcloud_org_id: numOrgId },
      limit: 5000,
    });

    const countryIds = [...new Set(allEmployees.data.map((e: any) => e.country_id))];
    const countryMap: Record<string, any> = {};
    for (const cid of countryIds) {
      const c = await this.db.findById<any>("countries", cid as string);
      if (c) countryMap[cid as string] = c;
    }

    const byCountry: Record<
      string,
      { name: string; code: string; count: number; currency: string }
    > = {};
    for (const emp of allEmployees.data) {
      const country = countryMap[emp.country_id];
      if (!country) continue;
      if (!byCountry[country.code]) {
        byCountry[country.code] = {
          name: country.name,
          code: country.code,
          count: 0,
          currency: country.currency,
        };
      }
      byCountry[country.code].count++;
    }

    // Monthly cost by currency
    const costByCurrency: Record<string, number> = {};
    for (const emp of allEmployees.data.filter((e: any) => e.status === "active")) {
      const curr = emp.salary_currency || "USD";
      let monthly = Number(emp.salary_amount);
      if (emp.salary_frequency === "annual") monthly = Math.round(monthly / 12);
      else if (emp.salary_frequency === "biweekly") monthly = Math.round((monthly * 26) / 12);
      else if (emp.salary_frequency === "weekly") monthly = Math.round((monthly * 52) / 12);
      costByCurrency[curr] = (costByCurrency[curr] || 0) + monthly;
    }

    // Compliance average
    const allChecklist = await this.db.findMany<any>("compliance_checklist", {
      filters: { empcloud_org_id: numOrgId },
      limit: 10000,
    });
    const totalItems = allChecklist.data.length;
    const completedItems = allChecklist.data.filter((c: any) => c.is_completed).length;
    const compliancePercentage = totalItems ? Math.round((completedItems / totalItems) * 100) : 100;

    // Pending contractor invoices
    const pendingInvoices = await this.db.count("contractor_invoices", {
      empcloud_org_id: numOrgId,
      status: "pending",
    });

    const approvedInvoices = await this.db.findMany<any>("contractor_invoices", {
      filters: { empcloud_org_id: numOrgId, status: "approved" },
      limit: 1000,
    });
    const pendingPaymentAmount = approvedInvoices.data.reduce(
      (sum: number, i: any) => sum + Number(i.amount),
      0,
    );

    return {
      totalActive,
      totalOnboarding,
      totalContractors,
      totalEOR,
      totalCountries: Object.keys(byCountry).length,
      employeesByCountry: Object.values(byCountry).sort((a, b) => b.count - a.count),
      costByCurrency,
      compliancePercentage,
      pendingInvoices,
      pendingPaymentAmount,
    };
  }

  async getCostAnalysis(orgId: string) {
    const numOrgId = Number(orgId);

    // Get all active employees
    const employees = await this.db.findMany<any>("global_employees", {
      filters: { empcloud_org_id: numOrgId, status: "active" },
      limit: 5000,
    });

    const countryIds = [...new Set(employees.data.map((e: any) => e.country_id))];
    const countryMap: Record<string, any> = {};
    for (const cid of countryIds) {
      const c = await this.db.findById<any>("countries", cid as string);
      if (c) countryMap[cid as string] = c;
    }

    // Per-country cost breakdown
    const countryBreakdown: Record<
      string,
      {
        name: string;
        code: string;
        currency: string;
        currency_symbol: string;
        employee_count: number;
        total_gross: number;
        total_employer_cost: number;
        total_net: number;
        avg_salary: number;
      }
    > = {};

    for (const emp of employees.data) {
      const country = countryMap[emp.country_id];
      if (!country) continue;

      let monthlyGross = Number(emp.salary_amount);
      if (emp.salary_frequency === "annual") monthlyGross = Math.round(monthlyGross / 12);
      else if (emp.salary_frequency === "biweekly")
        monthlyGross = Math.round((monthlyGross * 26) / 12);
      else if (emp.salary_frequency === "weekly")
        monthlyGross = Math.round((monthlyGross * 52) / 12);

      const deductions = calculateDeductions(monthlyGross, country);
      const totalEmployeeDeductions =
        deductions.tax_amount +
        deductions.social_security_employee +
        deductions.pension_employee +
        deductions.health_insurance_employee +
        deductions.other_deductions;
      const employerContributions =
        deductions.social_security_employer +
        deductions.pension_employer +
        deductions.health_insurance_employer;
      const netSalary = monthlyGross - totalEmployeeDeductions;
      const employerCost = monthlyGross + employerContributions;

      if (!countryBreakdown[country.code]) {
        countryBreakdown[country.code] = {
          name: country.name,
          code: country.code,
          currency: country.currency,
          currency_symbol: country.currency_symbol,
          employee_count: 0,
          total_gross: 0,
          total_employer_cost: 0,
          total_net: 0,
          avg_salary: 0,
        };
      }

      const cb = countryBreakdown[country.code];
      cb.employee_count++;
      cb.total_gross += monthlyGross;
      cb.total_employer_cost += employerCost;
      cb.total_net += netSalary;
    }

    // Calculate averages
    for (const cb of Object.values(countryBreakdown)) {
      cb.avg_salary = cb.employee_count ? Math.round(cb.total_gross / cb.employee_count) : 0;
    }

    // Employment type breakdown
    const byType = {
      eor: employees.data.filter((e: any) => e.employment_type === "eor").length,
      contractor: employees.data.filter((e: any) => e.employment_type === "contractor").length,
      direct_hire: employees.data.filter((e: any) => e.employment_type === "direct_hire").length,
    };

    return {
      countryBreakdown: Object.values(countryBreakdown).sort(
        (a, b) => b.total_employer_cost - a.total_employer_cost,
      ),
      byEmploymentType: byType,
      totalEmployees: employees.data.length,
    };
  }
}
