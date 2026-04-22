import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";

export class GLAccountingService {
  private db = getDB();

  // ---------------------------------------------------------------------------
  // GL Mappings
  // ---------------------------------------------------------------------------

  async listMappings(orgId: string) {
    return this.db.findMany<any>("gl_mappings", {
      filters: { empcloud_org_id: Number(orgId) },
      sort: { field: "pay_component", order: "asc" },
    });
  }

  async createMapping(orgId: string, data: any) {
    const existing = await this.db.findOne<any>("gl_mappings", {
      empcloud_org_id: Number(orgId),
      pay_component: data.payComponent,
    });
    if (existing) {
      throw new AppError(
        409,
        "DUPLICATE_MAPPING",
        `Mapping for "${data.payComponent}" already exists`,
      );
    }
    return this.db.create("gl_mappings", {
      empcloud_org_id: Number(orgId),
      pay_component: data.payComponent,
      gl_account_code: data.glAccountCode,
      gl_account_name: data.glAccountName,
      description: data.description || null,
    });
  }

  async updateMapping(id: string, orgId: string, data: any) {
    const mapping = await this.db.findOne<any>("gl_mappings", {
      id,
      empcloud_org_id: Number(orgId),
    });
    if (!mapping) throw new AppError(404, "NOT_FOUND", "GL mapping not found");

    const updateData: Record<string, any> = {};
    if (data.glAccountCode !== undefined) updateData.gl_account_code = data.glAccountCode;
    if (data.glAccountName !== undefined) updateData.gl_account_name = data.glAccountName;
    if (data.description !== undefined) updateData.description = data.description;
    return this.db.update("gl_mappings", id, updateData);
  }

  async deleteMapping(id: string, orgId: string) {
    const mapping = await this.db.findOne<any>("gl_mappings", {
      id,
      empcloud_org_id: Number(orgId),
    });
    if (!mapping) throw new AppError(404, "NOT_FOUND", "GL mapping not found");
    await this.db.delete("gl_mappings", id);
    return { message: "GL mapping deleted" };
  }

  // ---------------------------------------------------------------------------
  // Journal Entry Generation
  // ---------------------------------------------------------------------------

  async generateJournalEntry(orgId: string, payrollRunId: string) {
    const numOrgId = Number(orgId);

    // Verify payroll run exists
    const run = await this.db.findOne<any>("payroll_runs", {
      id: payrollRunId,
      empcloud_org_id: numOrgId,
    });
    if (!run) throw new AppError(404, "NOT_FOUND", "Payroll run not found");
    if (run.status !== "computed" && run.status !== "approved" && run.status !== "paid") {
      throw new AppError(
        400,
        "INVALID_STATUS",
        "Payroll run must be computed, approved, or paid to generate journal entries",
      );
    }

    // Check for existing journal entry
    const existing = await this.db.findOne<any>("gl_journal_entries", {
      empcloud_org_id: numOrgId,
      payroll_run_id: payrollRunId,
    });
    if (existing) {
      throw new AppError(
        409,
        "ALREADY_EXISTS",
        "Journal entry already exists for this payroll run",
      );
    }

    // Get GL mappings
    const mappingsResult = await this.db.findMany<any>("gl_mappings", {
      filters: { empcloud_org_id: numOrgId },
      limit: 500,
    });
    const mappings: Record<string, any> = {};
    for (const m of mappingsResult.data) {
      mappings[m.pay_component] = m;
    }

    // Get payslips for this run
    const payslipsResult = await this.db.findMany<any>("payslips", {
      filters: { payroll_run_id: payrollRunId },
      limit: 10000,
    });

    // Aggregate amounts by component code
    const aggregated: Record<string, { debit: number; credit: number; type: string }> = {};

    for (const ps of payslipsResult.data) {
      const earnings =
        typeof ps.earnings === "string" ? JSON.parse(ps.earnings) : ps.earnings || [];
      const deductions =
        typeof ps.deductions === "string" ? JSON.parse(ps.deductions) : ps.deductions || [];

      for (const e of earnings) {
        if (!aggregated[e.code]) aggregated[e.code] = { debit: 0, credit: 0, type: "earning" };
        aggregated[e.code].debit += Number(e.amount);
      }

      for (const d of deductions) {
        if (!aggregated[d.code]) aggregated[d.code] = { debit: 0, credit: 0, type: "deduction" };
        aggregated[d.code].credit += Number(d.amount);
      }
    }

    // Net pay goes to salary payable (credit)
    aggregated["NET_PAY"] = {
      debit: 0,
      credit: Number(run.total_net),
      type: "liability",
    };

    // Create journal entry
    let totalDebit = 0;
    let totalCredit = 0;
    const lines: any[] = [];

    for (const [code, amounts] of Object.entries(aggregated)) {
      const mapping = mappings[code];
      const glCode = mapping?.gl_account_code || `UNMAPPED-${code}`;
      const description = mapping?.gl_account_name || code;

      if (amounts.debit > 0) {
        lines.push({
          gl_account_code: glCode,
          description: `${description} - Debit`,
          debit_amount: Math.round(amounts.debit * 100) / 100,
          credit_amount: 0,
        });
        totalDebit += amounts.debit;
      }
      if (amounts.credit > 0) {
        lines.push({
          gl_account_code: glCode,
          description: `${description} - Credit`,
          debit_amount: 0,
          credit_amount: Math.round(amounts.credit * 100) / 100,
        });
        totalCredit += amounts.credit;
      }
    }

    const journal = await this.db.create<any>("gl_journal_entries", {
      empcloud_org_id: numOrgId,
      payroll_run_id: payrollRunId,
      entry_date: new Date().toISOString().split("T")[0],
      total_debit: Math.round(totalDebit * 100) / 100,
      total_credit: Math.round(totalCredit * 100) / 100,
      status: "draft",
    });

    // Create journal lines
    for (const line of lines) {
      await this.db.create("gl_journal_lines", {
        journal_id: journal.id,
        empcloud_org_id: numOrgId,
        ...line,
      });
    }

    return this.getJournalEntry(journal.id, orgId);
  }

