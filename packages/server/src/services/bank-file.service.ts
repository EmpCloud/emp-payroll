import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";

export class BankFileService {
  private db = getDB();

  async generateBankFile(runId: string, orgId: string): Promise<{ filename: string; content: string; format: string }> {
    const run = await this.db.findOne<any>("payroll_runs", { id: runId, org_id: orgId });
    if (!run) throw new AppError(404, "NOT_FOUND", "Payroll run not found");
    if (run.status !== "approved" && run.status !== "paid") {
      throw new AppError(400, "INVALID_STATUS", "Bank file can only be generated for approved/paid runs");
    }

    const payslips = await this.db.findMany<any>("payslips", {
      filters: { payroll_run_id: runId },
      limit: 10000,
    });

    const org = await this.db.findById<any>("organizations", orgId);
    const monthNames = ["", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const batchRef = `PAY${monthNames[run.month]}${run.year}`;

    // NEFT/RTGS bank transfer format
    const lines: string[] = [];
    lines.push(`H,${batchRef},${org?.name || "Company"},${new Date().toISOString().slice(0, 10)},${payslips.data.length},${run.total_net}`);
    lines.push(`ACCOUNT_NO,IFSC,BENEFICIARY_NAME,AMOUNT,EMAIL,EMPLOYEE_CODE,NARRATION`);

    for (const ps of payslips.data) {
      const emp = await this.db.findById<any>("employees", ps.employee_id);
      if (!emp) continue;

      const bank = typeof emp.bank_details === "string" ? JSON.parse(emp.bank_details) : emp.bank_details || {};
      const name = `${emp.first_name} ${emp.last_name}`;
      const narration = `Salary ${monthNames[run.month]} ${run.year}`;

      lines.push([
        bank.accountNumber || "",
        bank.ifscCode || "",
        name,
        ps.net_pay,
        emp.email,
        emp.employee_code,
        narration,
      ].join(","));
    }

    return {
      filename: `bank-transfer-${batchRef}.csv`,
      content: lines.join("\n"),
      format: "CSV (NEFT/RTGS compatible)",
    };
  }
}
