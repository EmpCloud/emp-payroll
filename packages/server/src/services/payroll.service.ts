import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";
import {
  computePF,
  computeESI,
  computeProfessionalTax,
} from "./compliance/india-statutory.service";
import { computeIncomeTax } from "./tax/india-tax.service";
import { TaxRegime } from "@emp-payroll/shared";
import { findUsersByOrgId, findOrgById, getEmpCloudDB } from "../db/empcloud";
import { config } from "../config";
import * as cloudHRMS from "./cloud-hrms.service";
import dayjs from "dayjs";

export class PayrollService {
  private db = getDB();

  async listRuns(orgId: string) {
    return this.db.findMany<any>("payroll_runs", {
      filters: { empcloud_org_id: Number(orgId) },
      sort: { field: "created_at", order: "desc" },
    });
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

      // Get attendance from EmpCloud DB directly
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

      const [attRecord] = await empcloudDb("attendance_records")
        .where("user_id", ecEmp.id)
        .where("organization_id", Number(orgId))
        .whereBetween("date", [startDate, endDate])
        .select(
          empcloudDb.raw(
            "SUM(CASE WHEN status IN ('present','checked_in') THEN 1 WHEN status = 'half_day' THEN 0.5 ELSE 0 END) as present_days",
          ),
          empcloudDb.raw("SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent_days"),
          empcloudDb.raw("SUM(CASE WHEN status = 'on_leave' THEN 1 ELSE 0 END) as leave_days"),
        );

      // Get approved paid leave days from EmpCloud
      const leaveResult = await empcloudDb("leave_applications as la")
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
        .first();

      const presentDays = Number(attRecord?.present_days || 0);
      const paidLeaveDays = Number(leaveResult?.paid_leave || 0);
      const unpaidLeaveDays = Number(leaveResult?.unpaid_leave || 0);

      const totalDays = workingDays;
      const paidDays = presentDays + paidLeaveDays;
      const lopDays = Math.max(0, totalDays - paidDays);

      // Parse salary components
      const components =
        typeof salary.components === "string" ? JSON.parse(salary.components) : salary.components;

      // Calculate earnings (pro-rated for LOP)
      const proRatio = paidDays / totalDays;
      const earnings: any[] = [];
      let grossEarnings = 0;
      let basicMonthly = 0;

      // Separate earnings from custom deductions defined in salary structure
      const deductions: any[] = [];
      let totalDed = 0;

      for (const comp of components) {
        if (comp.type === "deduction") {
          // Custom deduction from salary structure (canteen, welfare fund, etc.)
          const amount = Math.round(comp.monthlyAmount * proRatio);
          if (amount > 0) {
            deductions.push({ code: comp.code, name: comp.name || comp.code, amount });
            totalDed += amount;
          }
        } else {
          // Earning component
          const amount = Math.round(comp.monthlyAmount * proRatio);
          earnings.push({
            code: comp.code,
            name: comp.code === "BASIC" ? "Basic Salary" : comp.name || comp.code,
            amount,
          });
          grossEarnings += amount;
          if (comp.code === "BASIC") basicMonthly = amount;
        }
      }

      // PF
      const pfDetails = profile?.pf_details
        ? typeof profile.pf_details === "string"
          ? JSON.parse(profile.pf_details)
          : profile.pf_details
        : {};
      if (!pfDetails?.isOptedOut) {
        const pf = computePF({
          employeeId: String(ecEmp.id),
          month: run.month,
          year: run.year,
          basicSalary: basicMonthly,
          contributionRate: pfDetails?.contributionRate || undefined,
          isVoluntaryPF: !!pfDetails?.vpfRate,
          vpfRate: pfDetails?.vpfRate || 0,
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
        });
        if (esi) {
          deductions.push({ code: "ESI", name: "Employee ESI", amount: esi.employeeContribution });
          totalDed += esi.employeeContribution;
          employeeEmployerContributions += esi.employerContribution;
        }
      }

      // Professional Tax
      const pt = computeProfessionalTax({
        employeeId: String(ecEmp.id),
        month: run.month,
        year: run.year,
        state: orgSettings?.state || "KA",
        grossSalary: grossEarnings,
      });
      if (pt.taxAmount > 0) {
        deductions.push({ code: "PT", name: "Professional Tax", amount: pt.taxAmount });
        totalDed += pt.taxAmount;
      }

      // TDS (income tax)
      const taxInfo = profile?.tax_info
        ? typeof profile.tax_info === "string"
          ? JSON.parse(profile.tax_info)
          : profile.tax_info
        : {};
      const fyStartMonth = 4;
      const currentMonth = run.month;
      const monthsRemaining =
        currentMonth >= fyStartMonth
          ? 12 - (currentMonth - fyStartMonth)
          : fyStartMonth - currentMonth;

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
      });

      if (taxResult.monthlyTds > 0) {
        deductions.push({ code: "TDS", name: "Income Tax (TDS)", amount: taxResult.monthlyTds });
        totalDed += taxResult.monthlyTds;
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

      const netPay = grossEarnings - totalDed;

      // Create payslip
      await this.db.create("payslips", {
        payroll_run_id: runId,
        employee_id: "00000000-0000-0000-0000-000000000000",
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
        gross_earnings: grossEarnings,
        total_deductions: totalDed,
        net_pay: netPay,
        total_employer_cost: grossEarnings + employeeEmployerContributions,
        status: "generated",
      });

      totalGross += grossEarnings;
      totalDeductions += totalDed;
      totalNet += netPay;
      totalEmployerContributions += employeeEmployerContributions;
      employeeCount++;
    }

    // Update payroll run
    await this.db.update("payroll_runs", runId, {
      status: "computed",
      total_gross: totalGross,
      total_deductions: totalDeductions,
      total_net: totalNet,
      total_employer_contributions: totalEmployerContributions,
      employee_count: employeeCount,
    });

    return this.getRun(runId, orgId);
  }

  async approveRun(runId: string, orgId: string, userId: string) {
    const run = await this.getRun(runId, orgId);
    if (run.status !== "computed") {
      throw new AppError(400, "INVALID_STATUS", "Only computed payroll runs can be approved");
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
