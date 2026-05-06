import { getDB } from "../db/adapters";
import { getEmpCloudDB } from "../db/empcloud";
import { AppError } from "../api/middleware/error.middleware";

const MONTH_ABBR = [
  "",
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

const MONTH_FULL = [
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

/**
 * RFC-4180 CSV escaping. Fields containing commas, double-quotes, or
 * newlines are wrapped in double quotes; embedded quotes are doubled.
 * The previous implementation joined values with `,` directly, so any
 * employee name with a comma (e.g. "Rao, Suresh") or address-style
 * narration broke the file. Banks reject malformed rows silently.
 */
function csvEscape(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(fields: unknown[]): string {
  return fields.map(csvEscape).join(",");
}

/**
 * IFSC: 4 alpha + 1 zero + 6 alphanumeric. Indian banks reject malformed
 * codes outright, so it's better to skip the row in the file and surface
 * the offender in the warning list than ship a doomed batch.
 */
function isValidIfsc(value: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(value);
}

/** Account numbers vary in length (9-18 digits); reject obvious junk. */
function isValidAccount(value: string): boolean {
  return /^\d{9,18}$/.test(value);
}

function formatAmount(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0.00";
  return v.toFixed(2);
}

export class BankFileService {
  private db = getDB();

  async generateBankFile(
    runId: string,
    orgId: string,
  ): Promise<{
    filename: string;
    content: string;
    format: string;
    summary: {
      totalEmployees: number;
      totalAmount: number;
      skipped: Array<{ employeeCode?: string; name?: string; reason: string }>;
    };
  }> {
    const run = await this.db.findOne<any>("payroll_runs", {
      id: runId,
      empcloud_org_id: Number(orgId),
    });
    if (!run) throw new AppError(404, "NOT_FOUND", "Payroll run not found");
    if (run.status !== "approved" && run.status !== "paid") {
      throw new AppError(
        400,
        "INVALID_STATUS",
        "Bank file can only be generated for approved/paid runs",
      );
    }

    const payslips = await this.db.findMany<any>("payslips", {
      filters: { payroll_run_id: runId },
      limit: 10000,
    });

    const ecDb = getEmpCloudDB();
    const org = await ecDb("organizations")
      .where({ id: Number(orgId) })
      .first();
    const batchRef = `PAY${MONTH_ABBR[run.month]}${run.year}`;
    const valueDate = (() => {
      // Bank value-date column wants DD-MM-YYYY (the NEFT bulk upload
      // template most Indian banks accept). Use the run's pay_date if
      // present, otherwise fall back to today.
      const d = run.pay_date ? new Date(run.pay_date) : new Date();
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      return `${dd}-${mm}-${d.getFullYear()}`;
    })();
    const narration = `SAL-${MONTH_FULL[run.month]}-${run.year}`.slice(0, 30);

    // NEFT bulk-transfer column header. Order chosen to match the
    // template HDFC / ICICI / Axis bulk-upload portals accept; column
    // names use the names those portals use so HR can paste the file
    // straight in. Columns:
    //   Sr No | Transaction Type | Beneficiary Name | Beneficiary Account
    //   IFSC | Amount | Value Date | Beneficiary Email | Beneficiary Code
    //   Remarks
    const headers = [
      "Sr No",
      "Transaction Type",
      "Beneficiary Name",
      "Beneficiary Account",
      "IFSC",
      "Amount",
      "Value Date",
      "Beneficiary Email",
      "Beneficiary Code",
      "Remarks",
    ];
    const lines: string[] = [csvRow(headers)];
    const skipped: Array<{ employeeCode?: string; name?: string; reason: string }> = [];
    let totalEmployees = 0;
    let totalAmount = 0;
    let serial = 0;

    for (const ps of payslips.data) {
      const empcloudUserId = ps.empcloud_user_id;
      if (!empcloudUserId) continue;

      const user = await ecDb("users").where({ id: empcloudUserId }).first();
      if (!user) continue;

      const profile = await this.db.findOne<any>("employee_payroll_profiles", {
        empcloud_user_id: empcloudUserId,
      });
      const bank = profile?.bank_details
        ? typeof profile.bank_details === "string"
          ? JSON.parse(profile.bank_details)
          : profile.bank_details
        : {};

      const name = `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.email;
      const code = user.emp_code || "";
      const account = String(bank.accountNumber || "").trim();
      const ifsc = String(bank.ifscCode || "")
        .trim()
        .toUpperCase();
      const netPay = Number(ps.net_pay);

      // Validate before emitting. The bank will reject the entire batch
      // on the first malformed row in some upload formats, so it's better
      // to skip individual bad rows here and surface them in the response
      // summary so HR can fix the bank details and re-download.
      if (!account) {
        skipped.push({ employeeCode: code, name, reason: "Missing bank account number" });
        continue;
      }
      if (!isValidAccount(account)) {
        skipped.push({
          employeeCode: code,
          name,
          reason: `Invalid account number "${account}" (must be 9-18 digits)`,
        });
        continue;
      }
      if (!ifsc) {
        skipped.push({ employeeCode: code, name, reason: "Missing IFSC code" });
        continue;
      }
      if (!isValidIfsc(ifsc)) {
        skipped.push({
          employeeCode: code,
          name,
          reason: `Invalid IFSC "${ifsc}" (must match AAAA0XXXXXX)`,
        });
        continue;
      }
      if (!Number.isFinite(netPay) || netPay <= 0) {
        skipped.push({
          employeeCode: code,
          name,
          reason: `Net pay is zero or invalid (${ps.net_pay})`,
        });
        continue;
      }

      serial++;
      totalEmployees++;
      totalAmount += netPay;

      // Transaction type: NEFT for amounts < ₹2L, RTGS for ≥ ₹2L. Most
      // bulk-upload portals accept either column value; this matches
      // RBI's NEFT/RTGS threshold so the file is upload-ready as-is.
      const txnType = netPay >= 200000 ? "RTGS" : "NEFT";

      lines.push(
        csvRow([
          serial,
          txnType,
          name,
          account,
          ifsc,
          formatAmount(netPay),
          valueDate,
          user.email || "",
          code,
          narration,
        ]),
      );
    }

    return {
      filename: `bank-transfer-${batchRef}-${totalEmployees}emp.csv`,
      content: lines.join("\r\n"), // CRLF — RFC-4180 line ending banks expect
      format: "CSV — NEFT/RTGS bulk upload (HDFC / ICICI / Axis compatible)",
      summary: {
        totalEmployees,
        totalAmount,
        skipped,
      },
    };
  }
}
