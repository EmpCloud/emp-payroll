import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";

/**
 * Export payroll data in formats compatible with accounting software.
 * Supports: Tally XML, QuickBooks IIF, Generic CSV Journal Entry.
 */
export class AccountingExportService {
  private db = getDB();

  /**
   * Export payroll journal entries as CSV (universal format).
   * Can be imported into Tally, QuickBooks, Zoho Books, etc.
   */
  async exportJournalCSV(runId: string, orgId: string): Promise<{ filename: string; content: string }> {
    const { run, payslips, org } = await this.getRunData(runId, orgId);
    const period = `${run.month}-${run.year}`;

    const rows: string[] = [
      "Date,Voucher Type,Voucher No,Ledger,Debit,Credit,Narration",
    ];

    const voucherNo = `SAL/${period}/${run.id.slice(0, 6)}`;
    const date = run.pay_date || `${run.year}-${String(run.month).padStart(2, "0")}-28`;

    // Salary expense (debit)
    rows.push(`${date},Journal,${voucherNo},Salaries & Wages,${Number(run.total_gross).toFixed(2)},0,Salary for ${period}`);

    // Deductions (credit to liability accounts)
    let totalPF = 0;
    let totalESI = 0;
    let totalPT = 0;
    let totalTDS = 0;

    for (const ps of payslips) {
      const deds = typeof ps.deductions === "string" ? JSON.parse(ps.deductions) : ps.deductions || [];
      for (const d of deds) {
        if (d.code === "EPF") totalPF += d.amount;
        else if (d.code === "ESI" || d.code === "ESI_EMPLOYEE") totalESI += d.amount;
        else if (d.code === "PT") totalPT += d.amount;
        else if (d.code === "TDS" || d.code === "INCOME_TAX") totalTDS += d.amount;
      }
    }

    if (totalPF > 0) rows.push(`${date},Journal,${voucherNo},PF Payable,0,${totalPF.toFixed(2)},EPF deduction ${period}`);
    if (totalESI > 0) rows.push(`${date},Journal,${voucherNo},ESI Payable,0,${totalESI.toFixed(2)},ESI deduction ${period}`);
    if (totalPT > 0) rows.push(`${date},Journal,${voucherNo},PT Payable,0,${totalPT.toFixed(2)},PT deduction ${period}`);
    if (totalTDS > 0) rows.push(`${date},Journal,${voucherNo},TDS Payable,0,${totalTDS.toFixed(2)},TDS deduction ${period}`);

    // Net pay (credit to bank)
    rows.push(`${date},Journal,${voucherNo},Bank Account,0,${Number(run.total_net).toFixed(2)},Net salary payment ${period}`);

    // Employer contributions (debit to expense, credit to liability)
    const empContrib = Number(run.total_employer_contributions || 0);
    if (empContrib > 0) {
      rows.push(`${date},Journal,${voucherNo},Employer PF/ESI Expense,${empContrib.toFixed(2)},0,Employer contributions ${period}`);
      rows.push(`${date},Journal,${voucherNo},PF/ESI Payable (Employer),0,${empContrib.toFixed(2)},Employer contributions ${period}`);
    }

    return {
      filename: `journal-entries-${period}.csv`,
      content: rows.join("\n"),
    };
  }

  /**
   * Export in Tally-compatible XML format.
   */
  async exportTallyXML(runId: string, orgId: string): Promise<{ filename: string; content: string }> {
    const { run, org } = await this.getRunData(runId, orgId);
    const period = `${run.month}-${run.year}`;
    const date = `${run.year}${String(run.month).padStart(2, "0")}28`;

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Journal" ACTION="Create">
            <DATE>${date}</DATE>
            <NARRATION>Salary for ${period} - ${org?.name || "Company"}</NARRATION>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Salaries and Wages</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>-${Number(run.total_gross).toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Bank Account</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${Number(run.total_net).toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>PF Payable</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${Number(run.total_deductions).toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

    return { filename: `tally-import-${period}.xml`, content: xml };
  }

  private async getRunData(runId: string, orgId: string) {
    const run = await this.db.findOne<any>("payroll_runs", { id: runId, org_id: orgId });
    if (!run) throw new AppError(404, "NOT_FOUND", "Payroll run not found");
    const payslipsResult = await this.db.findMany<any>("payslips", {
      filters: { payroll_run_id: runId }, limit: 10000,
    });
    const org = await this.db.findById<any>("organizations", orgId);
    return { run, payslips: payslipsResult.data, org };
  }
}
