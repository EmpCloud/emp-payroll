/** Monetary values in this module are integer fils, including the frozen WPS allocation. */
export interface UaeReportLine {
  label: string;
  amount: number;
}

export interface UaeVariablePayBreakdown {
  housing: number;
  conveyance: number;
  medical: number;
  annualPassage: number;
  overtime: number;
  other: number;
  leaveEncashment: number;
}

export interface UaeReportingSnapshot {
  approvalStatus: "approved" | "paid";
  employer: { name: string; address?: string; registrationNumber?: string };
  employee: {
    id: string;
    name: string;
    employeeCode?: string;
    jobTitle?: string;
    bankAccount?: string;
  };
  year: number;
  month: number;
  periodStart: string;
  periodEnd: string;
  currency: string;
  grossPay: number;
  totalDeductions: number;
  netPay: number;
  earnings: UaeReportLine[];
  deductions: UaeReportLine[];
  employerBenefits: UaeReportLine[];
  dueDate: string;
  /** Informational breakdown of settlement amounts already included in the totals. */
  finalSettlement?: UaeReportLine[];
  wps?: {
    scope: "mohre" | "exempt" | "outside_mohre";
    exemptionReason?: string;
    exemptionEvidence?: string;
    employeeId?: string;
    agentRoutingCode?: string;
    account?: string;
    /** Explicit approved NET allocation, not the employee's contractual gross amounts. */
    fixedIncome: number;
    variableIncome: number;
    variableBreakdown?: UaeVariablePayBreakdown;
    unpaidLeaveDays: number;
    /** Wages owed before lawful deductions, excluding non-wage payments. */
    wagesDue?: number;
  };
}

export type UaePaymentStatus =
  | "not_confirmed"
  | "submitted"
  | "uploaded"
  | "accepted"
  | "partially_paid"
  | "paid"
  | "failed"
  | "rejected"
  | "refunded";

export class UaeReportingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "UaeReportingError";
  }
}

function requireValue(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new UaeReportingError(code, message);
}

function amount(value: number, label: string): number {
  requireValue(
    Number.isSafeInteger(value) && value >= 0,
    "UAE_REPORT_AMOUNT_INVALID",
    `${label} must be a non-negative integer number of fils.`,
  );
  return value;
}

function total(values: number[], label: string): number {
  return values.reduce((sum, value) => amount(sum + amount(value, label), label), 0);
}

function date(value: string, label: string): Date {
  requireValue(
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value),
    "UAE_REPORT_DATE_INVALID",
    `${label} must be a calendar date (YYYY-MM-DD).`,
  );
  const parsed = new Date(`${value}T00:00:00Z`);
  requireValue(
    Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value,
    "UAE_REPORT_DATE_INVALID",
    `${label} is not a valid calendar date.`,
  );
  return parsed;
}

function monthKey(year: number, month: number): string {
  requireValue(
    Number.isInteger(year) &&
      year >= 2000 &&
      year <= 9999 &&
      Number.isInteger(month) &&
      month >= 1 &&
      month <= 12,
    "UAE_REPORT_PERIOD_INVALID",
    "Enter a valid payroll year and month.",
  );
  return `${year}-${String(month).padStart(2, "0")}`;
}

function textValue(value: string, label: string): string {
  requireValue(
    typeof value === "string" && value.trim().length > 0,
    "UAE_REPORT_TEXT_INVALID",
    `${label} is required in the approved snapshot.`,
  );
  return value;
}

