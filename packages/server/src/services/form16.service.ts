import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";

export class Form16Service {
  private db = getDB();

  async generateHTML(employeeId: string, financialYear?: string): Promise<string> {
    // Resolve employee — support lookup by (a) internal employee PK (legacy/tests),
    // (b) empcloud_user_id numeric (self-service routes pass this).
    let employee = await this.db.findById<any>("employees", employeeId);
    if (!employee) {
      // Try lookup by empcloud_user_id (self-service path) — payroll profile holds it
      const numericId = Number(employeeId);
      if (Number.isFinite(numericId)) {
        const profile = await this.db.findOne<any>("employee_payroll_profiles", {
          empcloud_user_id: numericId,
        });
        if (profile) {
          employee = {
            id: profile.id,
            first_name: profile.first_name || "",
            last_name: profile.last_name || "",
            employee_code: profile.employee_code || "",
            org_id: profile.empcloud_org_id,
            tax_info: profile.tax_info,
            pf_details: profile.pf_details,
            empcloud_user_id: profile.empcloud_user_id,
          };
        }
      }
    }
    if (!employee) throw new AppError(404, "NOT_FOUND", "Employee not found");

    const org = await this.db.findById<any>("organizations", employee.org_id);
    const taxInfo = this.parseObject(employee.tax_info);
    const pfDetails = this.parseObject(employee.pf_details);

    const fy = financialYear || this.currentFY();
    const [fyStart, fyEnd] = fy.split("-").map(Number);

    // Get all payslips for this FY — filter by employee_id (legacy) OR empcloud_user_id
    let allPayslips = await this.db.findMany<any>("payslips", {
      filters: { employee_id: employeeId },
      limit: 100,
    });
    if ((!allPayslips.data || allPayslips.data.length === 0) && employee.empcloud_user_id) {
      allPayslips = await this.db.findMany<any>("payslips", {
        filters: { empcloud_user_id: Number(employee.empcloud_user_id) },
        limit: 100,
      });
    }

    const fyPayslips = allPayslips.data.filter((ps: any) => {
      if (ps.year === fyStart && ps.month >= 4) return true;
      if (ps.year === fyEnd && ps.month <= 3) return true;
      return false;
    });

    // Aggregate
    let totalGross = 0,
      totalTDS = 0,
      totalPF = 0,
      totalPT = 0;
    const monthlyBreakdown: any[] = [];

    for (const ps of fyPayslips) {
      const deductions = this.parseArray(ps.deductions);
      const tds = deductions.find((d: any) => d.code === "TDS")?.amount || 0;
      const pf = deductions.find((d: any) => d.code === "EPF")?.amount || 0;
      const pt = deductions.find((d: any) => d.code === "PT")?.amount || 0;

      totalGross += Number(ps.gross_earnings);
      totalTDS += tds;
      totalPF += pf;
      totalPT += pt;

      const monthNames = [
        "",
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];
      monthlyBreakdown.push({
        month: `${monthNames[ps.month]} ${ps.year}`,
        gross: Number(ps.gross_earnings),
        tds,
      });
    }

    // Get tax computation
    const taxComp = await this.db.findOne<any>("tax_computations", {
      employee_id: employeeId,
      financial_year: fy,
    });

    const fmt = (n: number) =>
      new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(n);

    const monthlyRows = monthlyBreakdown
      .map(
        (m) =>
          `<tr><td>${m.month}</td><td class="r">${fmt(m.gross)}</td><td class="r">${fmt(m.tds)}</td></tr>`,
      )
      .join("");

    const salary = await this.db.findOne<any>("employee_salaries", {
      employee_id: employeeId,
      is_active: true,
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Form 16 — ${employee.first_name} ${employee.last_name} — FY ${fy}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Times New Roman', serif; font-size: 12px; color: #000; padding: 40px; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 16px; text-align: center; margin-bottom: 4px; }
  h2 { font-size: 14px; text-align: center; margin-bottom: 16px; color: #444; }
  .header { text-align: center; border: 2px solid #000; padding: 16px; margin-bottom: 20px; }
  .section { margin-bottom: 20px; }
  .section-title { font-size: 13px; font-weight: bold; background: #f0f0f0; padding: 6px 10px; border: 1px solid #ccc; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  td, th { border: 1px solid #ccc; padding: 6px 10px; text-align: left; font-size: 11px; }
  th { background: #f8f8f8; font-weight: bold; }
  .r { text-align: right; }
  .total-row td { font-weight: bold; background: #f8f8f8; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
  .info-grid td { border-bottom: none; }
  .info-grid td:first-child { font-weight: bold; width: 200px; }
  .footer { margin-top: 40px; font-size: 11px; color: #666; text-align: center; }
  .sign-area { display: flex; justify-content: space-between; margin-top: 60px; }
  .sign-box { text-align: center; }
  .sign-line { border-top: 1px solid #000; width: 200px; margin-top: 40px; padding-top: 4px; }
  .print-btn { display: block; margin: 0 auto 24px; padding: 10px 32px; background: #4f46e5; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; font-family: sans-serif; }
  @media print { .no-print { display: none; } body { padding: 20px; } }
</style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">Print / Save as PDF</button>

  <div class="header">
    <h1>FORM No. 16</h1>
    <h2>Certificate under Section 203 of the Income-tax Act, 1961<br>for Tax Deducted at Source on Salary</h2>
  </div>

  <div class="section">
    <div class="section-title">PART A — Certificate of Tax Deduction</div>
    <table>
      <tbody class="info-grid">
        <tr><td>Name of the Deductor (Employer)</td><td>${org?.legal_name || org?.name || ""}</td></tr>
        <tr><td>TAN of the Deductor</td><td>${org?.tan || ""}</td></tr>
        <tr><td>PAN of the Deductor</td><td>${org?.pan || ""}</td></tr>
        <tr><td>Name of the Employee</td><td>${employee.first_name} ${employee.last_name}</td></tr>
        <tr><td>PAN of the Employee</td><td>${taxInfo.pan || ""}</td></tr>
        <tr><td>Employee Code</td><td>${employee.employee_code}</td></tr>
        <tr><td>Assessment Year</td><td>${fyEnd}-${fyEnd + 1}</td></tr>
        <tr><td>Period of Employment</td><td>01-Apr-${fyStart} to 31-Mar-${fyEnd}</td></tr>
      </tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Summary of Tax Deducted at Source</div>
    <table>
      <thead>
        <tr><th>Quarter</th><th>Amount of TDS (₹)</th></tr>
      </thead>
      <tbody>
        <tr><td>Q1 (Apr-Jun ${fyStart})</td><td class="r">${fmt(fyPayslips.filter((p: any) => p.month >= 4 && p.month <= 6 && p.year === fyStart).reduce((s: number, p: any) => s + (this.parseArray(p.deductions).find((d: any) => d.code === "TDS")?.amount || 0), 0))}</td></tr>
        <tr><td>Q2 (Jul-Sep ${fyStart})</td><td class="r">${fmt(fyPayslips.filter((p: any) => p.month >= 7 && p.month <= 9 && p.year === fyStart).reduce((s: number, p: any) => s + (this.parseArray(p.deductions).find((d: any) => d.code === "TDS")?.amount || 0), 0))}</td></tr>
        <tr><td>Q3 (Oct-Dec ${fyStart})</td><td class="r">${fmt(fyPayslips.filter((p: any) => p.month >= 10 && p.month <= 12 && p.year === fyStart).reduce((s: number, p: any) => s + (this.parseArray(p.deductions).find((d: any) => d.code === "TDS")?.amount || 0), 0))}</td></tr>
        <tr><td>Q4 (Jan-Mar ${fyEnd})</td><td class="r">${fmt(fyPayslips.filter((p: any) => p.month >= 1 && p.month <= 3 && p.year === fyEnd).reduce((s: number, p: any) => s + (this.parseArray(p.deductions).find((d: any) => d.code === "TDS")?.amount || 0), 0))}</td></tr>
        <tr class="total-row"><td>Total TDS</td><td class="r">${fmt(totalTDS)}</td></tr>
      </tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">PART B — Details of Salary and Tax Computation</div>
    <table>
      <tbody>
        <tr><td>1. Gross Salary</td><td class="r">${fmt(totalGross)}</td></tr>
        <tr><td>&nbsp;&nbsp;a) Salary as per Section 17(1)</td><td class="r">${fmt(totalGross)}</td></tr>
        <tr><td>2. Less: Standard Deduction u/s 16(ia)</td><td class="r">${fmt(75000)}</td></tr>
        <tr><td>3. Less: Professional Tax u/s 16(iii)</td><td class="r">${fmt(totalPT)}</td></tr>
        <tr><td>4. Income chargeable under "Salaries"</td><td class="r">${fmt(Math.max(0, totalGross - 75000 - totalPT))}</td></tr>
        ${
          taxComp
            ? `
        <tr><td>5. Less: Deductions under Chapter VI-A</td><td class="r">${fmt(Number(taxComp.total_deductions))}</td></tr>
        <tr class="total-row"><td>6. Total Taxable Income</td><td class="r">${fmt(Number(taxComp.taxable_income))}</td></tr>
        <tr><td>7. Tax on Total Income</td><td class="r">${fmt(Number(taxComp.tax_on_income))}</td></tr>
        <tr><td>8. Surcharge</td><td class="r">${fmt(Number(taxComp.surcharge))}</td></tr>
        <tr><td>9. Health & Education Cess (4%)</td><td class="r">${fmt(Number(taxComp.health_and_education_cess))}</td></tr>
        <tr class="total-row"><td>10. Total Tax Liability</td><td class="r">${fmt(Number(taxComp.total_tax))}</td></tr>
        `
            : `
        <tr class="total-row"><td>5. Taxable Income (estimated)</td><td class="r">${fmt(Math.max(0, totalGross - 75000 - totalPT - totalPF))}</td></tr>
        `
        }
        <tr class="total-row"><td>11. Tax Deducted at Source (TDS)</td><td class="r">${fmt(totalTDS)}</td></tr>
      </tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Monthly Salary &amp; TDS Breakdown</div>
    <table>
      <thead><tr><th>Month</th><th>Gross Salary (₹)</th><th>TDS Deducted (₹)</th></tr></thead>
      <tbody>
        ${monthlyRows}
        <tr class="total-row"><td>Total</td><td class="r">${fmt(totalGross)}</td><td class="r">${fmt(totalTDS)}</td></tr>
      </tbody>
    </table>
  </div>

  <div class="sign-area">
    <div class="sign-box">
      <div class="sign-line">Employee Signature</div>
    </div>
    <div class="sign-box">
      <div class="sign-line">Authorized Signatory (Employer)</div>
    </div>
  </div>

  <div class="footer">
    This is a computer-generated Form 16. | ${org?.name || ""} | Generated on ${new Date().toLocaleDateString("en-IN")}
  </div>
</body>
</html>`;
  }

  private parseJSON(val: any): any {
    if (!val) return {};
    if (typeof val === "string")
      try {
        return JSON.parse(val);
      } catch {
        return {};
      }
    return val;
  }

  /** Parse a JSON value that is expected to be an array — always returns an array. */
  private parseArray(val: any): any[] {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  /** Parse a JSON value that is expected to be an object — always returns an object. */
  private parseObject(val: any): Record<string, any> {
    if (!val) return {};
    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }
    if (typeof val === "object" && !Array.isArray(val)) return val;
    return {};
  }

  private currentFY(): string {
    const now = new Date();
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return `${year}-${year + 1}`;
  }
}
