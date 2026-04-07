import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import knex, { Knex } from "knex";
import { v4 as uuidv4 } from "uuid";

let db: Knex;
let dbAvailable = false;
try {
  const probe = knex({
    client: "mysql2",
    connection: {
      host: "localhost",
      port: 3306,
      user: "empcloud",
      password: "EmpCloud2026",
      database: "emp_payroll",
    },
    pool: { min: 0, max: 1 },
  });
  await probe.raw("SELECT 1");
  await probe.destroy();
  dbAvailable = true;
} catch {
  /* MySQL not available */
}

const TEST_ORG_ID = uuidv4();
const TEST_ORG = 88803;
const TEST_TS = Date.now();
const cleanupIds: { table: string; id: string }[] = [];
function track(table: string, id: string) {
  cleanupIds.push({ table, id });
}

beforeAll(async () => {
  if (!dbAvailable) return;
  db = knex({
    client: "mysql2",
    connection: {
      host: "localhost",
      port: 3306,
      user: "empcloud",
      password: "EmpCloud2026",
      database: "emp_payroll",
    },
    pool: { min: 1, max: 5 },
  });
  await db.raw("SELECT 1");
});
afterEach(async () => {
  if (!dbAvailable) return;
  for (const item of [...cleanupIds].reverse()) {
    try {
      await db(item.table).where({ id: item.id }).del();
    } catch {}
  }
  cleanupIds.length = 0;
});
afterAll(async () => {
  if (!dbAvailable) return;
  await db.destroy();
});

describe.skipIf(!dbAvailable)("GL Mappings CRUD", () => {
  it("should create a GL mapping", async () => {
    const id = uuidv4();
    await db("gl_mappings").insert({
      id,
      empcloud_org_id: TEST_ORG,
      pay_component: "BASIC",
      gl_account_code: "4100",
      gl_account_name: "Salary Expense",
      description: "Basic salary GL",
    });
    track("gl_mappings", id);
    const m = await db("gl_mappings").where({ id }).first();
    expect(m.pay_component).toBe("BASIC");
    expect(m.gl_account_code).toBe("4100");
  });
  it("should list GL mappings for an org", async () => {
    const ids: string[] = [];
    for (const comp of ["BASIC_L", "HRA_L", "PF_L"]) {
      const id = uuidv4();
      await db("gl_mappings").insert({
        id,
        empcloud_org_id: TEST_ORG,
        pay_component: comp,
        gl_account_code: `41${ids.length}0`,
        gl_account_name: `${comp} Account`,
      });
      track("gl_mappings", id);
      ids.push(id);
    }
    const mappings = await db("gl_mappings")
      .where({ empcloud_org_id: TEST_ORG })
      .whereIn("id", ids);
    expect(mappings.length).toBe(3);
  });
  it("should update a GL mapping", async () => {
    const id = uuidv4();
    await db("gl_mappings").insert({
      id,
      empcloud_org_id: TEST_ORG,
      pay_component: "HRA_UPD",
      gl_account_code: "4200",
      gl_account_name: "Old Name",
    });
    track("gl_mappings", id);
    await db("gl_mappings")
      .where({ id })
      .update({ gl_account_name: "HRA Expense - Updated", description: "Updated desc" });
    const m = await db("gl_mappings").where({ id }).first();
    expect(m.gl_account_name).toBe("HRA Expense - Updated");
  });
  it("should delete a GL mapping", async () => {
    const id = uuidv4();
    await db("gl_mappings").insert({
      id,
      empcloud_org_id: TEST_ORG,
      pay_component: "DEL_COMP",
      gl_account_code: "4999",
      gl_account_name: "To Delete",
    });
    await db("gl_mappings").where({ id }).del();
    const m = await db("gl_mappings").where({ id }).first();
    expect(m).toBeUndefined();
  });
});

