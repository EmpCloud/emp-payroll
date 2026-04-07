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

const TEST_ORG_ID = uuidv4(); // org_id char(36)
const TEST_ORG_NUM = 88802; // empcloud_org_id bigint
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

async function seedOrgAndRun(month = 3, year = 2026) {
  const runId = uuidv4();
  await db("payroll_runs").insert({
    id: runId,
    org_id: TEST_ORG_ID,
    empcloud_org_id: TEST_ORG_NUM,
    name: `Run-${month}-${year}-${TEST_TS}`,
    month,
    year,
    pay_date: `${year}-${String(month).padStart(2, "0")}-28`,
    status: "paid",
    total_gross: 200000,
    total_deductions: 30000,
    total_net: 170000,
    employee_count: 4,
  });
  track("payroll_runs", runId);
  return { runId };
}

async function seedEmployee(idx: number) {
  const empId = uuidv4();
  await db("employees").insert({
    id: empId,
    org_id: TEST_ORG_ID,
    first_name: `Rpt${idx}`,
    last_name: `Emp${TEST_TS}`,
    email: `rpt${idx}-${TEST_TS}@test.com`,
    employee_code: `RPT-${TEST_TS}-${idx}`,
    department: "Engineering",
    designation: "Developer",
    date_of_birth: "1995-01-01",
    gender: "male",
    date_of_joining: "2024-01-15",
    is_active: true,
    tax_info: JSON.stringify({ pan: `ABCDE${1234 + idx}F`, regime: "new" }),
    pf_details: JSON.stringify({ uan: `100${idx}00001234`, pfNumber: `MH/BOM/${1000 + idx}` }),
    esi_details: JSON.stringify({ esiNumber: `31-00-${100000 + idx}` }),
    bank_details: JSON.stringify({ accountNumber: "1234567890", ifscCode: "SBIN0001234" }),
  });
  track("employees", empId);
  return empId;
}

async function seedPayslipWithPF(runId: string, empId: string, idx: number, month = 3) {
  const psId = uuidv4();
  const basicAmount = 15000 + idx * 5000;
  await db("payslips").insert({
    id: psId,
    payroll_run_id: runId,
    employee_id: empId,
    empcloud_user_id: 88820 + idx,
    month,
    year: 2026,
    paid_days: 30,
    total_days: 30,
    earnings: JSON.stringify([
      { code: "BASIC", name: "Basic", amount: basicAmount },
      { code: "HRA", name: "HRA", amount: Math.round(basicAmount * 0.4) },
    ]),
    deductions: JSON.stringify([
      { code: "PF", name: "PF", amount: Math.round(basicAmount * 0.12) },
      { code: "ESI", name: "ESI", amount: Math.round(basicAmount * 0.0075) },
      { code: "PT", name: "PT", amount: 200 },
      { code: "TDS", name: "TDS", amount: Math.round(basicAmount * 0.1) },
    ]),
    employer_contributions: JSON.stringify([
      { code: "PF_ER", name: "Employer PF", amount: Math.round(basicAmount * 0.12) },
      { code: "ESI_ER", name: "Employer ESI", amount: Math.round(basicAmount * 0.0325) },
    ]),
    reimbursements: "[]",
    gross_earnings: basicAmount + Math.round(basicAmount * 0.4),
    total_deductions:
      Math.round(basicAmount * 0.12) +
      Math.round(basicAmount * 0.0075) +
      200 +
      Math.round(basicAmount * 0.1),
    net_pay:
      basicAmount +
      Math.round(basicAmount * 0.4) -
      (Math.round(basicAmount * 0.12) +
        Math.round(basicAmount * 0.0075) +
        200 +
        Math.round(basicAmount * 0.1)),
    total_employer_cost:
      basicAmount +
      Math.round(basicAmount * 0.4) +
      Math.round(basicAmount * 0.12) +
      Math.round(basicAmount * 0.0325),
    status: "paid",
  });
  track("payslips", psId);
  return psId;
}

describe.skipIf(!dbAvailable)("PF ECR Report Data", () => {
  it("should extract PF contribution data from payslips", async () => {
    const { runId } = await seedOrgAndRun();
    const emp1 = await seedEmployee(1);
    const emp2 = await seedEmployee(2);
    await seedPayslipWithPF(runId, emp1, 1);
    await seedPayslipWithPF(runId, emp2, 2);
    const payslips = await db("payslips").where({ payroll_run_id: runId }).select("*");
    const ecrData = payslips.map((ps: any) => {
      const deductions =
        typeof ps.deductions === "string" ? JSON.parse(ps.deductions) : ps.deductions;
      const pf = deductions.find((d: any) => d.code === "PF");
      const earnings = typeof ps.earnings === "string" ? JSON.parse(ps.earnings) : ps.earnings;
      const basic = earnings.find((e: any) => e.code === "BASIC");
      return {
        employeeId: ps.employee_id,
        basicWages: basic?.amount || 0,
        pfContribution: pf?.amount || 0,
      };
    });
    expect(ecrData).toHaveLength(2);
    const pfAmounts = ecrData
      .map((e: any) => e.pfContribution)
      .sort((a: number, b: number) => a - b);
    expect(pfAmounts[0]).toBe(Math.round(20000 * 0.12));
    expect(pfAmounts[1]).toBe(Math.round(25000 * 0.12));
  });
  it("should calculate total PF remittance for the month", async () => {
    const { runId } = await seedOrgAndRun(4, 2026);
    for (let i = 1; i <= 3; i++) {
      const emp = await seedEmployee(10 + i);
      await seedPayslipWithPF(runId, emp, 10 + i, 4);
    }
    const payslips = await db("payslips").where({ payroll_run_id: runId });
    let totalPF = 0;
    for (const ps of payslips) {
      const deds = typeof ps.deductions === "string" ? JSON.parse(ps.deductions) : ps.deductions;
      const ec =
        typeof ps.employer_contributions === "string"
          ? JSON.parse(ps.employer_contributions)
          : ps.employer_contributions;
      totalPF +=
        (deds.find((d: any) => d.code === "PF")?.amount || 0) +
        (ec.find((e: any) => e.code === "PF_ER")?.amount || 0);
    }
    expect(totalPF).toBeGreaterThan(0);
  });
});

