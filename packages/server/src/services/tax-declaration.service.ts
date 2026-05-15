import { v4 as uuidv4 } from "uuid";
import { getDB } from "../db/adapters";
import { findUserById } from "../db/empcloud";
import { AppError } from "../api/middleware/error.middleware";
import { logger } from "../utils/logger";
import { computeIncomeTax } from "./tax/india-tax.service";
import { TaxRegime } from "@emp-payroll/shared";

/**
 * Prior-employer TDS payload (Form 12B). Stored as a per-FY map under
 * `tax_info.priorEmployerTds[fy]` on the employee profile. `grossPaid`
 * captures the income the previous employer paid out this FY (so it can be
 * added to the slab base), and `tdsDeducted` is what they actually withheld
 * (added to `taxAlreadyPaid` so the new employer doesn't try to re-collect
 * it). `source` is freeform text for HR (e.g. "Form 12B uploaded 2026-09-01").
 */
export interface PriorEmployerTds {
  grossPaid: number;
  tdsDeducted: number;
  exemptionsClaimed?: number;
  deductionsClaimed?: number;
  source?: string;
}

/**
 * Compute how many months remain in the given FY starting from today, with
 * the joining date as a floor: an employee can't have TDS deducted for
 * months they hadn't joined yet. Returns at least 1 so the divide-by-zero
 * guard in computeIncomeTax never fires.
 *
 * Example: FY = 2026-2027 (Apr 2026 - Mar 2027), today = Sep 15 2026,
 * joining = Sep 1 2026 → months = 7 (Sep, Oct, Nov, Dec, Jan, Feb, Mar).
 */
