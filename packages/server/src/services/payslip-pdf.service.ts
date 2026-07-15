import fs from "fs";
import path from "path";
import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";
import { findUserById, findOrgById, getUserDepartmentName } from "../db/empcloud";

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

// Inline an uploaded logo as a base64 data URI so it renders in the payslip
// even when the HTML is saved standalone / printed to PDF (no live /uploads
// fetch). Returns "" on any problem so a missing/broken logo just falls back
// to the text company name.
function logoDataUri(logoPath?: string | null): string {
  if (!logoPath || typeof logoPath !== "string") return "";
  try {
    const file = path.join(UPLOAD_DIR, path.basename(logoPath));
    if (!fs.existsSync(file)) return "";
    const ext = path.extname(file).toLowerCase().replace(".", "");
    const mime =
      ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : `image/${ext || "png"}`;
    return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
  } catch {
    return "";
  }
}

// Render a rupee amount in Indian-numbering words (lakh/crore) for the
// payslip's "Net Pay in words" line — a standard, professional feature of
// Indian salary slips. Presentation-only; never used for computation.
function amountInWords(amount: number): string {
  const n = Math.round(Math.abs(Number(amount) || 0));
  if (n === 0) return "Zero Rupees Only";
  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];
  const two = (x: number): string =>
    x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? " " + ones[x % 10] : ""}`;
  const three = (x: number): string => {
    const h = Math.floor(x / 100);
    const r = x % 100;
    return `${h ? ones[h] + " Hundred" + (r ? " " : "") : ""}${r ? two(r) : ""}`;
  };
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  let words = "";
  if (crore) words += `${three(crore)} Crore `;
  if (lakh) words += `${two(lakh)} Lakh `;
  if (thousand) words += `${two(thousand)} Thousand `;
  if (rest) words += three(rest);
  const prefix = Number(amount) < 0 ? "Minus " : "";
  return `${prefix}${words.trim().replace(/\s+/g, " ")} Rupees Only`;
}

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

        // BUG-014 — render missing scalar fields as the en-dash placeholder
        // ("—") rather than the literal string "N/A". The previous "N/A"
        // confused several employees who thought it was a system-assigned
        // employee code. Using "—" matches the visual treatment used in
        // the rest of the payslip (bank, PAN/TAN, etc.).
        employee = {
          first_name: ecUser.first_name,
          last_name: ecUser.last_name,
          employee_code: ecUser.emp_code || profile?.employee_code || "—",
          department: departmentName || "—",
          designation: ecUser.designation || "—",
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
          logo_path: orgSettings?.logo_path || null,
        };
      } else {
        // Employee record missing from EmpCloud (e.g. after DB re-seed).
        // Use whatever data is available from the payroll profile.
        employee = {
          first_name: profile?.employee_code || "Employee",
          last_name: `#${empcloudUserId}`,
          employee_code: profile?.employee_code || "—",
          department: "—",
          designation: "—",
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
    // Employer-side contributions (Employer PF / EPS / EDLI / Admin / Employer
    // ESI). Stored on the payslip by computePayroll. Surfaced on the
    // payslip PDF as an informational "Employer Contributions" panel
    // alongside earnings/deductions so the employee sees the full Cost to
    // Company and not just their take-home.
    const employerContribs =
      typeof payslip.employer_contributions === "string"
        ? JSON.parse(payslip.employer_contributions || "[]")
        : payslip.employer_contributions || [];
    const totalEmployerContribs = employerContribs.reduce(
      (s: number, c: any) => s + Number(c.amount || 0),
      0,
    );

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

    // BUG-020 — Component name normalisation. The salary resolver stores
    // `name: c.name || c.code`, so a structure that didn't have a friendly
    // `name` populated at compute time leaves payslips with the bare code
    // ("SA"). When HR later edited the structure to add the friendly name
    // ("Special Allowance"), only NEW payslips picked it up -- the
    // already-stored ones still showed "SA". Normalise common standard
    // codes at render time so payslips read consistently regardless of
    // when they were computed.
    const STANDARD_COMPONENT_NAMES: Record<string, string> = {
      BASIC: "Basic Salary",
      HRA: "House Rent Allowance",
      SA: "Special Allowance",
      SPL: "Special Allowance",
      CONV: "Conveyance Allowance",
      LTA: "Leave Travel Allowance",
      MEDICAL: "Medical Allowance",
      DA: "Dearness Allowance",
      EPF: "Employee PF",
      EEPF: "Employee PF",
      "EEPF D": "Employee PF",
      PF: "Employee PF",
      ESI: "Employee ESI",
      EESI: "Employee ESI",
      PT: "Professional Tax",
      TDS: "Income Tax (TDS)",
      LOAN: "Loan EMI",
    };
    const friendlyName = (row: any): string => {
      const code = String(row.code || "")
        .toUpperCase()
        .trim();
      const name = String(row.name || "").trim();
      // If name is missing or equals the code (resolver fallback case),
      // try the standard map; otherwise use whatever name is stored.
      if (!name || name.toUpperCase() === code) {
        return STANDARD_COMPONENT_NAMES[code] || name || code;
      }
      return name;
    };

    const earningsRows = earnings
      .map((e: any) => `<tr><td>${friendlyName(e)}</td><td class="amt">${fmt(e.amount)}</td></tr>`)
      .join("");

    const deductionsRows = deductions
      .map((d: any) => `<tr><td>${friendlyName(d)}</td><td class="amt">${fmt(d.amount)}</td></tr>`)
      .join("");
    const employerRows = employerContribs
      .map((c: any) => `<tr><td>${friendlyName(c)}</td><td class="amt">${fmt(c.amount)}</td></tr>`)
      .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Payslip — ${employee.first_name} ${employee.last_name} — ${period}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; line-height: 1.5; color: #0f172a; background: #eef1f6; padding: 32px 16px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { max-width: 820px; margin: 0 auto; background: #fff; border: 1px solid #e6e9f0; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
  .brand-bar { height: 6px; background: linear-gradient(90deg, #6366f1, #4f46e5 55%, #4338ca); }
  .pad { padding: 36px 40px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 1px solid #e2e8f0; padding-bottom: 22px; margin-bottom: 26px; }
  .company-logo { max-height: 52px; max-width: 200px; margin-bottom: 10px; display: block; object-fit: contain; }
  .company-name { font-size: 21px; font-weight: 700; color: #4f46e5; letter-spacing: -0.01em; }
  .company-detail { font-size: 11px; color: #64748b; margin-top: 3px; }
  .header-right { text-align: right; flex-shrink: 0; }
  .payslip-title { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #4f46e5; background: #eef2ff; border: 1px solid #e0e7ff; padding: 6px 14px; border-radius: 999px; }
  .payslip-period { font-size: 16px; font-weight: 700; color: #0f172a; margin-top: 10px; }
  .payslip-sub { font-size: 10px; color: #94a3b8; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.08em; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 22px; }
  .info-box { background: #f8fafc; border: 1px solid #eef2f7; border-radius: 10px; padding: 16px 18px; }
  .info-box h4 { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #94a3b8; margin-bottom: 10px; font-weight: 700; }
  .info-row { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; }
  .info-row + .info-row { border-top: 1px solid #eef2f7; }
  .info-row .label { color: #64748b; }
  .info-row .value { font-weight: 600; color: #0f172a; text-align: right; }
  .days-info { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
  .day-pill { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; text-align: center; background: #fff; }
  .day-pill .k { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; font-weight: 600; }
  .day-pill .v { display: block; font-size: 18px; font-weight: 700; color: #0f172a; margin-top: 3px; font-variant-numeric: tabular-nums; }
  .earnings-deductions { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 22px; }
  .section { border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; }
  .section-header { padding: 11px 16px; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; display: flex; align-items: center; gap: 8px; background: #f8fafc; color: #334155; }
  .section-header::before { content: ""; width: 8px; height: 8px; border-radius: 2px; background: #94a3b8; }
  .section-header.earnings { background: #ecfdf5; color: #065f46; }
  .section-header.earnings::before { background: #10b981; }
  .section-header.deductions { background: #fef2f2; color: #991b1b; }
  .section-header.deductions::before { background: #ef4444; }
  .section-header.employer { background: #eff6ff; color: #1e40af; }
  .section-header.employer::before { background: #3b82f6; }
  table { width: 100%; border-collapse: collapse; }
  thead th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; font-weight: 600; padding: 8px 16px; background: #fcfcfd; border-bottom: 1px solid #eef2f7; }
  thead th.amt { text-align: right; }
  td { padding: 9px 16px; border-bottom: 1px solid #f3f4f6; color: #334155; }
  tbody tr:last-child td { border-bottom: none; }
  td.amt { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; color: #0f172a; }
  .total-row td { border-top: 1px solid #e5e7eb; font-weight: 700; background: #f8fafc; color: #0f172a; }
  .summary { display: grid; grid-template-columns: 1fr 1fr 1.3fr; gap: 1px; background: #e2e8f0; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; margin-bottom: 10px; }
  .summary-item { background: #fff; padding: 16px 18px; }
  .summary-item .k { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; font-weight: 700; }
  .summary-item .v { font-size: 17px; font-weight: 700; margin-top: 5px; font-variant-numeric: tabular-nums; }
  .summary-item.gross .v { color: #059669; }
  .summary-item.ded .v { color: #dc2626; }
  .summary-net { background: linear-gradient(135deg, #4f46e5, #4338ca); color: #fff; padding: 16px 20px; display: flex; flex-direction: column; justify-content: center; }
  .summary-net .k { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.85; font-weight: 700; }
  .summary-net .v { font-size: 26px; font-weight: 800; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .amount-words { font-size: 11px; color: #64748b; margin-bottom: 26px; padding: 10px 14px; background: #f8fafc; border: 1px dashed #e2e8f0; border-radius: 8px; }
  .amount-words strong { color: #334155; }
  .employer-note { margin-bottom: 26px; }
  .footer { border-top: 1px solid #e2e8f0; padding-top: 18px; font-size: 10.5px; color: #94a3b8; text-align: center; line-height: 1.8; }
  .footer .sign { color: #64748b; font-weight: 600; }
  .actions { display: flex; gap: 12px; justify-content: center; margin-bottom: 24px; }
  .print-btn { padding: 10px 26px; background: #4f46e5; color: #fff; border: none; border-radius: 9px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06); }
  .print-btn:hover { background: #4338ca; }
  .print-btn.secondary { background: #fff; color: #475569; border: 1px solid #cbd5e1; box-shadow: none; }
  .print-btn.secondary:hover { background: #f8fafc; }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { box-shadow: none; border: none; border-radius: 0; max-width: 100%; }
    .brand-bar { border-radius: 0; }
    .no-print { display: none; }
  }
  @media (max-width: 640px) {
    .info-grid, .earnings-deductions, .summary { grid-template-columns: 1fr; }
    .pad { padding: 24px 20px; }
  }
</style>
</head>
<body>
  <div class="actions no-print">
    <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
    <button class="print-btn secondary" onclick="downloadHTML()">Download as File</button>
  </div>
  <script>
    function downloadHTML() {
      var btns = document.querySelectorAll('.no-print');
      var script = document.querySelector('script');
      btns.forEach(function(el) { el.remove(); });
      if (script) script.remove();
      var html = document.documentElement.outerHTML;
      var a = document.createElement('a');
      a.href = 'data:text/html;charset=utf-8,' + encodeURIComponent('<!DOCTYPE html>' + html);
      a.download = 'payslip-${employee.first_name}-${employee.last_name}-${period.replace(/ /g, "-")}.html';
      a.click();
    }
  </script>

  <div class="sheet">
    <div class="brand-bar"></div>
    <div class="pad">

  <div class="header">
    <div>
      ${(() => {
        const logo = logoDataUri(org?.logo_path);
        return logo
          ? `<img class="company-logo" src="${logo}" alt="${org?.name || "Company"} logo" />`
          : "";
      })()}
      <div class="company-name">${org?.name || "Company"}</div>
      <div class="company-detail">${org?.legal_name || ""}</div>
      ${
        // BUG-015 — Hide the PAN/TAN row entirely when the org hasn't
        // configured either. Rendering "PAN: — | TAN: —" looked like
        // the data was meant to be there but was missing from THIS
        // payslip; suppressing the line removes the false alarm. When
        // either is set, we still show both halves so HR can see at a
        // glance which field is missing on the org record.
        org?.pan || org?.tan
          ? `<div class="company-detail">PAN: ${org?.pan || "—"} | TAN: ${org?.tan || "—"}</div>`
          : ""
      }
    </div>
    <div class="header-right">
      <span class="payslip-title">Payslip</span>
      <div class="payslip-period">${period}</div>
      <div class="payslip-sub">Salary Statement</div>
    </div>
  </div>

  <div class="info-grid">
    <div class="info-box">
      <h4>Employee Details</h4>
      <div class="info-row"><span class="label">Name</span><span class="value">${employee.first_name} ${employee.last_name}</span></div>
      ${
        // BUG-014 — Suppress info rows whose value is the en-dash
        // placeholder (i.e. the underlying field is unset). Showing
        // "Employee ID —" on a final payslip looked like a system
        // glitch. Better to omit the row so the section reads cleanly
        // and HR sees immediately which fields need backfilling on
        // the employee profile.
        employee.employee_code && employee.employee_code !== "—"
          ? `<div class="info-row"><span class="label">Employee ID</span><span class="value">${employee.employee_code}</span></div>`
          : ""
      }
      ${
        employee.department && employee.department !== "—"
          ? `<div class="info-row"><span class="label">Department</span><span class="value">${employee.department}</span></div>`
          : ""
      }
      ${
        employee.designation && employee.designation !== "—"
          ? `<div class="info-row"><span class="label">Designation</span><span class="value">${employee.designation}</span></div>`
          : ""
      }
    </div>
    <div class="info-box">
      <h4>Bank Details</h4>
      <div class="info-row"><span class="label">Bank</span><span class="value">${bankDetails.bankName || "—"}</span></div>
      <div class="info-row"><span class="label">Account</span><span class="value">${bankDetails.accountNumber ? "****" + bankDetails.accountNumber.slice(-4) : "—"}</span></div>
      <div class="info-row"><span class="label">IFSC</span><span class="value">${bankDetails.ifscCode || "—"}</span></div>
    </div>
  </div>

  <div class="days-info">
    <div class="day-pill"><span class="k">Paid Days</span><span class="v">${payslip.paid_days}</span></div>
    <div class="day-pill"><span class="k">Total Days</span><span class="v">${payslip.total_days}</span></div>
    <div class="day-pill"><span class="k">LOP Days</span><span class="v">${payslip.lop_days}</span></div>
  </div>

  <div class="earnings-deductions">
    <div class="section">
      <div class="section-header earnings">Earnings</div>
      <table>
        <thead><tr><th>Component</th><th class="amt">Amount</th></tr></thead>
        <tbody>
          ${earningsRows}
          <tr class="total-row"><td>Total Earnings</td><td class="amt">${fmt(payslip.gross_earnings)}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="section">
      <div class="section-header deductions">Deductions</div>
      <table>
        <thead><tr><th>Component</th><th class="amt">Amount</th></tr></thead>
        <tbody>
          ${deductionsRows}
          <tr class="total-row"><td>Total Deductions</td><td class="amt">${fmt(payslip.total_deductions)}</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="summary">
    <div class="summary-item gross">
      <div class="k">Gross Earnings</div>
      <div class="v">${fmt(payslip.gross_earnings)}</div>
    </div>
    <div class="summary-item ded">
      <div class="k">Total Deductions</div>
      <div class="v">-${fmt(payslip.total_deductions)}</div>
    </div>
    <div class="summary-net">
      <div class="k">Net Pay</div>
      <div class="v">${fmt(payslip.net_pay)}</div>
    </div>
  </div>
  <div class="amount-words"><strong>Net pay in words:</strong> ${amountInWords(payslip.net_pay)}</div>

  ${
    /* Employer Contributions panel — informational only, NOT deducted
       from take-home. Surfaced so the employee sees the full Cost to
       Company (gross + Employer PF / EPS / EDLI / Admin / Employer ESI)
       and can verify what their offer-letter CTC covers. */
    employerRows
      ? `<div class="section employer-note">
           <div class="section-header employer">Employer Contributions · Paid by company, not deducted</div>
           <table>
             <thead><tr><th>Component</th><th class="amt">Amount</th></tr></thead>
             <tbody>
               ${employerRows}
               <tr class="total-row"><td>Total Employer Contribution</td><td class="amt">${fmt(totalEmployerContribs)}</td></tr>
             </tbody>
           </table>
         </div>`
      : ""
  }

  <div class="footer">
    <div class="sign">This is a computer-generated payslip and does not require a signature.</div>
    ${org?.name || "Company"} &middot; Generated on ${
      // BUG-028 — Use unambiguous DD MMM YYYY format. The previous
      // toLocaleDateString("en-IN") output was "06/05/2026", which a US
      // reader would parse as June 5 -- a real concern on a statutory
      // document that may be shown to non-IN reviewers. "06 May 2026"
      // can only be read one way.
      new Date().toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    } &middot; Confidential
  </div>

    </div>
  </div>
</body>
</html>`;
  }
}