describe.skipIf(!dbAvailable)("GL Journal Entries", () => {
  it("should create a journal entry with lines", async () => {
    const runId = uuidv4();
    await db("payroll_runs").insert({
      id: runId,
      org_id: TEST_ORG_ID,
      empcloud_org_id: TEST_ORG,
      name: "GL-Run",
      month: 3,
      year: 2026,
      pay_date: "2026-03-28",
      status: "computed",
      total_gross: 100000,
      total_deductions: 15000,
      total_net: 85000,
      employee_count: 2,
    });
    track("payroll_runs", runId);
    const jeId = uuidv4();
    await db("gl_journal_entries").insert({
      id: jeId,
      empcloud_org_id: TEST_ORG,
      payroll_run_id: runId,
      entry_date: "2026-03-31",
      total_debit: 100000,
      total_credit: 100000,
      status: "draft",
    });
    track("gl_journal_entries", jeId);
    const lines = [
      {
        id: uuidv4(),
        journal_id: jeId,
        empcloud_org_id: TEST_ORG,
        gl_account_code: "4100",
        description: "Salary Expense - Debit",
        debit_amount: 85000,
        credit_amount: 0,
      },
      {
        id: uuidv4(),
        journal_id: jeId,
        empcloud_org_id: TEST_ORG,
        gl_account_code: "4200",
        description: "PF Expense - Debit",
        debit_amount: 15000,
        credit_amount: 0,
      },
      {
        id: uuidv4(),
        journal_id: jeId,
        empcloud_org_id: TEST_ORG,
        gl_account_code: "2100",
        description: "Salary Payable - Credit",
        debit_amount: 0,
        credit_amount: 85000,
      },
      {
        id: uuidv4(),
        journal_id: jeId,
        empcloud_org_id: TEST_ORG,
        gl_account_code: "2200",
        description: "PF Payable - Credit",
        debit_amount: 0,
        credit_amount: 15000,
      },
    ];
    for (const line of lines) {
      await db("gl_journal_lines").insert(line);
      track("gl_journal_lines", line.id);
    }
    const dbLines = await db("gl_journal_lines").where({ journal_id: jeId });
    expect(dbLines).toHaveLength(4);
    const totalDebit = dbLines.reduce((s: number, l: any) => s + Number(l.debit_amount), 0);
    const totalCredit = dbLines.reduce((s: number, l: any) => s + Number(l.credit_amount), 0);
    expect(totalDebit).toBe(totalCredit);
  });
  it("should update journal status to exported", async () => {
    const runId = uuidv4();
    await db("payroll_runs").insert({
      id: runId,
      org_id: TEST_ORG_ID,
      empcloud_org_id: TEST_ORG,
      name: "GL-Run2",
      month: 4,
      year: 2026,
      pay_date: "2026-04-28",
      status: "paid",
      total_gross: 50000,
      total_deductions: 5000,
      total_net: 45000,
      employee_count: 1,
    });
    track("payroll_runs", runId);
    const jeId = uuidv4();
    await db("gl_journal_entries").insert({
      id: jeId,
      empcloud_org_id: TEST_ORG,
      payroll_run_id: runId,
      entry_date: "2026-04-30",
      total_debit: 50000,
      total_credit: 50000,
      status: "draft",
    });
    track("gl_journal_entries", jeId);
    await db("gl_journal_entries")
      .where({ id: jeId })
      .update({ status: "exported", exported_at: new Date(), export_format: "tally" });
    const je = await db("gl_journal_entries").where({ id: jeId }).first();
    expect(je.status).toBe("exported");
    expect(je.export_format).toBe("tally");
  });
  it("should list journal entries for an org", async () => {
    const ids: string[] = [];
    for (let m = 1; m <= 3; m++) {
      const runId = uuidv4();
      await db("payroll_runs").insert({
        id: runId,
        org_id: TEST_ORG_ID,
        empcloud_org_id: TEST_ORG,
        name: `List-Run-${m}`,
        month: m,
        year: 2026,
        pay_date: `2026-0${m}-28`,
        status: "paid",
        total_gross: 50000,
        total_deductions: 5000,
        total_net: 45000,
        employee_count: 1,
      });
      track("payroll_runs", runId);
      const jeId = uuidv4();
      await db("gl_journal_entries").insert({
        id: jeId,
        empcloud_org_id: TEST_ORG,
        payroll_run_id: runId,
        entry_date: `2026-0${m}-28`,
        total_debit: 50000,
        total_credit: 50000,
        status: "draft",
      });
      track("gl_journal_entries", jeId);
      ids.push(jeId);
    }
    const entries = await db("gl_journal_entries")
      .where({ empcloud_org_id: TEST_ORG })
      .whereIn("id", ids);
    expect(entries.length).toBe(3);
  });
  it("should enforce debit = credit balance", async () => {
    const runId = uuidv4();
    await db("payroll_runs").insert({
      id: runId,
      org_id: TEST_ORG_ID,
      empcloud_org_id: TEST_ORG,
      name: "Balanced-Run",
      month: 5,
      year: 2026,
      pay_date: "2026-05-28",
      status: "computed",
      total_gross: 80000,
      total_deductions: 10000,
      total_net: 70000,
      employee_count: 1,
    });
    track("payroll_runs", runId);
    const jeId = uuidv4();
    await db("gl_journal_entries").insert({
      id: jeId,
      empcloud_org_id: TEST_ORG,
      payroll_run_id: runId,
      entry_date: "2026-05-31",
      total_debit: 80000,
      total_credit: 80000,
      status: "draft",
    });
    track("gl_journal_entries", jeId);
    const l1 = uuidv4(),
      l2 = uuidv4();
    await db("gl_journal_lines").insert({
      id: l1,
      journal_id: jeId,
      empcloud_org_id: TEST_ORG,
      gl_account_code: "4100",
      description: "Debit",
      debit_amount: 80000,
      credit_amount: 0,
    });
    await db("gl_journal_lines").insert({
      id: l2,
      journal_id: jeId,
      empcloud_org_id: TEST_ORG,
      gl_account_code: "2100",
      description: "Credit",
      debit_amount: 0,
      credit_amount: 80000,
    });
    track("gl_journal_lines", l1);
    track("gl_journal_lines", l2);
    const lines = await db("gl_journal_lines").where({ journal_id: jeId });
    const debitSum = lines.reduce((s: number, l: any) => s + Number(l.debit_amount), 0);
    const creditSum = lines.reduce((s: number, l: any) => s + Number(l.credit_amount), 0);
    expect(debitSum).toBe(creditSum);
  });
});

