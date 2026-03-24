import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";
import { findUsersByOrgId, getEmpCloudDB } from "../db/empcloud";

export class TotalRewardsService {
  private db = getDB();

  /**
   * Generate a total rewards statement for an employee.
   * Aggregates salary, benefits, bonuses, deductions into one view.
   */
  async generateStatement(orgId: string, employeeId: string, financialYear?: string) {
    const numOrgId = Number(orgId);
    const numEmpId = Number(employeeId);

    // Determine financial year
    const now = new Date();
    const currentFY =
      now.getMonth() >= 3
        ? `${now.getFullYear()}-${now.getFullYear() + 1}`
        : `${now.getFullYear() - 1}-${now.getFullYear()}`;
    const fy = financialYear || currentFY;
    const [fyStart, fyEnd] = fy.split("-").map(Number);

    // Get employee info from EmpCloud
    const ecDb = getEmpCloudDB();
    const employee = await ecDb("users")
      .where({ id: numEmpId })
      .select("id", "first_name", "last_name", "email", "emp_code", "designation", "department_id")
      .first();
    if (!employee) throw new AppError(404, "NOT_FOUND", "Employee not found");

    // 1. Current salary
    const salary = await this.db.findOne<any>("employee_salaries", {
      empcloud_user_id: numEmpId,
      is_active: true,
    });

    const ctc = salary ? Number(salary.ctc) : 0;
    const grossSalary = salary ? Number(salary.gross_salary) : 0;
    const components = salary
      ? typeof salary.components === "string"
        ? JSON.parse(salary.components)
        : salary.components || []
      : [];

    // 2. YTD earnings from payslips
    const fyMonths = this.getFYMonths(fyStart);
    let ytdGrossEarnings = 0;
    let ytdNetPay = 0;
    let ytdTotalDeductions = 0;
    let ytdTax = 0;
    const monthlyPayslips: any[] = [];

    for (const { month, year } of fyMonths) {
      const payslip = await this.db.findOne<any>("payslips", {
        empcloud_user_id: numEmpId,
        month,
        year,
      });
      if (payslip) {
        ytdGrossEarnings += Number(payslip.gross_earnings);
        ytdNetPay += Number(payslip.net_pay);
        ytdTotalDeductions += Number(payslip.total_deductions);

        const deductions =
          typeof payslip.deductions === "string"
            ? JSON.parse(payslip.deductions)
            : payslip.deductions || [];
        const tds = deductions.find((d: any) => d.code === "TDS" || d.code === "INCOME_TAX");
        if (tds) ytdTax += Number(tds.amount);

        monthlyPayslips.push({
          month,
          year,
          grossEarnings: Number(payslip.gross_earnings),
          netPay: Number(payslip.net_pay),
          deductions: Number(payslip.total_deductions),
        });
      }
    }

    // 3. Benefits enrollment
    const benefitsResult = await this.db.findMany<any>("employee_benefits", {
      filters: { empcloud_user_id: numEmpId, empcloud_org_id: numOrgId },
      limit: 100,
    });
    const benefits: any[] = [];
    let totalBenefitEmployerValue = 0;
    let totalBenefitEmployeeValue = 0;

    for (const enrollment of benefitsResult.data) {
      if (enrollment.status === "cancelled") continue;
      const plan = await this.db.findById<any>("benefit_plans", enrollment.plan_id);
      const annualEmployerShare = Number(enrollment.premium_employer_share) * 12;
      const annualEmployeeShare = Number(enrollment.premium_employee_share) * 12;
      totalBenefitEmployerValue += annualEmployerShare;
      totalBenefitEmployeeValue += annualEmployeeShare;
      benefits.push({
        planName: plan?.name || "Unknown Plan",
        type: plan?.type || "other",
        coverageType: enrollment.coverage_type,
        status: enrollment.status,
        monthlyEmployerShare: Number(enrollment.premium_employer_share),
        monthlyEmployeeShare: Number(enrollment.premium_employee_share),
        annualEmployerShare,
        annualEmployeeShare,
      });
    }

    // 4. Loans
    const loansResult = await this.db.findMany<any>("loans", {
      filters: { empcloud_user_id: numEmpId },
      limit: 100,
    });
    const loans = (loansResult?.data || []).map((l: any) => ({
      type: l.type,
      principalAmount: Number(l.principal_amount),
      outstandingAmount: Number(l.outstanding_amount),
      emiAmount: Number(l.emi_amount),
      status: l.status,
    }));

    // 5. Reimbursements for the FY
    const reimbursementsResult = await this.db.findMany<any>("reimbursements", {
      filters: { empcloud_user_id: numEmpId, status: "approved" },
      limit: 500,
    });
    const totalReimbursements = (reimbursementsResult?.data || []).reduce(
      (sum: number, r: any) => sum + Number(r.amount || 0),
      0,
    );

    // Build total compensation
    const totalDirectCompensation = ctc;
    const totalBenefitsValue = totalBenefitEmployerValue;
    const totalRewards = totalDirectCompensation + totalBenefitsValue + totalReimbursements;

    return {
      employee: {
        id: employee.id,
        name: `${employee.first_name} ${employee.last_name}`,
        email: employee.email,
        empCode: employee.emp_code,
        designation: employee.designation,
      },
      financialYear: fy,
      generatedAt: new Date().toISOString(),

      compensation: {
        annualCTC: ctc,
        monthlyGross: grossSalary,
        components: components.map((c: any) => ({
          code: c.code,
          name: c.code === "BASIC" ? "Basic Salary" : c.code,
          monthlyAmount: c.monthlyAmount,
          annualAmount: c.monthlyAmount * 12,
        })),
      },

      ytdEarnings: {
        grossEarnings: ytdGrossEarnings,
        netPay: ytdNetPay,
        totalDeductions: ytdTotalDeductions,
        taxPaid: ytdTax,
        monthsProcessed: monthlyPayslips.length,
        monthly: monthlyPayslips,
      },

      benefits: {
        plans: benefits,
        totalAnnualEmployerContribution: totalBenefitEmployerValue,
        totalAnnualEmployeeContribution: totalBenefitEmployeeValue,
      },

      loans: {
        active: loans.filter((l: any) => l.status === "active"),
        totalOutstanding: loans.reduce((s: number, l: any) => s + l.outstandingAmount, 0),
      },

      reimbursements: {
        totalApproved: totalReimbursements,
      },

      totalRewards: {
        directCompensation: totalDirectCompensation,
        benefitsValue: totalBenefitsValue,
        reimbursements: totalReimbursements,
        grandTotal: totalRewards,
      },
    };
  }