function validateSnapshot(snapshot: UaeReportingSnapshot): void {
  requireValue(
    snapshot?.approvalStatus === "approved" || snapshot?.approvalStatus === "paid",
    "UAE_REPORT_NOT_APPROVED",
    "Approve the payroll snapshot before producing a payslip or payment file.",
  );
  requireValue(
    snapshot.currency === "AED",
    "UAE_REPORT_CURRENCY_INVALID",
    "This UAE reporting profile supports AED only.",
  );
  textValue(snapshot.employer?.name, "Employer name");
  textValue(snapshot.employee?.id, "Employee identifier");
  textValue(snapshot.employee?.name, "Employee name");
  const key = monthKey(snapshot.year, snapshot.month);
  const start = date(snapshot.periodStart, "Pay period start");
  const end = date(snapshot.periodEnd, "Pay period end");
  requireValue(
    start <= end && snapshot.periodStart.startsWith(key) && snapshot.periodEnd.startsWith(key),
    "UAE_REPORT_PERIOD_INVALID",
    "The pay period must fall within the payroll month.",
  );
  date(snapshot.dueDate, "Payment due date");
  for (const lines of [
    snapshot.earnings,
    snapshot.deductions,
    snapshot.employerBenefits,
    snapshot.finalSettlement ?? [],
  ]) {
    requireValue(
      Array.isArray(lines),
      "UAE_REPORT_LINES_INVALID",
      "The approved payroll must contain itemised report lines.",
    );
    for (const line of lines) {
      textValue(line?.label, "Payroll line label");
      amount(line.amount, line.label);
    }
  }
  amount(snapshot.grossPay, "Gross pay");
  amount(snapshot.totalDeductions, "Total deductions");
  amount(snapshot.netPay, "Net pay");
  requireValue(
    total(
      snapshot.earnings.map((line) => line.amount),
      "Earnings",
    ) === snapshot.grossPay &&
      total(
        snapshot.deductions.map((line) => line.amount),
        "Deductions",
      ) === snapshot.totalDeductions &&
      snapshot.grossPay - snapshot.totalDeductions === snapshot.netPay,
    "UAE_REPORT_TOTAL_MISMATCH",
    "Approved earnings, deductions and net pay do not reconcile.",
  );
}