function monthsRemainingFromJoining(
  fy: string,
  joiningDate?: string | Date | null,
  asOf?: Date,
): number {
  const startYear = Number(fy.split("-")[0]);
  if (!Number.isFinite(startYear)) return 12;

  const now = asOf || new Date();
  const fyEnd = new Date(startYear + 1, 2, 31); // March 31 of FY-end year
  const fyStart = new Date(startYear, 3, 1); // April 1 of FY-start year

  // Anchor = max(today, joiningDate, FY start). Clamp to FY end so a
  // post-FY date doesn't produce a negative remainder.
  let anchor = now;
  if (joiningDate) {
    const j = joiningDate instanceof Date ? joiningDate : new Date(joiningDate);
    if (!Number.isNaN(j.getTime()) && j > anchor) anchor = j;
  }
  if (anchor < fyStart) anchor = fyStart;
  if (anchor > fyEnd) return 1;

  // Count whole months from anchor's month up to and including March.
  const anchorYear = anchor.getFullYear();
  const anchorMonth = anchor.getMonth() + 1; // 1-12
  const monthsLeft =
    anchorYear === startYear
      ? 12 - (anchorMonth - 4) // Apr-Dec of start year
      : 4 - anchorMonth; // Jan-Mar of end year (months 1, 2, 3)
  return Math.max(1, monthsLeft);
}

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
    // BUG-YTD-201 — resolve the numeric empcloud_user_id so the YTD lookup
    // has the reliable bridge id available, not just the UUID that was
    // passed in (which often doesn't match payslips.employee_id).
    const { empcloudUserId } = await this.resolveEmployeeIds(employeeId);
    const ytdTds = await this.computeYtdTdsFromPayslips(employeeId, fy, empcloudUserId);
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
  private async computeYtdTdsFromPayslips(
    employeeId: string,
    fy: string,
    empcloudUserId?: number | null,
  ): Promise<number> {
    // FY "2026-2027" → startYear 2026
    const startYear = Number(fy.split("-")[0]);
    if (!Number.isFinite(startYear)) return 0;

    // Collect payslips by every id we know. The `payslips` table can be
    // keyed two ways in practice:
    //   - `employee_id` — UUID from the legacy `employees` table
    //   - `empcloud_user_id` — numeric EmpCloud user id, the reliable
    //     bridge across `employees`, `employee_payroll_profiles`, and
    //     `payslips`.
    // The `employee_id` UUID stored on payslips is NOT the same as
    // `employee_payroll_profiles.id` -- SSO-provisioned users keep their
    // profile under a different UUID than the legacy employees row.
    // BUG-YTD-201 (2026-05-15) — previously this function only tried the
    // `employee_id` UUID and the numeric form, so when a caller handed it
    // a profile UUID, every payslip lookup missed and YTD came back as
    // ₹0 -- inflating May+ TDS projections for every employee whose April
    // payslip had already been generated. Take `empcloudUserId`
    // explicitly so we always have the reliable numeric path available.
    const numericFromArg = Number(employeeId);
    const candidateFilters: Array<Record<string, unknown>> = [{ employee_id: employeeId }];
    if (Number.isFinite(numericFromArg)) {
      candidateFilters.push({ empcloud_user_id: numericFromArg });
    }
    if (empcloudUserId != null && Number.isFinite(empcloudUserId)) {
      candidateFilters.push({ empcloud_user_id: empcloudUserId });
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
    // BUG-YTD-201 — also pass the resolved empcloud_user_id so the lookup
    // catches payslips keyed on the numeric bridge id (the common case
    // for SSO-provisioned users where employee.id != payslips.employee_id).
    const taxAlreadyPaid = await this.computeYtdTdsFromPayslips(
      employeeId,
      fy,
      employee.empcloud_user_id != null ? Number(employee.empcloud_user_id) : null,
    );

    // Joining-date aware monthsRemaining, plus Form-12B / prior-employer
    // values from the profile so mid-FY joiners aren't over-deducted.
    const ecUser = employee.empcloud_user_id
      ? await findUserById(employee.empcloud_user_id).catch(() => null)
      : null;
    const joiningDate: string | null = ecUser?.date_of_joining
      ? typeof ecUser.date_of_joining === "string"
        ? ecUser.date_of_joining.slice(0, 10)
        : new Date(ecUser.date_of_joining as any).toISOString().slice(0, 10)
      : null;
    const monthsRemaining = monthsRemainingFromJoining(fy, joiningDate);
    const priorEmp: PriorEmployerTds = (taxInfo?.priorEmployerTds &&
      taxInfo.priorEmployerTds[fy]) || {
      grossPaid: 0,
      tdsDeducted: 0,
    };
    const priorGross = Number(priorEmp.grossPaid || 0);
    const priorTds = Number(priorEmp.tdsDeducted || 0);

    const result = computeIncomeTax({
      employeeId,
      financialYear: fy,
      regime: taxInfo?.regime === "old" ? TaxRegime.OLD : TaxRegime.NEW,
      annualGross: Number(salary.gross_salary) + priorGross,
      basicAnnual,
      hraAnnual,
      rentPaidAnnual: 0,
      isMetroCity: false,
      declarations: declInput,
      employeePfAnnual: basicAnnual * 0.12,
      monthsWorked: monthsRemaining,
      taxAlreadyPaid,
      priorEmployerTds: priorTds,
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

  /**
   * Pre-fill payload for the admin Tax Calculator page. Loads the employee's
   * current contracted salary (BASIC/HRA/gross), tax_info (regime + PAN), and
   * approved declarations for the current FY so the page can render initial
   * inputs that already match what the payroll run would compute. No DB
   * writes -- this is read-only.
   */
  async getCalculatorPrefill(employeeId: string) {
    const fy = this.currentFY();

    // BUG-FIX — The employee picker (/employees) returns rows keyed by the
    // EmpCloud numeric user id, while older code paths assume the payroll
    // `employees.id` UUID. Resolve both so the calculator works regardless
    // of which id shape the page sends. Same dual-id resolution that
    // tax_declarations submit/approve uses.
    const { employeeRowId, empcloudUserId } = await this.resolveEmployeeIds(employeeId);

    // Fetch tax_info + pan from whichever row exists. Try the legacy
    // payroll `employees` table first, then fall back to the newer
    // `employee_payroll_profiles` row that SSO-provisioned users land on.
    let taxInfo: any = null;
    let profileId: string | null = employeeRowId;
    if (employeeRowId) {
      const emp = await this.db.findById<any>("employees", employeeRowId).catch(() => null);
      if (emp) {
        taxInfo =
          typeof emp.tax_info === "string" ? JSON.parse(emp.tax_info || "{}") : emp.tax_info;
      }
    }
    if (!taxInfo && empcloudUserId != null) {
      const profile = await this.db
        .findOne<any>("employee_payroll_profiles", { empcloud_user_id: empcloudUserId })
        .catch(() => null);
      if (profile) {
        taxInfo =
          typeof profile.tax_info === "string"
            ? JSON.parse(profile.tax_info || "{}")
            : profile.tax_info;
        if (!profileId) profileId = profile.id;
      }
    }

    // Active salary — try matching on payroll employee_id first, then fall
    // back to empcloud_user_id which is what the salary rows for SSO-only
    // profiles are keyed on.
    let salary: any = null;
    if (profileId) {
      salary = await this.db
        .findOne<any>("employee_salaries", { employee_id: profileId, is_active: true })
        .catch(() => null);
    }
    if (!salary && empcloudUserId != null) {
      salary = await this.db
        .findOne<any>("employee_salaries", {
          empcloud_user_id: empcloudUserId,
          is_active: true,
        })
        .catch(() => null);
    }

    const components = salary
      ? typeof salary.components === "string"
        ? JSON.parse(salary.components || "[]")
        : salary.components
      : [];

    const basicMonthly = Array.isArray(components)
      ? Number(components.find((c: any) => c.code === "BASIC")?.monthlyAmount || 0)
      : 0;
    const hraMonthly = Array.isArray(components)
      ? Number(components.find((c: any) => c.code === "HRA")?.monthlyAmount || 0)
      : 0;
    const basicAnnual = basicMonthly * 12;
    const hraAnnual = hraMonthly * 12;

    // Declarations — same dual-id filter pattern as getDeclarations.
    const declFilter: Record<string, any> = profileId
      ? { employee_id: profileId, financial_year: fy, approval_status: "approved" }
      : empcloudUserId != null
        ? {
            empcloud_user_id: empcloudUserId,
            financial_year: fy,
            approval_status: "approved",
          }
        : { financial_year: fy, approval_status: "approved" };

    const decls = await this.db
      .findMany<any>("tax_declarations", { filters: declFilter, limit: 100 })
      .catch(() => ({ data: [] as any[] }));

    // Joining date + mid-FY check. Pulled from the EmpCloud user record
    // (single source of truth -- the payroll-side profile doesn't store
    // a separate date_of_joining). Used by the UI to flag mid-FY joiners
    // and to size the "months at this employer" projection.
    let joiningDate: string | null = null;
    if (empcloudUserId != null) {
      const ecUser = await findUserById(empcloudUserId).catch(() => null);
      if (ecUser?.date_of_joining) {
        joiningDate =
          typeof ecUser.date_of_joining === "string"
            ? ecUser.date_of_joining.slice(0, 10)
            : new Date(ecUser.date_of_joining as any).toISOString().slice(0, 10);
      }
    }
    const fyStartYear = Number(fy.split("-")[0]);
    const fyStart = new Date(fyStartYear, 3, 1); // Apr 1
    const fyEnd = new Date(fyStartYear + 1, 2, 31); // Mar 31
    const joinDateObj = joiningDate ? new Date(joiningDate) : null;
    const isMidFyJoiner =
      !!joinDateObj && joinDateObj >= fyStart && joinDateObj <= fyEnd && joinDateObj > fyStart;
    const monthsRemainingInFy = monthsRemainingFromJoining(fy, joiningDate);

    // Prior-employer payload from Form 12B, if HR captured it.
    const priorEmployer: PriorEmployerTds = (taxInfo?.priorEmployerTds &&
      taxInfo.priorEmployerTds[fy]) || {
      grossPaid: 0,
      tdsDeducted: 0,
    };

    return {
      employeeId,
      resolvedEmployeeId: profileId,
      financialYear: fy,
      regime: taxInfo?.regime === "old" ? "old" : "new",
      pan: typeof taxInfo?.pan === "string" ? taxInfo.pan : "",
      annualGross: salary ? Number(salary.gross_salary || 0) : 0,
      basicAnnual,
      hraAnnual,
      employeePfAnnual: Math.round(basicAnnual * 0.12),
      rentPaidAnnual: 0,
      isMetroCity: false,
      declarations: decls.data.map((d: any) => ({
        section: d.section,
        description: d.description,
        amount: Number(d.approved_amount || d.declared_amount || 0),
      })),
      hasActiveSalary: !!salary,
      // Joining-date awareness — surfaces a "mid-FY joiner" prompt in the
      // calculator and lets HR see exactly how the months left were derived.
      joiningDate,
      isMidFyJoiner,
      monthsRemainingInFy,
      // Form-12B / prior employer values. Returned every time (zeroed when
      // not set) so the UI can render the field unconditionally.
      priorEmployerGross: Number(priorEmployer.grossPaid || 0),
      priorEmployerTds: Number(priorEmployer.tdsDeducted || 0),
      priorEmployerSource: priorEmployer.source || "",
    };
  }

  /**
   * What-if tax calculation for the admin Tax Calculator. Runs the same
   * computeIncomeTax engine the payroll run uses, but with caller-supplied
   * inputs and WITHOUT persisting anything to tax_computations. The
   * `taxAlreadyPaid` figure is sourced from real YTD payslip TDS so the
   * "remaining" projection reflects reality.
   */
  async simulate(input: {
    employeeId: string;
    regime: "new" | "old";
    annualGross: number;
    basicAnnual: number;
    hraAnnual: number;
    rentPaidAnnual: number;
    isMetroCity: boolean;
    declarations: { section: string; amount: number }[];
    employeePfAnnual: number;
    panNumber?: string | null;
    // Form 12B / prior-employer additions. Both optional so the existing
    // single-employer path produces identical numbers when callers don't
    // supply them.
    priorEmployerGross?: number;
    priorEmployerTds?: number;
  }) {
    const fy = this.currentFY();

    // Resolve dual ids so we can look up payslips, joining date, and the
    // profile row regardless of which id shape the page sends.
    const { employeeRowId, empcloudUserId } = await this.resolveEmployeeIds(input.employeeId);
    // BUG-YTD-201 — pass BOTH the resolved UUID and the numeric empcloud
    // user id so the YTD lookup can match payslips keyed on either.
    // Previously only employeeRowId was passed, which silently missed
    // every payslip whose `employee_id` UUID didn't equal the profile
    // UUID (the common case for SSO-provisioned users). Result was
    // `taxAlreadyPaid = 0` whenever the calculator was run for someone
    // who actually had prior payslips this FY.
    const idForYtd = employeeRowId || (empcloudUserId != null ? String(empcloudUserId) : null);
    const taxAlreadyPaid = idForYtd
      ? await this.computeYtdTdsFromPayslips(idForYtd, fy, empcloudUserId)
      : 0;

    // Joining-date aware months remaining. For a mid-FY joiner the months
    // available to spread TDS over starts at their joining date, not at
    // April -- otherwise the engine would project zero TDS for months they
    // weren't actually employed.
    let joiningDate: string | null = null;
    if (empcloudUserId != null) {
      const ecUser = await findUserById(empcloudUserId).catch(() => null);
      if (ecUser?.date_of_joining) {
        joiningDate =
          typeof ecUser.date_of_joining === "string"
            ? ecUser.date_of_joining.slice(0, 10)
            : new Date(ecUser.date_of_joining as any).toISOString().slice(0, 10);
      }
    }
    const monthsRemaining = monthsRemainingFromJoining(fy, joiningDate);

    // The engine treats `annualGross` as the COMBINED FY income across all
    // employers (so slab/cess apply to total earnings). Add prior employer
    // gross here so the caller can pass just this-employer CTC and let the
    // service handle the combination.
    const priorGross = Number(input.priorEmployerGross || 0);
    const priorTds = Number(input.priorEmployerTds || 0);
    const combinedAnnualGross = Number(input.annualGross || 0) + priorGross;

    const result = computeIncomeTax({
      employeeId: input.employeeId,
      financialYear: fy,
      regime: input.regime === "old" ? TaxRegime.OLD : TaxRegime.NEW,
      annualGross: combinedAnnualGross,
      basicAnnual: input.basicAnnual,
      hraAnnual: input.hraAnnual,
      rentPaidAnnual: input.rentPaidAnnual,
      isMetroCity: input.isMetroCity,
      declarations: input.declarations,
      employeePfAnnual: input.employeePfAnnual,
      monthsWorked: monthsRemaining,
      taxAlreadyPaid,
      priorEmployerTds: priorTds,
      panNumber: input.panNumber ?? null,
    });

    // Surface the joining-date inputs alongside the result so the UI can
    // explain how `remainingMonths` was derived without making another
    // call.
    return {
      ...result,
      joiningDate,
      monthsRemainingUsed: monthsRemaining,
      priorEmployerGross: priorGross,
      priorEmployerTdsInput: priorTds,
    };
  }

  /**
   * Persist Form-12B / prior-employer values onto the employee's
   * `tax_info.priorEmployerTds[fy]` blob so future payroll runs and tax
   * computations factor it in. Idempotent — overwrites whatever was there
   * for the same FY.
   */
  async setPriorEmployerTds(
    employeeId: string,
    fy: string,
    payload: PriorEmployerTds,
  ): Promise<PriorEmployerTds> {
    const { employeeRowId, empcloudUserId } = await this.resolveEmployeeIds(employeeId);

    // Try `employees` first, fall back to `employee_payroll_profiles`
    // (SSO-provisioned users live there only).
    let table: "employees" | "employee_payroll_profiles" | null = null;
    let rowId: string | null = null;
    let taxInfo: any = null;

    if (employeeRowId) {
      const emp = await this.db.findById<any>("employees", employeeRowId).catch(() => null);
      if (emp) {
        table = "employees";
        rowId = employeeRowId;
        taxInfo =
          typeof emp.tax_info === "string" ? JSON.parse(emp.tax_info || "{}") : emp.tax_info || {};
      }
    }
    if (!table && empcloudUserId != null) {
      const profile = await this.db
        .findOne<any>("employee_payroll_profiles", { empcloud_user_id: empcloudUserId })
        .catch(() => null);
      if (profile) {
        table = "employee_payroll_profiles";
        rowId = profile.id;
        taxInfo =
          typeof profile.tax_info === "string"
            ? JSON.parse(profile.tax_info || "{}")
            : profile.tax_info || {};
      }
    }
    if (!table || !rowId) {
      throw new AppError(404, "NOT_FOUND", "Employee profile not found");
    }

    taxInfo = taxInfo || {};
    taxInfo.priorEmployerTds = taxInfo.priorEmployerTds || {};
    const sanitized: PriorEmployerTds = {
      grossPaid: Math.max(0, Number(payload.grossPaid) || 0),
      tdsDeducted: Math.max(0, Number(payload.tdsDeducted) || 0),
      exemptionsClaimed: Math.max(0, Number(payload.exemptionsClaimed) || 0),
      deductionsClaimed: Math.max(0, Number(payload.deductionsClaimed) || 0),
      source: typeof payload.source === "string" ? payload.source.slice(0, 200) : "",
    };
    taxInfo.priorEmployerTds[fy] = sanitized;

    await this.db.update(table, rowId, { tax_info: JSON.stringify(taxInfo) });
    return sanitized;
  }

  async getDeclarations(employeeId: string, financialYear?: string) {
    const fy = financialYear || this.currentFY();
    // Self-service routes pass the numeric EmpCloud user id; admin routes pass
    // the payroll employees.id UUID. Submit writes both columns so we filter
    // by whichever form the caller supplied.
    if (/^\d+$/.test(employeeId)) {
      return this.db.findMany<any>("tax_declarations", {
        filters: { empcloud_user_id: Number(employeeId), financial_year: fy },
      });
    }
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
    let { empcloudUserId, employeeRowId } = await this.resolveEmployeeIds(employeeId);

    // #333 — When a user authenticated via the password (non-SSO) flow lands
    // here without a payroll profile, declaration submit blew up with the
    // "EMPLOYEE_NOT_IN_PAYROLL" 400. Auto-provision a minimal
    // employee_payroll_profiles row keyed on empcloud_user_id so the
    // self-service flow doesn't dead-end on profile-creation. The profile
    // carries no PII -- it's just enough of a row to satisfy the
    // tax_declarations.employee_id NOT NULL column. (Same pattern as the
    // SSO ensurePayrollProfile() in auth.service.)
    //
    // #372 — The original implementation silently swallowed every error
    // from the auto-provision path with `try { ... } catch {}`, then fell
    // through to the generic EMPLOYEE_NOT_IN_PAYROLL 400. That hid every
    // real failure: a half-provisioned row from a partial run, a races
    // with the SSO ensurePayrollProfile inserting the same empcloud_user_id
    // (the column is UNIQUE), an EmpCloud DB connectivity blip, etc. Now
    // we (a) explicitly pass an `id: uuidv4()` so we mirror the SSO path
    // and don't depend on adapter quirks, (b) re-fetch the row by
    // empcloud_user_id when create() raises a duplicate-key error so we
    // pick up whatever the racing process inserted, and (c) log the actual
    // exception so production failures stop being invisible.
    if (!employeeRowId) {
      const numeric = Number(employeeId);
      if (Number.isFinite(numeric) && numeric > 0) {
        try {
          const ecUser = await findUserById(numeric);
          if (ecUser) {
            try {
              const newProfile: any = await this.db.create("employee_payroll_profiles", {
                id: uuidv4(),
                empcloud_user_id: ecUser.id,
                empcloud_org_id: ecUser.organization_id,
                employee_code: ecUser.emp_code,
                bank_details: JSON.stringify({}),
                tax_info: JSON.stringify({ pan: "", regime: "new" }),
                pf_details: JSON.stringify({}),
                esi_details: JSON.stringify({}),
                is_active: true,
              });
              empcloudUserId = numeric;
              employeeRowId = newProfile.id;
            } catch (createErr: any) {
              // Duplicate-key (ER_DUP_ENTRY / 23505) means another request
              // beat us to it -- re-read the row and continue. Log other
              // errors so they don't get masked as "not in payroll".
              const msg = String(createErr?.message || createErr || "");
              const isDup =
                createErr?.code === "ER_DUP_ENTRY" ||
                createErr?.code === "23505" ||
                /duplicate|unique/i.test(msg);
              if (isDup) {
                const existing = await this.db
                  .findOne<any>("employee_payroll_profiles", {
                    empcloud_user_id: numeric,
                  })
                  .catch(() => null);
                if (existing) {
                  empcloudUserId = numeric;
                  employeeRowId = existing.id;
                }
              } else {
                logger.error(
                  `tax-declaration auto-provision failed for empcloud_user_id=${numeric}: ${msg}`,
                );
              }
            }
          } else {
            logger.warn(`tax-declaration auto-provision: EmpCloud user ${numeric} not found`);
          }
        } catch (lookupErr: any) {
          logger.error(
            `tax-declaration auto-provision lookup failed for empcloud_user_id=${numeric}: ${
              lookupErr?.message || lookupErr
            }`,
          );
        }
      }
    }

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
      // #333 — Profile lookup must tolerate both `is_active: 1` and the
      // legacy `is_active: true` storage shape that older MySQL deployments
      // returned (boolean comparison can fail when the column is
      // tinyint(1) but a row was inserted by `is_active: true` from knex
      // on PostgreSQL/SQLite). Try the strict filter first, then fall back
      // to "any active-or-not" so a freshly-onboarded SSO user can still
      // submit declarations the moment they log in -- previously the
      // strict filter returned null when the row was active=1 but the
      // findOne adapter's WHERE clause coerced the comparison oddly,
      // surfacing as "EMPLOYEE_NOT_IN_PAYROLL".
      const profileActive = await this.db
        .findOne<any>("employee_payroll_profiles", {
          empcloud_user_id: numeric,
          is_active: 1,
        })
        .catch(() => null);
      if (profileActive) {
        return { empcloudUserId: numeric, employeeRowId: profileActive.id };
      }
      const profileAny = await this.db
        .findOne<any>("employee_payroll_profiles", {
          empcloud_user_id: numeric,
        })
        .catch(() => null);
      if (profileAny) {
        return { empcloudUserId: numeric, employeeRowId: profileAny.id };
      }
      return { empcloudUserId: numeric, employeeRowId: null };
    }

    return { empcloudUserId: null, employeeRowId: employeeId };
  }

  // Same numeric-vs-UUID detection as getDeclarations (PR #376) -- the
  // approve / update paths must filter on empcloud_user_id when the route
  // hands us the EmpCloud numeric id, otherwise nothing matches and the
  // operation silently no-ops.
  private buildEmployeeFilter(employeeId: string): Record<string, any> {
    if (/^\d+$/.test(employeeId)) {
      return { empcloud_user_id: Number(employeeId) };
    }
    return { employee_id: employeeId };
  }

  async updateDeclaration(employeeId: string, declId: string, data: any) {
    const decl = await this.db.findOne<any>("tax_declarations", {
      id: declId,
      ...this.buildEmployeeFilter(employeeId),
    });
    if (!decl) throw new AppError(404, "NOT_FOUND", "Declaration not found");
    return this.db.update("tax_declarations", declId, data);
  }

  async approveDeclarations(employeeId: string, approverId: string, fy?: string) {
    const financialYear = fy || this.currentFY();
    const pending = await this.db.findMany<any>("tax_declarations", {
      filters: {
        ...this.buildEmployeeFilter(employeeId),
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

  async approveOneDeclaration(employeeId: string, declId: string, approverId: string) {
    const decl = await this.db.findOne<any>("tax_declarations", {
      id: declId,
      ...this.buildEmployeeFilter(employeeId),
    });
    if (!decl) throw new AppError(404, "NOT_FOUND", "Declaration not found");
    if (decl.approval_status === "approved") {
      return { approved: 0, alreadyApproved: true };
    }
    await this.db.update("tax_declarations", declId, {
      approval_status: "approved",
      approved_amount: decl.declared_amount,
      approved_by: approverId,
      approved_at: new Date(),
    });
    return { approved: 1, alreadyApproved: false };
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