  /**
   * Generate an HTML total rewards statement (for PDF rendering).
   */
  async generateStatementHTML(
    orgId: string,
    employeeId: string,
    financialYear?: string,
  ): Promise<string> {
    const statement = await this.generateStatement(orgId, employeeId, financialYear);
    const fmt = (n: number) =>
      new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(n);

    const compRows = statement.compensation.components
      .map(
        (c: any) =>
          `<tr><td>${c.name}</td><td class="amt">${fmt(c.monthlyAmount)}</td><td class="amt">${fmt(c.annualAmount)}</td></tr>`,
      )
      .join("");

    const benefitRows =
      statement.benefits.plans
        .map(
          (b: any) =>
            `<tr><td>${b.planName}</td><td>${b.type}</td><td>${b.coverageType}</td><td class="amt">${fmt(b.annualEmployerShare)}</td></tr>`,
        )
        .join("") || '<tr><td colspan="4" class="center">No benefits enrolled</td></tr>';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Total Rewards Statement — ${statement.employee.name}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #1a1a1a; padding: 40px; max-width: 900px; margin: 0 auto; }
  .header { border-bottom: 3px solid #4f46e5; padding-bottom: 20px; margin-bottom: 24px; display: flex; justify-content: space-between; }
  .title { font-size: 22px; font-weight: 700; color: #4f46e5; }
  .subtitle { font-size: 13px; color: #666; margin-top: 4px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .info-box { background: #f8f9fa; border-radius: 8px; padding: 16px; }
  .info-box h4 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 8px; }
  .info-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .info-row .label { color: #666; }
  .info-row .value { font-weight: 500; }
  .section { margin-bottom: 24px; }
  .section h3 { font-size: 14px; font-weight: 600; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 2px solid #e5e7eb; color: #374151; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th { background: #f3f4f6; padding: 8px 12px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #666; }
  td { padding: 8px 12px; border-bottom: 1px solid #f3f4f6; }
  td.amt, th.amt { text-align: right; font-variant-numeric: tabular-nums; }
  td.center { text-align: center; color: #999; }
  .total-row td { border-top: 2px solid #e5e7eb; font-weight: 700; background: #fafafa; }
  .grand-total { text-align: center; background: #4f46e5; color: white; border-radius: 8px; padding: 24px; margin: 24px 0; }
  .grand-total .label { font-size: 12px; opacity: 0.8; text-transform: uppercase; letter-spacing: 1px; }
  .grand-total .amount { font-size: 32px; font-weight: 700; margin-top: 4px; }
  .chart { display: flex; gap: 8px; align-items: end; height: 60px; margin: 16px 0; }
  .chart-bar { flex: 1; border-radius: 4px 4px 0 0; min-height: 4px; }
  .footer { border-top: 1px solid #e5e7eb; padding-top: 16px; font-size: 11px; color: #999; text-align: center; }
  .print-btn { display: block; margin: 0 auto 24px; padding: 10px 32px; background: #4f46e5; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; }
  .print-btn:hover { background: #4338ca; }
  @media print { .no-print { display: none; } body { padding: 20px; } }
</style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">Print / Save as PDF</button>

  <div class="header">
    <div>
      <div class="title">Total Rewards Statement</div>
      <div class="subtitle">Financial Year: ${statement.financialYear}</div>
    </div>
    <div style="text-align: right;">
      <div style="font-weight: 600;">${statement.employee.name}</div>
      <div class="subtitle">${statement.employee.designation || ""} | ${statement.employee.empCode || ""}</div>
    </div>
  </div>

  <div class="grand-total">
    <div class="label">Total Rewards Value</div>
    <div class="amount">${fmt(statement.totalRewards.grandTotal)}</div>
  </div>

  <div class="info-grid">
    <div class="info-box">
      <h4>Compensation Summary</h4>
      <div class="info-row"><span class="label">Annual CTC</span><span class="value">${fmt(statement.totalRewards.directCompensation)}</span></div>
      <div class="info-row"><span class="label">Benefits Value</span><span class="value">${fmt(statement.totalRewards.benefitsValue)}</span></div>
      <div class="info-row"><span class="label">Reimbursements</span><span class="value">${fmt(statement.totalRewards.reimbursements)}</span></div>
    </div>
    <div class="info-box">
      <h4>YTD Earnings (${statement.ytdEarnings.monthsProcessed} months)</h4>
      <div class="info-row"><span class="label">Gross Earnings</span><span class="value">${fmt(statement.ytdEarnings.grossEarnings)}</span></div>
      <div class="info-row"><span class="label">Total Deductions</span><span class="value">${fmt(statement.ytdEarnings.totalDeductions)}</span></div>
      <div class="info-row"><span class="label">Net Pay</span><span class="value">${fmt(statement.ytdEarnings.netPay)}</span></div>
      <div class="info-row"><span class="label">Tax Paid</span><span class="value">${fmt(statement.ytdEarnings.taxPaid)}</span></div>
    </div>
  </div>

  <div class="section">
    <h3>Salary Components</h3>
    <table>
      <tr><th>Component</th><th class="amt">Monthly</th><th class="amt">Annual</th></tr>
      ${compRows}
      <tr class="total-row"><td>Total CTC</td><td class="amt">${fmt(statement.compensation.monthlyGross)}</td><td class="amt">${fmt(statement.compensation.annualCTC)}</td></tr>
    </table>
  </div>

  <div class="section">
    <h3>Benefits</h3>
    <table>
      <tr><th>Plan</th><th>Type</th><th>Coverage</th><th class="amt">Annual Employer Share</th></tr>
      ${benefitRows}
    </table>
  </div>

  <div class="footer">
    This is a confidential document. | Generated on ${new Date().toLocaleDateString("en-IN")}
  </div>
</body>
</html>`;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private getFYMonths(fyStartYear: number): { month: number; year: number }[] {
    const months: { month: number; year: number }[] = [];
    // April to March
    for (let m = 4; m <= 12; m++) {
      months.push({ month: m, year: fyStartYear });
    }
    for (let m = 1; m <= 3; m++) {
      months.push({ month: m, year: fyStartYear + 1 });
    }
    return months;
  }
}
