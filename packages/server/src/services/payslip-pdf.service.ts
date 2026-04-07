import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";
import { findUserById, findOrgById, getUserDepartmentName } from "../db/empcloud";

export class PayslipPDFService {
  private db = getDB();

  async generateHTML(payslipId: string): Promise<string> {
    const payslip = await this.db.findById<any>("payslips", payslipId);
    if (!payslip) throw new AppError(404, "NOT_FOUND", "Payslip not found");

    let employee: any = null;
    let bankDetails: any = {};
    let org: any = null;

    // Look up payroll profile — works with both empcloud_user_id and employee_id
    let profile: any = null;
    if (payslip.empcloud_user_id) {
      profile = await this.db.findOne<any>("employee_payroll_profiles", {
        empcloud_user_id: Number(payslip.empcloud_user_id),
      });
    }
    // Fallback: employee_id may be a payroll profile UUID (seed data sets it this way)
    if (
      !profile &&
      payslip.employee_id &&
      payslip.employee_id !== "00000000-0000-0000-0000-000000000000"
    ) {
      profile = await this.db.findById<any>("employee_payroll_profiles", payslip.employee_id);
    }

    // Resolve the empcloud_user_id — from payslip directly, or from the payroll profile
    const empcloudUserId = payslip.empcloud_user_id
      ? Number(payslip.empcloud_user_id)
      : profile?.empcloud_user_id
        ? Number(profile.empcloud_user_id)
        : null;

    if (empcloudUserId) {
      const ecUser = await findUserById(empcloudUserId);

      if (ecUser) {
        // Primary path: employee found in EmpCloud
        const departmentName = await getUserDepartmentName(ecUser.department_id);

        employee = {
          first_name: ecUser.first_name,
          last_name: ecUser.last_name,
          employee_code: ecUser.emp_code || profile?.employee_code || "N/A",
          department: departmentName || "N/A",
          designation: ecUser.designation || "N/A",
        };

        // Get org from payroll settings + EmpCloud org for name fallback
        const orgSettings = await this.db.findOne<any>("organization_payroll_settings", {
          empcloud_org_id: Number(ecUser.organization_id),
        });
        const ecOrg = await findOrgById(ecUser.organization_id);
        org = {
          name: orgSettings?.name || ecOrg?.name || "Company",
          legal_name: orgSettings?.legal_name || ecOrg?.legal_name || "",
          pan: orgSettings?.pan || "",
          tan: orgSettings?.tan || "",
        };
      } else {
        // Employee record missing from EmpCloud (e.g. after DB re-seed).
        // Use whatever data is available from the payroll profile.
        employee = {
          first_name: profile?.employee_code || "Employee",
          last_name: `#${empcloudUserId}`,
          employee_code: profile?.employee_code || "N/A",
          department: "N/A",
          designation: "N/A",
        };

        // Resolve org from profile or from the payroll run
        if (profile?.empcloud_org_id) {
          org = await this.db.findOne<any>("organization_payroll_settings", {
            empcloud_org_id: Number(profile.empcloud_org_id),
          });
        }
        if (!org && payslip.payroll_run_id) {
          const run = await this.db.findById<any>("payroll_runs", payslip.payroll_run_id);
          if (run?.empcloud_org_id) {
            org = await this.db.findOne<any>("organization_payroll_settings", {
              empcloud_org_id: Number(run.empcloud_org_id),
            });
          }
        }
      }

      bankDetails = profile?.bank_details
        ? typeof profile.bank_details === "string"
          ? JSON.parse(profile.bank_details)
          : profile.bank_details
        : {};
    } else {
      // Legacy fallback: employee_id references old employees table
      employee = await this.db.findById<any>("employees", payslip.employee_id);
      if (!employee) throw new AppError(404, "NOT_FOUND", "Employee not found");
      org = await this.db.findById<any>("organizations", employee.org_id);
      bankDetails =
        typeof employee.bank_details === "string"
          ? JSON.parse(employee.bank_details)
          : employee.bank_details || {};
    }
    const earnings =
      typeof payslip.earnings === "string" ? JSON.parse(payslip.earnings) : payslip.earnings || [];
    const deductions =
      typeof payslip.deductions === "string"
        ? JSON.parse(payslip.deductions)
        : payslip.deductions || [];

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
    const period = `${monthNames[payslip.month]} ${payslip.year}`;

    const fmt = (n: number) =>
      new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(n);

    const earningsRows = earnings
      .map((e: any) => `<tr><td>${e.name || e.code}</td><td class="amt">${fmt(e.amount)}</td></tr>`)
      .join("");

    const deductionsRows = deductions
      .map((d: any) => `<tr><td>${d.name || d.code}</td><td class="amt">${fmt(d.amount)}</td></tr>`)
      .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Payslip — ${employee.first_name} ${employee.last_name} — ${period}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #1a1a1a; padding: 40px; max-width: 800px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #4f46e5; padding-bottom: 20px; margin-bottom: 20px; }
  .company-name { font-size: 22px; font-weight: 700; color: #4f46e5; }
  .company-detail { font-size: 11px; color: #666; margin-top: 4px; }
  .payslip-title { font-size: 18px; font-weight: 600; text-align: right; }
  .payslip-period { font-size: 13px; color: #666; text-align: right; margin-top: 4px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .info-box { background: #f8f9fa; border-radius: 8px; padding: 16px; }
  .info-box h4 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 8px; }
  .info-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .info-row .label { color: #666; }
  .info-row .value { font-weight: 500; }
  .earnings-deductions { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .section { border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
  .section-header { background: #f0f0f0; padding: 10px 16px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  .section-header.earnings { background: #ecfdf5; color: #065f46; }
  .section-header.deductions { background: #fef2f2; color: #991b1b; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 8px 16px; border-bottom: 1px solid #f3f4f6; }
  td.amt { text-align: right; font-weight: 500; font-variant-numeric: tabular-nums; }
  .total-row td { border-top: 2px solid #e5e7eb; font-weight: 700; background: #fafafa; }
  .net-pay { text-align: center; background: #4f46e5; color: white; border-radius: 8px; padding: 20px; margin-bottom: 24px; }
  .net-pay .label { font-size: 12px; opacity: 0.8; text-transform: uppercase; letter-spacing: 1px; }
  .net-pay .amount { font-size: 28px; font-weight: 700; margin-top: 4px; }
  .footer { border-top: 1px solid #e5e7eb; padding-top: 16px; font-size: 11px; color: #999; text-align: center; }
  .days-info { display: flex; gap: 24px; justify-content: center; margin-bottom: 24px; }
  .days-info span { background: #f3f4f6; padding: 6px 14px; border-radius: 6px; font-size: 12px; }
  @media print { body { padding: 20px; } .no-print { display: none; } }
  .actions { display: flex; gap: 12px; justify-content: center; margin-bottom: 24px; }
  .print-btn { padding: 10px 32px; background: #4f46e5; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; }
  .print-btn:hover { background: #4338ca; }
  .print-btn.secondary { background: #6b7280; }
  .print-btn.secondary:hover { background: #4b5563; }
</style>
</head>
<body>
  <div class="actions no-print">
    <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
    <button class="print-btn secondary" onclick="downloadHTML()">Download as File</button>
  </div>
  <script>
    function downloadHTML() {
      var a = document.createElement('a');
      a.href = 'data:text/html;charset=utf-8,' + encodeURIComponent(document.documentElement.outerHTML);
      a.download = 'payslip-${employee.first_name}-${employee.last_name}-${period.replace(/ /g, "-")}.html';
      a.click();
    }
  </script>

  <div class="header">
    <div>
      <div class="company-name">${org?.name || "Company"}</div>
      <div class="company-detail">${org?.legal_name || ""}</div>
      <div class="company-detail">PAN: ${org?.pan || "—"} | TAN: ${org?.tan || "—"}</div>
    </div>
    <div>
      <div class="payslip-title">Payslip</div>
      <div class="payslip-period">${period}</div>
    </div>
  </div>

  <div class="info-grid">
    <div class="info-box">
      <h4>Employee Details</h4>
      <div class="info-row"><span class="label">Name</span><span class="value">${employee.first_name} ${employee.last_name}</span></div>
      <div class="info-row"><span class="label">Employee ID</span><span class="value">${employee.employee_code}</span></div>
      <div class="info-row"><span class="label">Department</span><span class="value">${employee.department}</span></div>
      <div class="info-row"><span class="label">Designation</span><span class="value">${employee.designation}</span></div>
    </div>
    <div class="info-box">
      <h4>Bank Details</h4>
      <div class="info-row"><span class="label">Bank</span><span class="value">${bankDetails.bankName || "—"}</span></div>
      <div class="info-row"><span class="label">Account</span><span class="value">${bankDetails.accountNumber ? "****" + bankDetails.accountNumber.slice(-4) : "—"}</span></div>
      <div class="info-row"><span class="label">IFSC</span><span class="value">${bankDetails.ifscCode || "—"}</span></div>
    </div>
  </div>

  <div class="days-info">
    <span><strong>Paid Days:</strong> ${payslip.paid_days}</span>
    <span><strong>Total Days:</strong> ${payslip.total_days}</span>
    <span><strong>LOP Days:</strong> ${payslip.lop_days}</span>
  </div>

  <div class="earnings-deductions">
    <div class="section">
      <div class="section-header earnings">Earnings</div>
      <table>
        ${earningsRows}
        <tr class="total-row"><td>Total Earnings</td><td class="amt">${fmt(payslip.gross_earnings)}</td></tr>
      </table>
    </div>
    <div class="section">
      <div class="section-header deductions">Deductions</div>
      <table>
        ${deductionsRows}
        <tr class="total-row"><td>Total Deductions</td><td class="amt">${fmt(payslip.total_deductions)}</td></tr>
      </table>
    </div>
  </div>

  <div class="net-pay">
    <div class="label">Net Pay</div>
    <div class="amount">${fmt(payslip.net_pay)}</div>
  </div>

  <div class="footer">
    This is a system-generated payslip. | ${org?.name || "Company"} | Generated on ${new Date().toLocaleDateString("en-IN")}
  </div>
</body>
</html>`;
  }
}
