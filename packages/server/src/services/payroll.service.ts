import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";
import { computePF, computeESI, computeProfessionalTax } from "./compliance/india-statutory.service";
import { computeIncomeTax } from "./tax/india-tax.service";
import { TaxRegime } from "@emp-payroll/shared";
import dayjs from "dayjs";

export class PayrollService {
  private db = getDB();

  async listRuns(orgId: string) {
    return this.db.findMany<any>("payroll_runs", {
      filters: { org_id: orgId },
      sort: { field: "created_at", order: "desc" },
    });
  }

  async getRun(id: string, orgId: string) {
    const run = await this.db.findOne<any>("payroll_runs", { id, org_id: orgId });
    if (!run) throw new AppError(404, "NOT_FOUND", "Payroll run not found");
    return run;
  }

  async createRun(orgId: string, userId: string, data: { month: number; year: number; payDate: string; notes?: string }) {
    const existing = await this.db.findOne<any>("payroll_runs", {
      org_id: orgId,
      month: data.month,
      year: data.year,
    });
    if (existing) throw new AppError(409, "DUPLICATE_RUN", `Payroll for ${data.month}/${data.year} already exists`);

    const monthNames = ["", "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"];

    return this.db.create("payroll_runs", {
      org_id: orgId,
      name: `${monthNames[data.month]} ${data.year} Payroll`,
      month: data.month,
      year: data.year,
      pay_date: data.payDate,
      status: "draft",
      processed_by: userId,
      notes: data.notes || null,
    });
  }

  async computePayroll(runId: string, orgId: string) {
    const run = await this.getRun(runId, orgId);
    if (run.status !== "draft") {
      throw new AppError(400, "INVALID_STATUS", "Only draft payroll runs can be computed");
    }

    // Get org for state info
    const org = await this.db.findById<any>("organizations", orgId);

    // Get all active employees with salaries
    const employees = await this.db.findMany<any>("employees", {
      filters: { org_id: orgId, is_active: true },
      limit: 1000,
    });

    let totalGross = 0;
    let totalDeductions = 0;
    let totalNet = 0;
    let totalEmployerContributions = 0;
    let employeeCount = 0;

    for (const emp of employees.data) {
      const salary = await this.db.findOne<any>("employee_salaries", {
        employee_id: emp.id,
        is_active: true,
      });
      if (!salary) continue;

      // Get attendance
      const attendance = await this.db.findOne<any>("attendance_summaries", {
        employee_id: emp.id,
        month: run.month,
        year: run.year,
      });

      const totalDays = attendance?.total_days || 30;
      const paidDays = attendance ? (totalDays - (attendance.lop_days || 0)) : totalDays;
      const lopDays = attendance?.lop_days || 0;

      // Parse salary components
      const components = typeof salary.components === "string"
        ? JSON.parse(salary.components)
        : salary.components;

      // Calculate earnings (pro-rated for LOP)
      const proRatio = paidDays / totalDays;
      const earnings: any[] = [];
      let grossEarnings = 0;
      let basicMonthly = 0;

      for (const comp of components) {
        const amount = Math.round(comp.monthlyAmount * proRatio);
        earnings.push({
          code: comp.code,
          name: comp.code === "BASIC" ? "Basic Salary" : comp.code,
          amount,
        });
        grossEarnings += amount;
        if (comp.code === "BASIC") basicMonthly = amount;
      }

      // Statutory deductions
      const deductions: any[] = [];
      let totalDed = 0;

      // PF
      const pfDetails = typeof emp.pf_details === "string" ? JSON.parse(emp.pf_details) : emp.pf_details;
      if (!pfDetails?.isOptedOut) {
        const pf = computePF({
          employeeId: emp.id,
          month: run.month,
          year: run.year,
          basicSalary: basicMonthly,
        });
        deductions.push({ code: "EPF", name: "Employee PF", amount: pf.employeeEPF });
        totalDed += pf.employeeEPF;
        totalEmployerContributions += pf.totalEmployer;
      }

      // ESI
      const esi = computeESI({
        employeeId: emp.id,
        month: run.month,
        year: run.year,
        grossSalary: grossEarnings,
      });
      if (esi) {
        deductions.push({ code: "ESI", name: "Employee ESI", amount: esi.employeeContribution });
        totalDed += esi.employeeContribution;
        totalEmployerContributions += esi.employerContribution;
      }

      // Professional Tax
      const pt = computeProfessionalTax({
        employeeId: emp.id,
        month: run.month,
        year: run.year,
        state: org?.state || "KA",
        grossSalary: grossEarnings,
      });
      if (pt.taxAmount > 0) {
        deductions.push({ code: "PT", name: "Professional Tax", amount: pt.taxAmount });
        totalDed += pt.taxAmount;
      }

      // TDS (income tax)
      const taxInfo = typeof emp.tax_info === "string" ? JSON.parse(emp.tax_info) : emp.tax_info;
      const fyStartMonth = 4;
      const currentMonth = run.month;
      const monthsRemaining = currentMonth >= fyStartMonth
        ? 12 - (currentMonth - fyStartMonth)
        : fyStartMonth - currentMonth;

      const taxResult = computeIncomeTax({
        employeeId: emp.id,
        financialYear: run.month >= 4 ? `${run.year}-${run.year + 1}` : `${run.year - 1}-${run.year}`,
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

      const netPay = grossEarnings - totalDed;

      // Create payslip
      await this.db.create("payslips", {
        payroll_run_id: runId,
        employee_id: emp.id,
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
        total_employer_cost: grossEarnings + totalEmployerContributions,
        status: "generated",
      });

      totalGross += grossEarnings;
      totalDeductions += totalDed;
      totalNet += netPay;
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

  async getRunPayslips(runId: string) {
    return this.db.findMany<any>("payslips", {
      filters: { payroll_run_id: runId },
      limit: 1000,
    });
  }
}