  async getJournalEntry(id: string, orgId: string) {
    const journal = await this.db.findOne<any>("gl_journal_entries", {
      id,
      empcloud_org_id: Number(orgId),
    });
    if (!journal) throw new AppError(404, "NOT_FOUND", "Journal entry not found");

    const linesResult = await this.db.findMany<any>("gl_journal_lines", {
      filters: { journal_id: id },
      limit: 1000,
    });

    return { ...journal, lines: linesResult.data };
  }

  async listJournalEntries(orgId: string) {
    return this.db.findMany<any>("gl_journal_entries", {
      filters: { empcloud_org_id: Number(orgId) },
      sort: { field: "entry_date", order: "desc" },
    });
  }

  async updateJournalStatus(id: string, orgId: string, status: string) {
    const journal = await this.db.findOne<any>("gl_journal_entries", {
      id,
      empcloud_org_id: Number(orgId),
    });
    if (!journal) throw new AppError(404, "NOT_FOUND", "Journal entry not found");

    const updateData: Record<string, any> = { status };
    if (status === "exported") {
      updateData.exported_at = new Date();
    }
    return this.db.update("gl_journal_entries", id, updateData);
  }

  // ---------------------------------------------------------------------------
  // Export Formats
  // ---------------------------------------------------------------------------

  async exportTallyFormat(
    id: string,
    orgId: string,
  ): Promise<{ filename: string; content: string }> {
    const journal = await this.getJournalEntry(id, orgId);
    // #175 — knex/mysql2 returns DATE columns as Date objects, so calling
    // `.replace(/-/g, "")` directly on journal.entry_date threw
    // `TypeError: entry_date.replace is not a function` the moment a user
    // clicked "Tally" on any journal row. The window.open'd tab surfaced it
    // as an error page. Normalize once up front so both the filename and the
    // <DATE> tag always see an ISO YYYY-MM-DD string.
    const dateIso = toIsoDateString(journal.entry_date);

    // Tally XML format
    const lines = journal.lines || [];
    const xmlLines = lines.map((l: any) => {
      if (Number(l.debit_amount) > 0) {
        return `    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${escapeXml(l.gl_account_code)} - ${escapeXml(l.description)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>-${l.debit_amount}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>`;
      } else {
        return `    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${escapeXml(l.gl_account_code)} - ${escapeXml(l.description)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>${l.credit_amount}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>`;
      }
    });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE>
          <VOUCHER VCHTYPE="Journal" ACTION="Create">
            <DATE>${dateIso.replace(/-/g, "")}</DATE>
            <NARRATION>Payroll Journal Entry - ${dateIso}</NARRATION>
${xmlLines.join("\n")}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

    await this.db.update("gl_journal_entries", id, {
      status: "exported",
      export_format: "tally",
      exported_at: new Date(),
    });

    return {
      filename: `tally-journal-${dateIso}.xml`,
      content: xml,
    };
  }

  async exportQuickBooksFormat(
    id: string,
    orgId: string,
  ): Promise<{ filename: string; content: string }> {
    const journal = await this.getJournalEntry(id, orgId);
    const dateIso = toIsoDateString(journal.entry_date);
    const lines = journal.lines || [];

    // QuickBooks CSV format
    const headers = ["Date", "Account", "Description", "Debit", "Credit"];
    const rows = [headers.join(",")];

    for (const line of lines) {
      rows.push(
        [
          `"${dateIso}"`,
          `"${line.gl_account_code}"`,
          `"${(line.description || "").replace(/"/g, '""')}"`,
          Number(line.debit_amount) > 0 ? line.debit_amount : "",
          Number(line.credit_amount) > 0 ? line.credit_amount : "",
        ].join(","),
      );
    }

    await this.db.update("gl_journal_entries", id, {
      status: "exported",
      export_format: "quickbooks",
      exported_at: new Date(),
    });

    return {
      filename: `quickbooks-journal-${dateIso}.csv`,
      content: rows.join("\n"),
    };
  }

  async exportZohoFormat(
    id: string,
    orgId: string,
  ): Promise<{ filename: string; content: string }> {
    const journal = await this.getJournalEntry(id, orgId);
    const dateIso = toIsoDateString(journal.entry_date);
    const lines = journal.lines || [];

    // Zoho Books JSON format
    const zohoData = {
      journal_date: dateIso,
      reference_number: `PAYROLL-${journal.payroll_run_id.slice(0, 8)}`,
      notes: `Payroll Journal Entry - ${dateIso}`,
      line_items: lines.map((l: any) => ({
        account_name: l.gl_account_code,
        description: l.description,
        debit_or_credit: Number(l.debit_amount) > 0 ? "debit" : "credit",
        amount: Number(l.debit_amount) > 0 ? Number(l.debit_amount) : Number(l.credit_amount),
      })),
    };

    await this.db.update("gl_journal_entries", id, {
      status: "exported",
      export_format: "zoho",
      exported_at: new Date(),
    });

    return {
      filename: `zoho-journal-${dateIso}.json`,
      content: JSON.stringify(zohoData, null, 2),
    };
  }
}

function escapeXml(str: string): string {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toIsoDateString(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? "").slice(0, 10);
}
