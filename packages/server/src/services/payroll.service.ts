import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";
import {
  computePF,
  computeESI,
  computeProfessionalTax,
  applyRounding,
  type OrgStatutoryOverrides,
} from "./compliance/india-statutory.service";
import { computeIncomeTax } from "./tax/india-tax.service";
import { TaxRegime } from "@emp-payroll/shared";
import { findUsersByOrgId, findOrgById, getEmpCloudDB } from "../db/empcloud";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import * as cloudHRMS from "./cloud-hrms.service";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

// All EmpCloud tenants are India-based; payroll periods follow the
// IST calendar regardless of where the server runs. Hardcoded for now;
// when multi-region tenants land this should read from org settings.
const PAYROLL_TZ = "Asia/Kolkata";

/**
 * Lift the migration-029 columns off an `organization_payroll_settings`
 * row into the camelCase shape the statutory service expects. Centralised
 * so every call site (PF, ESI, future Form 16 / gratuity) reads from one
 * place and the snake_case ↔ camelCase mapping doesn't drift.
 */
function buildOrgStatutoryOverrides(orgSettings: any): OrgStatutoryOverrides {
  if (!orgSettings) return {};
  const num = (v: unknown): number | null =>
    v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;
  return {
    pfApplyFullBasic:
      orgSettings.pf_apply_full_basic == null ? null : !!Number(orgSettings.pf_apply_full_basic),
    pfMaxEmployeeContribution: num(orgSettings.pf_max_employee_contribution),
    pfDefaultEmployeeRate: num(orgSettings.pf_default_employee_rate),
    esiWageCeiling: num(orgSettings.esi_wage_ceiling),
    roundingPolicy: orgSettings.rounding_policy ?? null,
  };
}

// #1655 — true if (year, month) is strictly *after* the current calendar
// month *in the payroll timezone*. The current month is always allowed
// (orgs run payroll mid-month). Server-local time is wrong here: a UTC
// server is up to ~5.5 hours behind IST, which would block the first
// hours of every IST month from creating the new month's run.
function isFuturePeriod(year: number, month: number): boolean {
  const now = dayjs().tz(PAYROLL_TZ);
  const requested = year * 12 + (month - 1);
  const current = now.year() * 12 + now.month();
  return requested > current;
}

export class PayrollService {
  private db = getDB();

  async listRuns(orgId: string) {
    // Sort by payroll period (year, month) rather than `created_at` so the
    // list reads as a chronological timeline of pay months. Sorting on
    // created_at meant a back-dated catch-up run would land at the top of
    // the list out of period order — QA reported an order of
    // Feb, Mar, Jan, May, Dec, ... (#6).
    //
    // The adapter only supports a single sort field, so we fetch and sort
    // here. The list is bounded (one row per pay period per org), so the
    // in-memory sort is fine.
    const result = await this.db.findMany<any>("payroll_runs", {
      filters: { empcloud_org_id: Number(orgId) },
      sort: { field: "year", order: "desc" },
      limit: 1000,
    });
    if (Array.isArray(result?.data)) {
      result.data.sort((a: any, b: any) => {
        const ya = Number(a.year) || 0;
        const yb = Number(b.year) || 0;
        if (yb !== ya) return yb - ya;
        const ma = Number(a.month) || 0;
        const mb = Number(b.month) || 0;
        return mb - ma;
      });
    }
    return result;
  }

  async getRun(id: string, orgId: string) {
    const run = await this.db.findOne<any>("payroll_runs", { id, empcloud_org_id: Number(orgId) });
    if (!run) throw new AppError(404, "NOT_FOUND", "Payroll run not found");
    return run;
  }