describe.skipIf(!dbAvailable)("ESI Report Data", () => {
  it("should extract ESI contributions per employee", async () => {
    const { runId } = await seedOrgAndRun(5, 2026);
    const emp = await seedEmployee(20);
    await seedPayslipWithPF(runId, emp, 20, 5);
    const ps = await db("payslips").where({ payroll_run_id: runId }).first();
    const deds = typeof ps.deductions === "string" ? JSON.parse(ps.deductions) : ps.deductions;
    const esi = deds.find((d: any) => d.code === "ESI");
    expect(esi).toBeTruthy();
    expect(esi.amount).toBeGreaterThan(0);
  });
});

describe.skipIf(!dbAvailable)("TDS Report Data", () => {
  it("should extract TDS amounts for quarterly filing", async () => {
    const { runId } = await seedOrgAndRun(6, 2026);
    for (let i = 1; i <= 2; i++) {
      const emp = await seedEmployee(30 + i);
      await seedPayslipWithPF(runId, emp, 30 + i, 6);
    }
    const payslips = await db("payslips").where({ payroll_run_id: runId });
    const tdsData = payslips.map((ps: any) => {
      const deds = typeof ps.deductions === "string" ? JSON.parse(ps.deductions) : ps.deductions;
      return { tdsAmount: deds.find((d: any) => d.code === "TDS")?.amount || 0 };
    });
    expect(tdsData).toHaveLength(2);
    tdsData.forEach((t: any) => expect(t.tdsAmount).toBeGreaterThan(0));
  });
  it("should calculate total TDS liability for the run", async () => {
    const { runId } = await seedOrgAndRun(7, 2026);
    for (let i = 1; i <= 4; i++) {
      const emp = await seedEmployee(40 + i);
      await seedPayslipWithPF(runId, emp, 40 + i, 7);
    }
    const payslips = await db("payslips").where({ payroll_run_id: runId });
    let totalTDS = 0;
    for (const ps of payslips) {
      const deds = typeof ps.deductions === "string" ? JSON.parse(ps.deductions) : ps.deductions;
      totalTDS += deds.find((d: any) => d.code === "TDS")?.amount || 0;
    }
    expect(totalTDS).toBeGreaterThan(0);
  });
});

describe.skipIf(!dbAvailable)("Professional Tax Report Data", () => {
  it("should extract PT amounts per employee", async () => {
    const { runId } = await seedOrgAndRun(8, 2026);
    const emp = await seedEmployee(50);
    await seedPayslipWithPF(runId, emp, 50, 8);
    const ps = await db("payslips").where({ payroll_run_id: runId }).first();
    const deds = typeof ps.deductions === "string" ? JSON.parse(ps.deductions) : ps.deductions;
    const pt = deds.find((d: any) => d.code === "PT");
    expect(pt).toBeTruthy();
    expect(pt.amount).toBe(200);
  });
});

describe.skipIf(!dbAvailable)("Payroll Profile Data", () => {
  it("should store and retrieve employee payroll profile", async () => {
    const profId = uuidv4();
    await db("employee_payroll_profiles").insert({
      id: profId,
      empcloud_user_id: 88870,
      empcloud_org_id: TEST_ORG_NUM,
      employee_code: `PP-${TEST_TS}`,
      bank_details: JSON.stringify({
        bankName: "HDFC",
        accountNumber: "1234567890",
        ifsc: "HDFC0001234",
      }),
      tax_info: JSON.stringify({ pan: "ABCDE1234F", regime: "new" }),
      pf_details: JSON.stringify({ uan: "100100001234" }),
      esi_details: JSON.stringify({ esiNumber: "31-00-100001" }),
      is_active: true,
    });
    track("employee_payroll_profiles", profId);
    const prof = await db("employee_payroll_profiles").where({ id: profId }).first();
    const bank =
      typeof prof.bank_details === "string" ? JSON.parse(prof.bank_details) : prof.bank_details;
    expect(bank.ifsc).toBe("HDFC0001234");
  });
});
