import { getDB } from "../db/adapters";
import { getEmpCloudDB } from "../db/empcloud";
import { AppError } from "../api/middleware/error.middleware";

export class BankFileService {
  private db = getDB();

  async generateBankFile(
    runId: string,
    orgId: string,
  ): Promise<{ filename: string; content: string; format: string }> {
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
    const monthNames = [
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
    const batchRef = `PAY${monthNames[run.month]}${run.year}`;

    // NEFT/RTGS bank transfer format
    const lines: string[] = [];
    lines.push(
      `H,${batchRef},${org?.name || "Company"},${new Date().toISOString().slice(0, 10)},${payslips.data.length},${run.total_net}`,
    );
    lines.push(`ACCOUNT_NO,IFSC,BENEFICIARY_NAME,AMOUNT,EMAIL,EMPLOYEE_CODE,NARRATION`);

    for (const ps of payslips.data) {
      // Look up employee from EmpCloud
      const empcloudUserId = ps.empcloud_user_id;
      if (!empcloudUserId) continue;

      const user = await ecDb("users").where({ id: empcloudUserId }).first();
      if (!user) continue;

      // Get bank details from payroll profile
      const profile = await this.db.findOne<any>("employee_payroll_profiles", {
        empcloud_user_id: empcloudUserId,
      });
      const bank = profile?.bank_details
        ? typeof profile.bank_details === "string"
          ? JSON.parse(profile.bank_details)
          : profile.bank_details
        : {};

      const name = `${user.first_name} ${user.last_name}`;
      const narration = `Salary ${monthNames[run.month]} ${run.year}`;

      lines.push(
        [
          bank.accountNumber || "",
          bank.ifscCode || "",
          name,
          ps.net_pay,
          user.email,
          user.emp_code || "",
          narration,
        ].join(","),
      );
    }

    return {
      filename: `bank-transfer-${batchRef}.csv`,
      content: lines.join("\n"),
      format: "CSV (NEFT/RTGS compatible)",
    };
  }
}