function escapeHtml(value: string): string {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

function money(value: number): string {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

const statusLabels: Record<UaePaymentStatus, string> = {
  not_confirmed: "Payment not confirmed",
  submitted: "Payment submitted — receipt not confirmed",
  uploaded: "File uploaded — payment not confirmed",
  accepted: "File accepted — payment not confirmed",
  partially_paid: "Partially paid",
  paid: "Payment confirmed",
  failed: "Payment failed",
  rejected: "Payment rejected",
  refunded: "Payment refunded — wages outstanding",
};

/** Renders frozen identity/calculation fields with a fixed print action and no external resources. */
export function renderUaePayslip(data: {
  snapshot: UaeReportingSnapshot;
  paymentStatus?: UaePaymentStatus;
}): string {
  const { snapshot } = data;
  validateSnapshot(snapshot);
  const status = data.paymentStatus ?? "not_confirmed";
  requireValue(
    Object.hasOwn(statusLabels, status),
    "UAE_REPORT_STATUS_INVALID",
    "Unknown payment status.",
  );
  // Group digits only for display; bank files continue to use the ungrouped money format.
  const displayMoney = (value: number) => {
    const [whole, fraction] = money(value).split(".");
    return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
  };
  const periodLabel = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${snapshot.periodStart}T00:00:00Z`));
  const section = (
    title: string,
    lines: UaeReportLine[],
    options: { note?: string; total?: number; empty?: string } = {},
  ) => `<section class="line-section"><div class="section-heading"><h2>${title}</h2>${options.note ? `<p>${options.note}</p>` : ""}</div>
<table aria-label="${title}"><thead><tr><th scope="col">Description</th><th scope="col">Amount (AED)</th></tr></thead><tbody>${lines.length ? lines.map((line) => `<tr><td>${escapeHtml(line.label)}</td><td class="amount">${displayMoney(line.amount)}</td></tr>`).join("") : `<tr><td class="empty">${options.empty ?? "No items for this period"}</td><td class="amount">0.00</td></tr>`}</tbody>${options.total !== undefined ? `<tfoot><tr><th scope="row">Total ${title.toLowerCase()}</th><td class="amount">${displayMoney(options.total)}</td></tr></tfoot>` : ""}</table></section>`;
  const detail = (label: string, value?: string) =>
    value ? `<div class="detail"><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>` : "";
  const account = snapshot.employee.bankAccount ?? snapshot.wps?.account;
  const maskedAccount = account ? `•••• ${String(account).slice(-4)}` : undefined;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payslip — ${escapeHtml(snapshot.employee.name)}</title><style>
*{box-sizing:border-box}
body{margin:0;padding:28px 24px 48px;background:#f1f4f8;color:#18283b;font:14px/1.5 Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.toolbar{max-width:960px;margin:0 auto 18px;display:flex;justify-content:space-between;align-items:center;gap:16px;color:#536478;font-size:13px}
.print-action{border:0;border-radius:7px;padding:11px 18px;background:#224e80;color:white;font:600 13px Arial,sans-serif;cursor:pointer;white-space:nowrap}
.print-action:hover{background:#183c65}.print-action:focus-visible{outline:3px solid #4489cd;outline-offset:3px}
main{max-width:960px;margin:auto;padding:36px 40px 24px;background:white;border:1px solid #dce3eb;border-top:5px solid #224e80;border-radius:12px;box-shadow:0 8px 30px #1834520d}
.document-header{display:flex;justify-content:space-between;gap:32px;padding-bottom:24px;border-bottom:1px solid #dce3eb}
.employer{min-width:0;max-width:65%}.eyebrow{margin:0 0 7px;color:#64758a;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase}
.employer-name{font-size:22px;line-height:1.3;margin:0 0 8px;overflow-wrap:anywhere}
.employer-address,.registration{margin:3px 0;font-size:12px;color:#536478;overflow-wrap:anywhere}
.document-title{text-align:right;flex-shrink:0}h1{margin:0;font-size:29px;line-height:1.2;letter-spacing:-.6px}.period{margin:8px 0 0;color:#536478;font-size:14px}
.employee-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin:24px 0 18px}.employee-heading h2{margin:0;font-size:20px;line-height:1.35;overflow-wrap:anywhere}
.status{display:inline-block;max-width:270px;border:1px solid #ebd2a3;border-radius:6px;padding:6px 10px;background:#fff7e8;color:#865816;font-size:11px;font-weight:600;text-align:center}
.status[data-payment-status="paid"]{background:#edf7f1;border-color:#b9ddc9;color:#226448}
.status[data-payment-status="failed"],.status[data-payment-status="rejected"],.status[data-payment-status="refunded"]{background:#fff0ee;border-color:#edc2bb;color:#9b382b}
.details{display:grid;grid-template-columns:1fr 1fr;gap:16px 32px;margin:0;padding:18px 20px;background:#f7f9fc;border:1px solid #e3e9f0;border-radius:8px}
.detail{min-width:0}dt{color:#64758a;font-size:11px;margin-bottom:3px}dd{margin:0;font-weight:600;font-size:12px;overflow-wrap:anywhere}
.pay-breakdown{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px;margin-top:26px;align-items:start}
.line-section{min-width:0;margin-top:24px}.pay-breakdown .line-section{margin-top:0}.section-heading{margin-bottom:10px}.section-heading h2{font-size:14px;margin:0;font-weight:700}.section-heading p{font-size:11px;color:#64758a;margin:3px 0 0}
table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px}th,td{padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid #e5eaf0;overflow-wrap:anywhere}
thead th{background:#f1f5fa;color:#536478;font-size:10px;font-weight:600}th:last-child,td:last-child{width:40%;text-align:right}.amount{font-variant-numeric:tabular-nums;white-space:nowrap}
tfoot th,tfoot td{font-weight:700;background:#f7f9fc;border-bottom:0}.empty{color:#64758a;font-style:italic}
.summary{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:22px 24px;margin-top:28px;border:1px solid #b7cbdc;border-radius:8px;background:#edf4fa}
.summary-breakdown{min-width:0;font-size:12px}.summary-row{display:flex;justify-content:space-between;gap:24px;margin:4px 0;color:#536478}.summary-row strong{color:#18283b;font-variant-numeric:tabular-nums;white-space:nowrap}
.net-pay{text-align:right}.net-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#405d7b}.net-amount{font-size:29px;font-weight:700;line-height:1.3;color:#183f68;font-variant-numeric:tabular-nums;white-space:nowrap}.currency{font-size:15px;font-weight:600;margin-right:5px}
footer{margin-top:22px;padding-top:16px;border-top:1px solid #e3e9f0;font-size:10px;color:#64758a}footer p{margin:0}.footer-label{display:block;margin-bottom:5px;color:#536478;font-weight:600}
@media(max-width:640px){body{padding:16px 12px 28px}.toolbar{font-size:11px}main{padding:24px 20px 20px}.document-header{flex-direction:column;gap:16px}.employer{max-width:none}.document-title{text-align:left}h1{font-size:24px}.employee-heading{flex-direction:column;gap:12px}.status{max-width:none}.details{grid-template-columns:1fr;padding:16px;gap:14px}.pay-breakdown{grid-template-columns:1fr;gap:24px}.summary{flex-direction:column;align-items:stretch;padding:18px}.net-pay{text-align:left;border-top:1px solid #cbd9e6;padding-top:14px}.net-amount{font-size:27px}}
@page{size:A4;margin:14mm}
@media print{body{background:white;padding:0;color:#18283b;font-size:11px}.toolbar{display:none}main{max-width:none;border:0;border-radius:0;box-shadow:none;padding:0}.document-header{padding-bottom:18px}.employee-heading{margin:18px 0 14px}.details{gap:12px 24px;padding:14px 16px}.pay-breakdown{margin-top:20px;gap:20px}.line-section{margin-top:20px}th,td{padding:8px 10px}.summary{margin-top:22px;padding:18px 20px}.document-header,.employee-heading,.details,.summary,footer,tr{break-inside:avoid}.section-heading{break-after:avoid}thead{display:table-header-group}tfoot{display:table-row-group}footer{margin-top:18px}}
</style></head><body><div class="toolbar"><span>Salary statement · ${periodLabel}</span><button class="print-action" type="button" onclick="window.print()">Print / Save PDF</button></div>
<main><header class="document-header"><div class="employer"><p class="eyebrow">Employer</p><h2 class="employer-name">${escapeHtml(snapshot.employer.name)}</h2>${snapshot.employer.address ? `<p class="employer-address">${escapeHtml(snapshot.employer.address)}</p>` : ""}${snapshot.employer.registrationNumber ? `<p class="registration">Registration number: ${escapeHtml(snapshot.employer.registrationNumber)}</p>` : ""}</div><div class="document-title"><h1>Payslip</h1><p class="period">${periodLabel}</p></div></header>
<div class="employee-heading"><div><p class="eyebrow">Employee</p><h2>${escapeHtml(snapshot.employee.name)}</h2></div><span class="status" data-payment-status="${status}">${statusLabels[status]}</span></div>
<dl class="details">${detail(snapshot.employee.employeeCode ? "Employee code" : "Employee ID", snapshot.employee.employeeCode ?? snapshot.employee.id)}${detail("Job title", snapshot.employee.jobTitle)}${detail("Pay period", `${snapshot.periodStart} to ${snapshot.periodEnd}`)}${detail("Payment due", snapshot.dueDate)}${detail("Bank account", maskedAccount)}</dl>
<div class="pay-breakdown">${section("Earnings", snapshot.earnings, { total: snapshot.grossPay })}${section("Employee deductions", snapshot.deductions, { total: snapshot.totalDeductions, empty: "No deductions this period" })}</div>
${section("Employer benefits", snapshot.employerBenefits, { note: "Not deducted from net pay.", empty: "No employer benefits this period" })}
${snapshot.finalSettlement ? section("Final settlement breakdown", snapshot.finalSettlement, { note: "Settlement amounts are already included in the earnings or deductions above." }) : ""}
<section class="summary" aria-label="Pay summary"><div class="summary-breakdown"><div class="summary-row" aria-label="Gross pay: AED ${displayMoney(snapshot.grossPay)}"><span>Gross pay</span><strong>AED ${displayMoney(snapshot.grossPay)}</strong></div><div class="summary-row" aria-label="Employee deductions: AED ${displayMoney(snapshot.totalDeductions)}"><span>Employee deductions</span><strong>AED ${displayMoney(snapshot.totalDeductions)}</strong></div></div><div class="net-pay" aria-label="Net pay: AED ${displayMoney(snapshot.netPay)}"><div class="net-label">Net pay</div><div class="net-amount"><span class="currency">AED</span>${displayMoney(snapshot.netPay)}</div></div></section>
<footer><span class="footer-label">Confidential · Employee salary statement</span><p>This statement records the approved payroll calculation. A generated or uploaded payment file does not confirm receipt of wages.</p></footer></main></body></html>`;
}

function bankField(value: string | undefined, pattern: RegExp, label: string): string {
  requireValue(
    typeof value === "string" && !/[,"\x00-\x1f\x7f]/.test(value) && pattern.test(value),
    "UAE_SIF_IDENTIFIER_INVALID",
    `${label} is invalid for the selected DIB v1.1 profile.`,
  );
  return value;
}

function iban(value: string | undefined): string {
  const account = bankField(value, /^AE\d{21}$/, "Employee UAE IBAN");
  const rearranged = `${account.slice(4)}1014${account.slice(2, 4)}`;
  let remainder = 0;
  for (const digit of rearranged) remainder = (remainder * 10 + Number(digit)) % 97;
  requireValue(
    remainder === 1,
    "UAE_SIF_IBAN_INVALID",
    "The employee UAE IBAN checksum is invalid.",
  );
  return account;
}

function sifMoney(value: number): string {
  const output = money(amount(value, "WPS payment"));
  requireValue(
    output.length <= 15,
    "UAE_SIF_AMOUNT_TOO_LARGE",
    "The payment exceeds the selected bank format's amount width.",
  );
  return output;
}

function exclusion(snapshot: UaeReportingSnapshot): string | null {
  const wps = snapshot.wps;
  requireValue(
    wps && ["mohre", "exempt", "outside_mohre"].includes(wps.scope),
    "UAE_SIF_SCOPE_MISSING",
    `Record the WPS scope for employee ${snapshot.employee.id}.`,
  );
  if (wps.scope === "mohre") return null;
  textValue(wps.exemptionReason, "WPS exclusion reason");
  if (wps.scope === "exempt") textValue(wps.exemptionEvidence, "WPS exemption evidence reference");
  return wps.exemptionReason;
}

export interface UaeSifInput {
  version: "dib-v1.1";
  /** Omit EVP only for an explicitly selected receiving-bank profile that permits it. */
  includeEvp?: boolean;
  employerId: string;
  employerRoutingCode: string;
  reference?: string;
  /** ISO instant with an explicit timezone; file date/time are rendered in UAE time. */
  createdAt: string;
  month: number;
  year: number;
  items: UaeReportingSnapshot[];
}

/**
 * Layout source: https://dib.ae/docs/default-source/wps-guidelines/wps-file-format-reference-guide_v1-1.pdf
 * One EDR, optional EVP, and one final SCR. This explicitly selected historical bank profile
 * still requires the employer's bank to confirm acceptance; it is not a universal 2026 format.
 */
export function generateUaeSif(input: UaeSifInput) {
  requireValue(
    input.version === "dib-v1.1",
    "UAE_SIF_VERSION_REQUIRED",
    "Select the bank-approved DIB v1.1 SIF format explicitly.",
  );
  const key = monthKey(input.year, input.month);
  const employerId = bankField(
    input.employerId,
    /^[A-Za-z0-9]{13,35}$/,
    "Employer labour-authority ID",
  );
  const routing = bankField(input.employerRoutingCode, /^\d{9}$/, "Employer bank routing code");
  const reference =
    input.reference == null || input.reference === ""
      ? ""
      : bankField(input.reference, /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,34}$/, "Employer reference");
  requireValue(
    typeof input.createdAt === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
        input.createdAt,
      ),
    "UAE_REPORT_DATE_INVALID",
    "File creation time must include an explicit timezone.",
  );
  date(input.createdAt.slice(0, 10), "File creation date");
  const instant = Date.parse(input.createdAt);
  requireValue(
    Number.isFinite(instant),
    "UAE_REPORT_DATE_INVALID",
    "File creation time is invalid.",
  );
  const local = new Date(instant + 4 * 60 * 60 * 1000).toISOString();
  const creationDate = local.slice(0, 10);
  const creationTime = local.slice(11, 16).replace(":", "");
  const stamp = local.slice(2, 10).replaceAll("-", "") + local.slice(11, 19).replaceAll(":", "");
  const lines: string[] = [];
  const seen = new Set<string>();
  const excluded: { employeeId: string; reason: string }[] = [];
  const amounts: number[] = [];
  const variableKeys: (keyof UaeVariablePayBreakdown)[] = [
    "housing",
    "conveyance",
    "medical",
    "annualPassage",
    "overtime",
    "other",
    "leaveEncashment",
  ];
  for (const snapshot of input.items) {
    validateSnapshot(snapshot);
    requireValue(
      snapshot.month === input.month && snapshot.year === input.year,
      "UAE_REPORT_PERIOD_INVALID",
      "All snapshots must match the SIF salary month.",
    );
    const reason = exclusion(snapshot);
    if (reason) {
      excluded.push({ employeeId: snapshot.employee.id, reason });
      continue;
    }
    requireValue(
      !snapshot.finalSettlement,
      "UAE_SIF_SETTLEMENT_REVIEW_REQUIRED",
      "Final settlements require a reviewed bank allocation separating wages and other entitlements; this salary export does not include them.",
    );
    const wps = snapshot.wps!;
    const employeeId = bankField(
      wps.employeeId,
      /^[A-Za-z0-9]{14,35}$/,
      "Employee labour-authority ID",
    );
    requireValue(
      !seen.has(employeeId),
      "UAE_SIF_EMPLOYEE_DUPLICATE",
      `Employee labour-authority ID ${employeeId} appears more than once.`,
    );
    seen.add(employeeId);
    const agent = bankField(wps.agentRoutingCode, /^\d{9}$/, "Employee agent routing code");
    const account = iban(wps.account);
    const days =
      (date(snapshot.periodEnd, "Pay period end").getTime() -
        date(snapshot.periodStart, "Pay period start").getTime()) /
        86400000 +
      1;
    requireValue(
      days > 1,
      "UAE_SIF_PERIOD_REVIEW_REQUIRED",
      "DIB v1.1 requires the end date to follow the start date; obtain bank guidance for a one-day pay period.",
    );
    requireValue(
      Number.isInteger(wps.unpaidLeaveDays) &&
        wps.unpaidLeaveDays >= 0 &&
        wps.unpaidLeaveDays <= days,
      "UAE_SIF_LEAVE_DAYS_INVALID",
      "WPS unpaid-leave days must be whole days within the pay period; review fractional days with the bank.",
    );
    requireValue(
      total([wps.fixedIncome, wps.variableIncome], "WPS net allocation") === snapshot.netPay,
      "UAE_SIF_NET_MISMATCH",
      "The approved WPS fixed and variable allocation must equal net pay; do not export gross earnings as the payable amount.",
    );
    lines.push(
      [
        "EDR",
        employeeId,
        agent,
        account,
        snapshot.periodStart,
        snapshot.periodEnd,
        days,
        sifMoney(wps.fixedIncome),
        sifMoney(wps.variableIncome),
        wps.unpaidLeaveDays,
      ].join(","),
    );
    if (input.includeEvp !== false && (wps.variableIncome > 0 || wps.variableBreakdown)) {
      requireValue(
        wps.variableBreakdown,
        "UAE_SIF_VARIABLE_BREAKDOWN_MISSING",
        "An approved variable-pay breakdown is required for EVP.",
      );
      const components = variableKeys.map((field) =>
        amount(wps.variableBreakdown![field], `Variable pay ${field}`),
      );
      requireValue(
        total(components, "Variable pay") === wps.variableIncome,
        "UAE_SIF_VARIABLE_MISMATCH",
        "The EVP components must equal the net variable amount in EDR.",
      );
      if (wps.variableIncome > 0)
        lines.push(["EVP", employeeId, agent, ...components.map(sifMoney)].join(","));
    }
    amounts.push(snapshot.netPay);
  }
  requireValue(
    amounts.length > 0,
    "UAE_SIF_NO_EMPLOYEES",
    "There are no eligible MoHRE salary records to export.",
  );
  const totalPayment = total(amounts, "SIF total");
  // The guide's six-character field and its sample use MMYYYY (its prose contains MM-YYYY).
  lines.push(
    [
      "SCR",
      employerId,
      routing,
      creationDate,
      creationTime,
      `${key.slice(5)}${input.year}`,
      amounts.length,
      sifMoney(totalPayment),
      "AED",
      reference,
    ].join(","),
  );
  return {
    filename: `${employerId}${stamp}.SIF`,
    content: `${lines.join("\r\n")}\r\n`,
    version: input.version,
    employeeCount: amounts.length,
    totalPayment,
    currency: "AED" as const,
    excluded,
    paymentStatus: "not_confirmed" as const,
  };
}

export interface UaePaymentEvidence {
  reference: string;
  employeeId: string;
  amount: number;
  currency: string;
  status: "confirmed" | "uploaded" | "submitted" | "rejected";
  /** Actual confirmed WPS disbursement date, not file upload date. */
  paidOn?: string;
}

/** Separates full net settlement from the 85% on-time WPS wage-value indicator; no sanctions predicted. */
export function computeUaePaymentSummary(input: {
  items: UaeReportingSnapshot[];
  evidence: UaePaymentEvidence[];
  month: number;
  year: number;
}) {
  monthKey(input.year, input.month);
  const dueDate = new Date(Date.UTC(input.year, input.month, 1)).toISOString().slice(0, 10);
  const employees = new Map<string, { net: number; wages: number; paid: number; onTime: number }>();
  for (const snapshot of input.items) {
    validateSnapshot(snapshot);
    requireValue(
      snapshot.year === input.year && snapshot.month === input.month,
      "UAE_REPORT_PERIOD_INVALID",
      "Payment summary snapshots must match the requested month.",
    );
    if (exclusion(snapshot)) continue;
    requireValue(
      snapshot.wps!.wagesDue != null,
      "UAE_WPS_WAGES_DUE_MISSING",
      "Record the approved wage entitlement excluding non-wage payments before assessing the 85% indicator.",
    );
    requireValue(
      !employees.has(snapshot.employee.id),
      "UAE_SIF_EMPLOYEE_DUPLICATE",
      "Payment summary contains a duplicate employee.",
    );
    employees.set(snapshot.employee.id, {
      net: snapshot.netPay,
      wages: amount(snapshot.wps!.wagesDue!, "WPS wages due"),
      paid: 0,
      onTime: 0,
    });
  }
  const seen = new Set<string>();
  for (const payment of input.evidence) {
    textValue(payment.reference, "Payment evidence reference");
    requireValue(
      !seen.has(payment.reference),
      "UAE_PAYMENT_EVIDENCE_DUPLICATE",
      "Payment evidence references must be unique.",
    );
    seen.add(payment.reference);
    requireValue(
      payment.currency === "AED",
      "UAE_REPORT_CURRENCY_INVALID",
      "Payment evidence must be in AED.",
    );
    amount(payment.amount, "Confirmed payment");
    requireValue(
      ["confirmed", "uploaded", "submitted", "rejected"].includes(payment.status),
      "UAE_REPORT_STATUS_INVALID",
      "Unknown payment evidence status.",
    );
    const employee = employees.get(payment.employeeId);
    if (!employee || payment.status !== "confirmed") continue;
    date(payment.paidOn!, "Confirmed WPS disbursement date");
    employee.paid = total([employee.paid, payment.amount], "Confirmed payments");
    if (payment.paidOn! <= dueDate)
      employee.onTime = total([employee.onTime, payment.amount], "On-time payments");
  }
  const rows = [...employees.values()];
  const netDue = total(
    rows.map((row) => row.net),
    "Net due",
  );
  const wagesDue = total(
    rows.map((row) => row.wages),
    "Wages due",
  );
  const confirmedPaid = total(
    rows.map((row) => row.paid),
    "Confirmed paid",
  );
  // Overpaying one worker must not hide another worker's unpaid entitlement.
  const onTimeWagesPaid = total(
    rows.map((row) => Math.min(row.onTime, row.wages)),
    "On-time wages paid",
  );
  return {
    dueDate,
    employeeCount: rows.length,
    netDue,
    wagesDue,
    confirmedPaid,
    onTimeWagesPaid,
    fullyPaid: rows.length > 0 && rows.every((row) => row.paid >= row.net),
    thresholdReached:
      rows.length > 0 && wagesDue > 0
        ? BigInt(onTimeWagesPaid) * 100n >= BigInt(wagesDue) * 85n
        : null,
    unpaidEmployeeCount: rows.filter((row) => row.paid < row.net).length,
    outstandingNetPay: total(
      rows.map((row) => Math.max(0, row.net - row.paid)),
      "Outstanding net pay",
    ),
  };
}
