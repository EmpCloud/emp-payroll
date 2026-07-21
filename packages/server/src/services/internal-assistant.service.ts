import { getEmpCloudDB } from "../db/empcloud";
import { SalaryService } from "./salary.service";
import { PayslipService } from "./payslip.service";
import { PayrollService } from "./payroll.service";
import { AppError } from "../api/middleware/error.middleware";

export class InternalAssistantService {
  private salary = new SalaryService();
  private payslips = new PayslipService();
  private payroll = new PayrollService();

  private async assertEmployee(orgId: number, employeeId: number) {
    const user = await getEmpCloudDB()("users")
      .where({ id: employeeId, organization_id: orgId, status: 1 })
      .first("id", "first_name", "last_name", "emp_code");
    if (!user) throw new AppError(404, "NOT_FOUND", "Employee not found");
    return user;
  }

  async getSalary(orgId: number, employeeId: number) {
    const employee = await this.assertEmployee(orgId, employeeId);
    const salary = await this.salary.getEmployeeSalary(String(employeeId));
    return {
      employee: {
        employee_id: employeeId,
        name: `${employee.first_name} ${employee.last_name}`.trim(),
        emp_code: employee.emp_code,
      },
      salary: {
        id: salary.id,
        structure_id: salary.structure_id,
        annual_ctc: salary.ctc,
        monthly_ctc: Number(salary.ctc || 0) / 12,
        gross_salary: salary.gross_salary,
        net_salary: salary.net_salary,
        effective_from: salary.effective_from,
        effective_to: salary.effective_to,
        components:
          typeof salary.components === "string" ? JSON.parse(salary.components) : salary.components,
        currency: salary.currency || "INR",
      },
    };
  }

  async getNetPay(orgId: number, employeeId: number, month: number, year: number) {
    const employee = await this.assertEmployee(orgId, employeeId);
    const result = await this.payslips.list(String(orgId), { month, year, page: 1, limit: 1000 });
    const payslip = result.data.find((row: any) => Number(row.empcloud_user_id) === employeeId);
    if (!payslip)
      throw new AppError(404, "NOT_FOUND", "Payslip not found for this employee and month");
    const deductions = Array.isArray(payslip.deductions)
      ? payslip.deductions.map((item: any) => ({
          code: item?.code || null,
          name: item?.name || item?.label || item?.code || "Deduction",
          amount: Number(item?.amount || 0),
        }))
      : [];
    const earnings = Array.isArray(payslip.earnings)
      ? payslip.earnings.map((item: any) => ({
          code: item?.code || null,
          name: item?.name || item?.label || item?.code || "Earning",
          amount: Number(item?.amount || 0),
        }))
      : [];
    return {
      employee: {
        employee_id: employeeId,
        name: `${employee.first_name} ${employee.last_name}`.trim(),
        emp_code: employee.emp_code,
      },
      month,
      year,
      currency: payslip.currency || "INR",
      status: payslip.status,
      gross_pay: payslip.gross_earnings,
      total_deductions: payslip.total_deductions,
      net_pay: payslip.net_pay,
      paid_at: payslip.paid_at || null,
      earnings,
      deductions,
      deduction_breakdown_available: deductions.length > 0,
      deduction_breakdown: deductions,
    };
  }

  async getRunTotals(orgId: number, filters: { runId?: string; month?: number; year?: number }) {
    const result = await this.payroll.listRuns(String(orgId));
    const run = result.data.find((row: any) =>
      filters.runId
        ? row.id === filters.runId
        : Number(row.month) === filters.month && Number(row.year) === filters.year,
    );
    if (!run) throw new AppError(404, "NOT_FOUND", "Payroll run not found");
    return {
      run_id: run.id,
      month: run.month,
      year: run.year,
      status: run.status,
      currency: run.currency || "INR",
      employee_count: run.employee_count,
      total_gross: run.total_gross,
      total_deductions: run.total_deductions,
      total_net: run.total_net,
      total_employer_cost: run.total_employer_cost ?? run.total_employer_contributions,
    };
  }
}