describe.skipIf(!dbAvailable)("GL Export Formats", () => {
  it("should support tally export format metadata", async () => {
    const runId = uuidv4();
    await db("payroll_runs").insert({
      id: runId,
      org_id: TEST_ORG_ID,
      empcloud_org_id: TEST_ORG,
      name: "Tally-Export",
      month: 6,
      year: 2026,
      pay_date: "2026-06-28",
      status: "paid",
      total_gross: 100000,
      total_deductions: 15000,
      total_net: 85000,
      employee_count: 2,
    });
    track("payroll_runs", runId);
    const jeId = uuidv4();
    await db("gl_journal_entries").insert({
      id: jeId,
      empcloud_org_id: TEST_ORG,
      payroll_run_id: runId,
      entry_date: "2026-06-30",
      total_debit: 100000,
      total_credit: 100000,
      status: "draft",
    });
    track("gl_journal_entries", jeId);
    await db("gl_journal_entries")
      .where({ id: jeId })
      .update({ status: "exported", export_format: "tally", exported_at: new Date() });
    const je = await db("gl_journal_entries").where({ id: jeId }).first();
    expect(je.export_format).toBe("tally");
  });
  it("should support quickbooks export format", async () => {
    const runId = uuidv4();
    await db("payroll_runs").insert({
      id: runId,
      org_id: TEST_ORG_ID,
      empcloud_org_id: TEST_ORG,
      name: "QB-Export",
      month: 7,
      year: 2026,
      pay_date: "2026-07-28",
      status: "paid",
      total_gross: 60000,
      total_deductions: 8000,
      total_net: 52000,
      employee_count: 1,
    });
    track("payroll_runs", runId);
    const jeId = uuidv4();
    await db("gl_journal_entries").insert({
      id: jeId,
      empcloud_org_id: TEST_ORG,
      payroll_run_id: runId,
      entry_date: "2026-07-31",
      total_debit: 60000,
      total_credit: 60000,
      status: "draft",
    });
    track("gl_journal_entries", jeId);
    await db("gl_journal_entries")
      .where({ id: jeId })
      .update({ status: "exported", export_format: "quickbooks", exported_at: new Date() });
    const je = await db("gl_journal_entries").where({ id: jeId }).first();
    expect(je.export_format).toBe("quickbooks");
  });
  it("should support zoho export format", async () => {
    const runId = uuidv4();
    await db("payroll_runs").insert({
      id: runId,
      org_id: TEST_ORG_ID,
      empcloud_org_id: TEST_ORG,
      name: "Zoho-Export",
      month: 8,
      year: 2026,
      pay_date: "2026-08-28",
      status: "paid",
      total_gross: 75000,
      total_deductions: 10000,
      total_net: 65000,
      employee_count: 1,
    });
    track("payroll_runs", runId);
    const jeId = uuidv4();
    await db("gl_journal_entries").insert({
      id: jeId,
      empcloud_org_id: TEST_ORG,
      payroll_run_id: runId,
      entry_date: "2026-08-31",
      total_debit: 75000,
      total_credit: 75000,
      status: "draft",
    });
    track("gl_journal_entries", jeId);
    await db("gl_journal_entries")
      .where({ id: jeId })
      .update({ status: "exported", export_format: "zoho", exported_at: new Date() });
    const je = await db("gl_journal_entries").where({ id: jeId }).first();
    expect(je.export_format).toBe("zoho");
  });
});