  async createRun(
    orgId: string,
    userId: string,
    data: { month: number; year: number; payDate?: string; notes?: string },
  ) {
    // #1655 — Reject future periods. The validator already does this for
    // calls coming through the route, but the service guard catches any
    // direct invocation (e.g. seed scripts, future migrations) so the
    // rule is enforced exactly once and at the layer that owns the data.
    if (isFuturePeriod(data.year, data.month)) {
      throw new AppError(
        400,
        "FUTURE_PERIOD",
        `Cannot create a payroll run for ${data.month}/${data.year} — period has not started yet`,
      );
    }

    const existing = await this.db.findOne<any>("payroll_runs", {
      empcloud_org_id: Number(orgId),
      month: data.month,
      year: data.year,
    });
    if (existing)
      throw new AppError(
        409,
        "DUPLICATE_RUN",
        `Payroll for ${data.month}/${data.year} already exists`,
      );

    // Auto-calculate pay date from org settings if not provided
    let payDate = data.payDate;
    if (!payDate) {
      const orgSettings = await this.db.findOne<any>("organization_payroll_settings", {
        empcloud_org_id: Number(orgId),
      });
      const payDay = orgSettings?.pay_day ?? 7;
      // Clamp pay day to valid range for the given month
      const maxDay = new Date(data.year, data.month, 0).getDate();
      const day = Math.min(payDay, maxDay);
      payDate = dayjs(
        `${data.year}-${String(data.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      ).format("YYYY-MM-DD");
    }

    const monthNames = [
      "",
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    return this.db.create("payroll_runs", {
      org_id: "00000000-0000-0000-0000-000000000000",
      empcloud_org_id: Number(orgId),
      name: `${monthNames[data.month]} ${data.year} Payroll`,
      month: data.month,
      year: data.year,
      pay_date: payDate,
      status: "draft",
      processed_by: userId,
      notes: data.notes || null,
    });
  }

  async computePayroll(runId: string, orgId: string, authToken?: string) {
    const run = await this.getRun(runId, orgId);
    if (run.status !== "draft") {
      throw new AppError(400, "INVALID_STATUS", "Only draft payroll runs can be computed");
    }

    // Make compute idempotent. A previous failed compute (or a /rerun
    // that found the run already in draft and short-circuited the
    // payslip delete) can leave orphan payslip rows. The next compute
    // then trips the (payroll_run_id, empcloud_user_id) UNIQUE index
    // on the very first employee already present, taking the entire
    // run down with it. Wipe before we begin so /compute is always
    // safe to retry.
    await this.db.deleteMany("payslips", { payroll_run_id: runId });

    // Get org payroll settings for state info
    const orgSettings = await this.db.findOne<any>("organization_payroll_settings", {
      empcloud_org_id: Number(orgId),
    });

    // Get active employees from EmpCloud
    const ecEmployees = await findUsersByOrgId(Number(orgId), { limit: 1000 });

    let totalGross = 0;
    let totalDeductions = 0;
    let totalNet = 0;
    let totalEmployerContributions = 0;
    let employeeCount = 0;
    // #268 — Track employees skipped because their salary structure has no
    // earning components (or zero monthly amounts). Without this guard the
    // engine generated payslips with gross=0 but deductions still applied
    // (PF/ESI/TDS computed off `salary.gross_salary` rather than the empty
    // components), producing huge negative net pay. Skip the row, surface
    // the failure in the run summary so the admin can fix the structure.
    const skipped: Array<{ empcloudUserId: number; reason: string; code: string }> = [];

    for (const ecEmp of ecEmployees) {
      // Reset per-employee employer contributions each iteration
      let employeeEmployerContributions = 0;

      // Get payroll profile for this employee
      const profile = await this.db.findOne<any>("employee_payroll_profiles", {
        empcloud_user_id: ecEmp.id,
      });

      const salary = await this.db.findOne<any>("employee_salaries", {
        empcloud_user_id: ecEmp.id,
        is_active: true,
      });
      if (!salary) continue;

      // Resolve attendance for the period.
      //
      // Two data sources can carry the truth:
      //   1. payroll DB → `attendance_summaries`   (populated by Mark All
      //      Present / CSV import / manual entry on the Attendance page)
      //   2. EmpCloud DB → `attendance_records` + `leave_applications`
      //      (live punches and approved leaves from HRMS)
      //
      // Previously this code only read source #2, which is why clicking
      // Mark All Present on the payroll Attendance page made the page show
      // "22 days" but the payroll run still skipped every employee --
      // computePayroll was looking at a different table in a different DB.
      //
      // Prefer the payroll-side summary when present (it's the explicit
      // override -- HR clicked Mark All Present specifically because the
      // EmpCloud data was incomplete). Fall back to the live EmpCloud
      // counts otherwise so attendance flows through automatically for
      // orgs that don't manually import.
      const empcloudDb = getEmpCloudDB();
      const startDate = `${run.year}-${String(run.month).padStart(2, "0")}-01`;
      const endDate = new Date(run.year, run.month, 0).toISOString().slice(0, 10);
      const daysInMonth = new Date(run.year, run.month, 0).getDate();

      // Count working days (exclude weekends)
      let workingDays = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const day = new Date(run.year, run.month - 1, d).getDay();
        if (day !== 0 && day !== 6) workingDays++;
      }

      const importedSummary = await this.db.findOne<any>("attendance_summaries", {
        empcloud_user_id: ecEmp.id,
        month: run.month,
        year: run.year,
      });

      let presentDays: number;
      let paidLeaveDays: number;
      let unpaidLeaveDays: number;
      let totalDays: number;

      if (importedSummary) {
        presentDays =
          Number(importedSummary.present_days || 0) + Number(importedSummary.half_days || 0) * 0.5;
        paidLeaveDays = Number(importedSummary.paid_leave || 0);
        unpaidLeaveDays = Number(importedSummary.unpaid_leave || 0);
        // Trust the imported total_days when set; otherwise fall back to the
        // computed working-days count so half-imported rows don't blow up.
        totalDays = Number(importedSummary.total_days) || workingDays;
      } else {
        const [attRecord] = (await empcloudDb("attendance_records")
          .where("user_id", ecEmp.id)
          .where("organization_id", Number(orgId))
          .whereBetween("date", [startDate, endDate])
          .select(
            empcloudDb.raw(
              "SUM(CASE WHEN status IN ('present','checked_in') THEN 1 WHEN status = 'half_day' THEN 0.5 ELSE 0 END) as present_days",
            ),
            empcloudDb.raw("SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent_days"),
            empcloudDb.raw("SUM(CASE WHEN status = 'on_leave' THEN 1 ELSE 0 END) as leave_days"),
          )) as any[];

        const leaveResult = (await empcloudDb("leave_applications as la")
          .join("leave_types as lt", "la.leave_type_id", "lt.id")
          .where("la.user_id", ecEmp.id)
          .where("la.organization_id", Number(orgId))
          .where("la.status", "approved")
          .where("la.start_date", "<=", endDate)
          .where("la.end_date", ">=", startDate)
          .select(
            empcloudDb.raw(
              "SUM(CASE WHEN lt.is_paid = 1 THEN la.days_count ELSE 0 END) as paid_leave",
            ),
            empcloudDb.raw(
              "SUM(CASE WHEN lt.is_paid = 0 THEN la.days_count ELSE 0 END) as unpaid_leave",
            ),
          )
          .first()) as any;

        presentDays = Number(attRecord?.present_days || 0);
        paidLeaveDays = Number(leaveResult?.paid_leave || 0);
        unpaidLeaveDays = Number(leaveResult?.unpaid_leave || 0);
        totalDays = workingDays;
      }

      const paidDays = presentDays + paidLeaveDays;
      const lopDays = Math.max(0, totalDays - paidDays);

      // Parse salary components
      const components =
        typeof salary.components === "string" ? JSON.parse(salary.components) : salary.components;
      const componentList = Array.isArray(components) ? components : [];

      // Calculate earnings (pro-rated for LOP)
      const proRatio = totalDays > 0 ? paidDays / totalDays : 0;
      const earnings: any[] = [];
      let grossEarnings = 0;
      let basicMonthly = 0;

      // Separate earnings from custom deductions defined in salary structure
      const deductions: any[] = [];
      let totalDed = 0;

      for (const comp of componentList) {
        if (comp.type === "deduction") {
          // Custom deduction from salary structure (canteen, welfare fund, etc.)
          const amount = Math.round(Number(comp.monthlyAmount || 0) * proRatio);
          if (amount > 0) {
            deductions.push({ code: comp.code, name: comp.name || comp.code, amount });
            totalDed += amount;
          }
        } else {
          // Earning component
          const amount = Math.round(Number(comp.monthlyAmount || 0) * proRatio);
          earnings.push({
            code: comp.code,
            name: comp.code === "BASIC" ? "Basic Salary" : comp.name || comp.code,
            amount,
          });
          grossEarnings += amount;
          if (comp.code === "BASIC") basicMonthly = amount;
        }
      }

      // #268 — Guard against the "empty salary structure" disaster: if the
      // employee's salary has no active earning components (or all of them
      // pro-rate down to 0 because of zero working days etc.), skip this
      // row entirely. Generating a payslip here would compute PF/ESI/TDS
      // from `salary.gross_salary` while gross_earnings = 0 — that's how
      // we ended up with payslips showing Net Pay of -₹1,17,78,332.
      const hasEarningComponent = componentList.some(
        (c: any) => c.type !== "deduction" && Number(c.monthlyAmount || 0) > 0,
      );
      if (!hasEarningComponent || grossEarnings <= 0) {
        skipped.push({
          empcloudUserId: ecEmp.id,
          code: "EMPTY_SALARY_STRUCTURE",
          reason: !hasEarningComponent
            ? "Salary structure has no active earning components"
            : "Earning components pro-rated to 0 (no paid days?)",
        });
        continue;
      }

      // PF
      const pfDetails = profile?.pf_details
        ? typeof profile.pf_details === "string"
          ? JSON.parse(profile.pf_details)
          : profile.pf_details
        : {};
      if (!pfDetails?.isOptedOut) {
        // Pass org-level statutory overrides (migration 029) so PF can
        // honour pf_apply_full_basic, pf_max_employee_contribution, and
        // pf_default_employee_rate when the org has set them.
        const orgOverrides = buildOrgStatutoryOverrides(orgSettings);
        const pf = computePF({
          employeeId: String(ecEmp.id),
          month: run.month,
          year: run.year,
          basicSalary: basicMonthly,
          contributionRate: pfDetails?.contributionRate || undefined,
          isVoluntaryPF: !!pfDetails?.vpfRate,
          vpfRate: pfDetails?.vpfRate || 0,
          orgOverrides,
        });
        deductions.push({ code: "EPF", name: "Employee PF", amount: pf.employeeEPF });
        totalDed += pf.employeeEPF;
        employeeEmployerContributions += pf.totalEmployer;
      }

      // ESI — check eligibility from profile
      const esiDetails = profile?.esi_details
        ? typeof profile.esi_details === "string"
          ? JSON.parse(profile.esi_details)
          : profile.esi_details
        : {};
      if (esiDetails?.isEligible !== false) {
        const esi = computeESI({
          employeeId: String(ecEmp.id),
          month: run.month,
          year: run.year,
          grossSalary: grossEarnings,
          orgOverrides: buildOrgStatutoryOverrides(orgSettings),
        });
        if (esi) {
          deductions.push({ code: "ESI", name: "Employee ESI", amount: esi.employeeContribution });
          totalDed += esi.employeeContribution;
          employeeEmployerContributions += esi.employerContribution;
        }
      }

      // Tax info is needed for both PT (to read deductPT + state override)
      // and TDS (to read regime + deductTDS + PAN), so parse it once up
      // front instead of separately in each block.
      const taxInfo = profile?.tax_info
        ? typeof profile.tax_info === "string"
          ? JSON.parse(profile.tax_info)
          : profile.tax_info
        : {};

      // Professional Tax. Two per-employee escape hatches:
      //   - tax_info.deductPT === false: skip entirely (e.g. employee
      //     in a no-PT state like Delhi/Haryana even though the org's
      //     primary state has PT)
      //   - tax_info.state: override the org state for slab lookup so
      //     a Bangalore-HQ company with a Mumbai-resident employee
      //     applies Maharashtra slabs to that one person.
      if (taxInfo?.deductPT !== false) {
        const ptState =
          (typeof taxInfo?.state === "string" && taxInfo.state.trim()) ||
          orgSettings?.state ||
          "KA";
        const pt = computeProfessionalTax({
          employeeId: String(ecEmp.id),
          month: run.month,
          year: run.year,
          state: ptState,
          grossSalary: grossEarnings,
        });
        if (pt.taxAmount > 0) {
          deductions.push({ code: "PT", name: "Professional Tax", amount: pt.taxAmount });
          totalDed += pt.taxAmount;
        }
      }

      // TDS (income tax). tax_info.deductTDS === false skips the
      // calculation entirely -- some employees are below taxable
      // threshold or have a Lower Deduction Certificate from the IT
      // dept and HR doesn't want monthly TDS withheld.
      const fyStartMonth = 4;
      const currentMonth = run.month;
      const monthsRemaining =
        currentMonth >= fyStartMonth
          ? 12 - (currentMonth - fyStartMonth)
          : fyStartMonth - currentMonth;

      if (taxInfo?.deductTDS !== false) {
        const taxResult = computeIncomeTax({
          employeeId: String(ecEmp.id),
          financialYear:
            run.month >= 4 ? `${run.year}-${run.year + 1}` : `${run.year - 1}-${run.year}`,
          regime: taxInfo?.regime === "old" ? TaxRegime.OLD : TaxRegime.NEW,
          annualGross: Number(salary.gross_salary),
          basicAnnual: basicMonthly * 12,
          hraAnnual: (components.find((c: any) => c.code === "HRA")?.monthlyAmount || 0) * 12,
          rentPaidAnnual: 0,
          isMetroCity: false,
          declarations: [],
          employeePfAnnual: basicMonthly * 0.12 * 12,
          monthsWorked: monthsRemaining,
          taxAlreadyPaid: 0,
          // #1657 — Section 206AA: when PAN is missing, the tax engine
          // applies a flat 20% rate. Empty / null pan triggers that branch.
          panNumber: typeof taxInfo?.pan === "string" ? taxInfo.pan : null,
        });

        if (taxResult.monthlyTds > 0) {
          deductions.push({ code: "TDS", name: "Income Tax (TDS)", amount: taxResult.monthlyTds });
          totalDed += taxResult.monthlyTds;
        }
      }

      // Loan EMI auto-deduction — find active loans for this employee
      // Loans reference the local employees table; try both empcloud user id and profile id
      const loanFilters = [
        { employee_id: String(ecEmp.id), status: "active" },
        ...(profile ? [{ employee_id: profile.id, status: "active" }] : []),
      ];
      for (const lf of loanFilters) {
        const activeLoans = await this.db.findMany<any>("loans", { filters: lf });
        for (const loan of activeLoans.data) {
          const emi = Math.round(Number(loan.emi_amount));
          if (emi > 0) {
            deductions.push({
              code: "LOAN",
              name: `Loan EMI — ${loan.type || "Loan"}`,
              amount: emi,
            });
            totalDed += emi;
            // Update loan tracking
            await this.db.update("loans", loan.id, {
              installments_paid: (Number(loan.installments_paid) || 0) + 1,
              outstanding_amount: Math.max(0, Number(loan.outstanding_amount) - emi),
              ...(Number(loan.outstanding_amount) - emi <= 0 ? { status: "completed" } : {}),
            });
          }
        }
        if (activeLoans.data.length > 0) break; // Found loans, don't query again
      }

      // Apply org-level rounding policy (migration 029) to the per-employee
      // totals so the payslip and the payroll-run roll-up use consistent
      // numbers. Default ("none" or unset) is a no-op so existing orgs see
      // no change. Only the totals are rounded -- per-component line items
      // stay at their natural Math.round precision so the math still adds
      // up: rounding the totals is what HR cares about for bank transfers.
      const roundingPolicy = orgSettings?.rounding_policy ?? null;
      const roundedGross = applyRounding(grossEarnings, roundingPolicy);
      const roundedDed = applyRounding(totalDed, roundingPolicy);
      const netPay = roundedGross - roundedDed;
      const roundedEmployerCost = applyRounding(
        roundedGross + employeeEmployerContributions,
        roundingPolicy,
      );

      // Create payslip.
      // `employee_id` is a legacy UUID column (the pre-EmpCloud schema's FK
      // to a local `employees` table that was dropped). The original
      // implementation used the same dummy zero-UUID for every row, which
      // collided with the legacy `UNIQUE (payroll_run_id, employee_id)`
      // index -- the second employee in any run hit ER_DUP_ENTRY and the
      // entire compute aborted. Migration 030 swaps the unique index to
      // (payroll_run_id, empcloud_user_id) which is the correct semantic
      // key; generating a fresh UUID here keeps the insert valid both
      // before and after that migration runs.
      await this.db.create("payslips", {
        payroll_run_id: runId,
        employee_id: uuidv4(),
        empcloud_user_id: ecEmp.id,
        month: run.month,
        year: run.year,
        paid_days: paidDays,
        total_days: totalDays,
        lop_days: lopDays,
        earnings: JSON.stringify(earnings),
        deductions: JSON.stringify(deductions),
        employer_contributions: JSON.stringify([]),
        reimbursements: JSON.stringify([]),
        gross_earnings: roundedGross,
        total_deductions: roundedDed,
        net_pay: netPay,
        total_employer_cost: roundedEmployerCost,
        status: "generated",
      });

      totalGross += roundedGross;
      totalDeductions += roundedDed;
      totalNet += netPay;
      totalEmployerContributions += employeeEmployerContributions;
      employeeCount++;
    }

    // #268 — Append a structured note about any employees we had to skip
    // because of empty/invalid salary structure, so the admin sees it
    // immediately in the run summary instead of finding out via support
    // tickets. Preserve any existing notes the admin set when creating
    // the run.
    let runNotes: string | null = run.notes || null;
    if (skipped.length > 0) {
      const skipSummary = `[skipped ${skipped.length} employee(s) — empty/invalid salary structure: ${skipped
        .slice(0, 5)
        .map((s) => `#${s.empcloudUserId}`)
        .join(", ")}${skipped.length > 5 ? "..." : ""}]`;
      runNotes = runNotes ? `${runNotes}\n${skipSummary}` : skipSummary;
    }

    // Update payroll run
    await this.db.update("payroll_runs", runId, {
      status: "computed",
      total_gross: totalGross,
      total_deductions: totalDeductions,
      total_net: totalNet,
      total_employer_contributions: totalEmployerContributions,
      employee_count: employeeCount,
      ...(runNotes !== run.notes ? { notes: runNotes } : {}),
    });

    const updated = await this.getRun(runId, orgId);
    // Surface skip details to the API caller so the UI can show a banner.
    return { ...updated, skipped };
  }

  async approveRun(runId: string, orgId: string, userId: string) {
    const run = await this.getRun(runId, orgId);
    if (run.status !== "computed") {
      throw new AppError(400, "INVALID_STATUS", "Only computed payroll runs can be approved");
    }
    // #1655 — Same guard as createRun/markPaid. Without this, a future-
    // period row that existed before this fix shipped (the production
    // tenant in the report had several) could still flow computed →
    // approved, leaving the lifecycle inconsistent. Blocking here keeps
    // the whole pipeline future-period-free.
    if (isFuturePeriod(run.year, run.month)) {
      throw new AppError(
        400,
        "FUTURE_PERIOD",
        `Cannot approve a future-period run (${run.month}/${run.year} has not started yet)`,
      );
    }
    return this.db.update("payroll_runs", runId, {
      status: "approved",
      approved_by: userId,
      approved_at: new Date(),
    });
  }

  async markPaid(runId: string, orgId: string) {
    const run = await this.getRun(runId, orgId);
    if (run.status !== "approved") {
      throw new AppError(400, "INVALID_STATUS", "Only approved payroll runs can be marked as paid");
    }
    // #1655 — A run for a future period that somehow got created and
    // approved must not be marked paid. Defense in depth — the validator
    // and createRun guards block creation, but historical bad rows can
    // still exist (the production tenant in the report had Jul/Aug/Dec
    // 2026 runs marked Paid before this fix shipped).
    if (isFuturePeriod(run.year, run.month)) {
      throw new AppError(
        400,
        "FUTURE_PERIOD",
        `Cannot mark a future-period run as paid (${run.month}/${run.year} has not started yet)`,
      );
    }
    await this.db.updateMany("payslips", { payroll_run_id: runId }, { status: "paid" });
    return this.db.update("payroll_runs", runId, { status: "paid" });
  }

  async cancelRun(runId: string, orgId: string) {
    const run = await this.getRun(runId, orgId);
    if (run.status === "paid") {
      throw new AppError(400, "INVALID_STATUS", "Paid payroll runs cannot be cancelled");
    }
    await this.db.deleteMany("payslips", { payroll_run_id: runId });
    return this.db.update("payroll_runs", runId, { status: "cancelled" });
  }

  async revertToDraft(runId: string, orgId: string) {
    const run = await this.getRun(runId, orgId);
    if (run.status === "paid") {
      throw new AppError(
        400,
        "INVALID_STATUS",
        "Paid payroll runs cannot be reverted. Cancel and create a new run.",
      );
    }
    if (run.status === "draft") {
      throw new AppError(400, "ALREADY_DRAFT", "Payroll run is already in draft status");
    }
    if (run.status === "cancelled") {
      return this.db.update("payroll_runs", runId, { status: "draft" });
    }
    await this.db.deleteMany("payslips", { payroll_run_id: runId });
    return this.db.update("payroll_runs", runId, {
      status: "draft",
      total_gross: 0,
      total_deductions: 0,
      total_net: 0,
      total_employer_contributions: 0,
      employee_count: 0,
    });
  }

  /**
   * Re-run a payroll regardless of status -- the "if something went wrong"
   * escape hatch. Wipes payslips, resets totals, and flips status back to
   * draft so the user can recompute. Unlike revertToDraft, this also
   * accepts `paid` runs (with the assumption HR knows what they're doing
   * since the operation is gated by hr_admin and the UI confirm modal
   * spells out the consequences). For `draft` runs it is a no-op except
   * to reset stale totals.
   */
  async rerunRun(runId: string, orgId: string) {
    const run = await this.getRun(runId, orgId);
    if (run.status !== "draft") {
      // Wipe computed payslips so a fresh compute starts from zero. We
      // intentionally permit this for `paid` runs because the alternative
      // (cancel + create new run) loses the original period reference and
      // breaks salary continuity for any downstream report keyed off this
      // run's id.
      await this.db.deleteMany("payslips", { payroll_run_id: runId });
    }
    return this.db.update("payroll_runs", runId, {
      status: "draft",
      total_gross: 0,
      total_deductions: 0,
      total_net: 0,
      total_employer_contributions: 0,
      employee_count: 0,
    });
  }

  /**
   * Hard-delete a payroll run and all its payslips. Destructive, so the
   * route is gated by hr_admin AND the UI requires an explicit
   * type-to-confirm modal. There is no undo: payslips are wiped, the run
   * row is wiped, and any historical payslip URLs / report links for the
   * run will 404 afterwards.
   *
   * Returns the deleted run row's identifying fields so the caller can
   * confirm what was removed (used by the audit log on the API layer).
   */
  async deleteRun(runId: string, orgId: string) {
    // getRun already enforces org-scoping (404 if the run doesn't belong
    // to this org), so by the time we delete we know the row is the
    // caller's. Use deleteMany with both id and org constraint as a
    // belt-and-braces guard against any future change to the adapter
    // delete() signature, which currently doesn't accept an org filter.
    const run = await this.getRun(runId, orgId);
    const payslipCount = await this.db.deleteMany("payslips", { payroll_run_id: runId });
    await this.db.deleteMany("payroll_runs", { id: runId, empcloud_org_id: Number(orgId) });
    return {
      id: run.id,
      code: run.code,
      month: run.month,
      year: run.year,
      status: run.status,
      payslips_deleted: payslipCount,
    };
  }

  async getRunSummary(runId: string, orgId: string) {
    const run = await this.getRun(runId, orgId);
    const payslips = await this.db.findMany<any>("payslips", {
      filters: { payroll_run_id: runId },
      limit: 1000,
    });
    return {
      ...run,
      payslipCount: payslips.total,
    };
  }

  async getRunPayslips(runId: string, orgId: string) {
    // Verify the run belongs to this org before returning payslips
    await this.getRun(runId, orgId);

    // Get payslips from payroll DB
    const payslips = await this.db.findMany<any>("payslips", {
      filters: { payroll_run_id: runId },
      limit: 1000,
    });

    // Enrich with employee info from EmpCloud
    const ecDb = getEmpCloudDB();
    const data = [];
    for (const p of payslips.data) {
      const empcloudUserId = p.empcloud_user_id;
      let empInfo: any = {};
      if (empcloudUserId) {
        empInfo =
          (await ecDb("users")
            .where({ id: empcloudUserId })
            .select("first_name", "last_name", "emp_code", "designation", "department_id")
            .first()) || {};
      }

      let deptName: string | null = null;
      if (empInfo.department_id) {
        const dept = await ecDb("organization_departments")
          .where({ id: empInfo.department_id })
          .first();
        deptName = dept?.name || null;
      }

      data.push({
        ...p,
        first_name: empInfo.first_name || null,
        last_name: empInfo.last_name || null,
        employee_code: empInfo.emp_code || null,
        designation: empInfo.designation || null,
        department: deptName,
        earnings: typeof p.earnings === "string" ? JSON.parse(p.earnings) : p.earnings,
        deductions: typeof p.deductions === "string" ? JSON.parse(p.deductions) : p.deductions,
        employer_contributions:
          typeof p.employer_contributions === "string"
            ? JSON.parse(p.employer_contributions)
            : p.employer_contributions,
        reimbursements:
          typeof p.reimbursements === "string" ? JSON.parse(p.reimbursements) : p.reimbursements,
      });
    }

    return { data, total: data.length, page: 1, limit: 1000, totalPages: 1 };
  }
}
