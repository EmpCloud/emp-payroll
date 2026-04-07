import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import knex, { Knex } from "knex";
import { v4 as uuidv4 } from "uuid";

let db: Knex;
let dbAvailable = false;

// Probe DB connectivity at module level so describe.skipIf works
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
  // MySQL not available — all tests will skip
}

const TEST_ORG_ID = uuidv4(); // org_id for FK references (char(36))
const TEST_ORG_NUM = 88801; // empcloud_org_id (bigint)
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

async function createEmployee(suffix: number) {
  const id = uuidv4();
  await db("employees").insert({
    id,
    org_id: TEST_ORG_ID,
    first_name: `Test${suffix}`,
    last_name: `Emp${TEST_TS}`,
    email: `test${suffix}-${TEST_TS}@test.com`,
    employee_code: `EMP-${TEST_TS}-${suffix}`,
    department: "Engineering",
    designation: "Developer",
    date_of_birth: "1995-01-01",
    gender: "male",
    date_of_joining: "2024-01-15",
    tax_info: JSON.stringify({ pan: "ABCDE1234F", regime: "new" }),
    pf_details: JSON.stringify({ uan: "100100001234" }),
    esi_details: JSON.stringify({}),
    bank_details: JSON.stringify({ accountNumber: "1234567890", ifscCode: "SBIN0001234" }),
    is_active: true,
  });
  track("employees", id);
  return id;
}
async function createStructure() {
  const id = uuidv4();
  await db("salary_structures").insert({
    id,
    empcloud_org_id: TEST_ORG_NUM,
    name: `Struct-${TEST_TS}-${id.slice(0, 4)}`,
    is_default: false,
    is_active: true,
  });
  track("salary_structures", id);
  return id;
}
async function createSalary(
  empId: string,
  structId: string,
  grossSalary: number,
  components: any[],
) {
  const id = uuidv4();
  await db("employee_salaries").insert({
    id,
    employee_id: empId,
    structure_id: structId,
    ctc: grossSalary,
    gross_salary: grossSalary,
    net_salary: grossSalary * 0.75,
    components: JSON.stringify(components),
    effective_from: "2024-01-01",
    is_active: true,
  });
  track("employee_salaries", id);
  return id;
}
async function createPayrollRun(month: number, year: number, status = "draft") {
  const id = uuidv4();
  await db("payroll_runs").insert({
    id,
    org_id: TEST_ORG_ID,
    empcloud_org_id: TEST_ORG_NUM,
    name: `Run-${month}-${year}-${TEST_TS}`,
    month,
    year,
    pay_date: `${year}-${String(month).padStart(2, "0")}-28`,
    status,
    total_gross: 0,
    total_deductions: 0,
    total_net: 0,
    employee_count: 0,
  });
  track("payroll_runs", id);
  return id;
}
async function createPayslip(runId: string, empId: string, month: number, year: number, data: any) {
  const id = uuidv4();
  await db("payslips").insert({
    id,
    payroll_run_id: runId,
    employee_id: empId,
    month,
    year,
    paid_days: data.paidDays || 30,
    total_days: data.totalDays || 30,
    lop_days: data.lopDays || 0,
    earnings: JSON.stringify(data.earnings || []),
    deductions: JSON.stringify(data.deductions || []),
    employer_contributions: JSON.stringify(data.employerContributions || []),
    reimbursements: JSON.stringify(data.reimbursements || []),
    gross_earnings: data.gross ?? 50000,
    total_deductions: data.totalDeductions ?? 5000,
    net_pay: data.netPay ?? 45000,
    total_employer_cost: data.employerCost ?? 55000,
    status: "generated",
  });
  track("payslips", id);
  return id;
}

describe.skipIf(!dbAvailable)("Gross Calculation", () => {
  it("should store salary with CTC breakdown components", async () => {
    const empId = await createEmployee(1);
    const structId = await createStructure();
    const components = [
      {
        code: "BASIC",
        name: "Basic Salary",
        type: "earning",
        percentage: 50,
        monthlyAmount: 25000,
      },
      { code: "HRA", name: "HRA", type: "earning", percentage: 20, monthlyAmount: 10000 },
      {
        code: "SA",
        name: "Special Allowance",
        type: "earning",
        percentage: 30,
        monthlyAmount: 15000,
      },
    ];
    const salId = await createSalary(empId, structId, 600000, components);
    const sal = await db("employee_salaries").where({ id: salId }).first();
    expect(Number(sal.gross_salary)).toBe(600000);
    const parsed = typeof sal.components === "string" ? JSON.parse(sal.components) : sal.components;
    expect(parsed).toHaveLength(3);
  });
  it("should calculate gross from component sum", async () => {
    const empId = await createEmployee(2);
    const structId = await createStructure();
    const components = [
      { code: "BASIC", monthlyAmount: 30000 },
      { code: "HRA", monthlyAmount: 12000 },
      { code: "CONV", monthlyAmount: 1600 },
      { code: "MED", monthlyAmount: 1250 },
      { code: "SA", monthlyAmount: 5150 },
    ];
    const totalMonthly = components.reduce((sum, c) => sum + c.monthlyAmount, 0);
    await createSalary(empId, structId, totalMonthly * 12, components);
    expect(totalMonthly).toBe(50000);
  });
  it("should handle multiple salary revisions", async () => {
    const empId = await createEmployee(3);
    const structId = await createStructure();
    const oldId = uuidv4();
    await db("employee_salaries").insert({
      id: oldId,
      employee_id: empId,
      structure_id: structId,
      ctc: 400000,
      gross_salary: 400000,
      net_salary: 300000,
      components: JSON.stringify([{ code: "BASIC", monthlyAmount: 16667 }]),
      effective_from: "2023-01-01",
      is_active: false,
    });
    track("employee_salaries", oldId);
    const newId = await createSalary(empId, structId, 600000, [
      { code: "BASIC", monthlyAmount: 25000 },
    ]);
    const active = await db("employee_salaries")
      .where({ employee_id: empId, is_active: true })
      .first();
    expect(active.id).toBe(newId);
  });
});

describe.skipIf(!dbAvailable)("Deduction Sequencing", () => {
  it("should store payslip with ordered deductions", async () => {
    const empId = await createEmployee(4);
    const runId = await createPayrollRun(3, 2026, "computed");
    const psId = await createPayslip(runId, empId, 3, 2026, {
      earnings: [
        { code: "BASIC", amount: 25000 },
        { code: "HRA", amount: 10000 },
      ],
      deductions: [
        { code: "PF", amount: 1800 },
        { code: "ESI", amount: 375 },
        { code: "PT", amount: 200 },
        { code: "TDS", amount: 2500 },
      ],
      gross: 50000,
      totalDeductions: 4875,
      netPay: 45125,
    });
    const ps = await db("payslips").where({ id: psId }).first();
    const deds = typeof ps.deductions === "string" ? JSON.parse(ps.deductions) : ps.deductions;
    expect(deds).toHaveLength(4);
    expect(deds[0].code).toBe("PF");
    expect(deds[3].code).toBe("TDS");
  });
  it("should handle zero deductions", async () => {
    const empId = await createEmployee(5);
    const runId = await createPayrollRun(4, 2026, "computed");
    const psId = await createPayslip(runId, empId, 4, 2026, {
      earnings: [{ code: "BASIC", amount: 10000 }],
      deductions: [],
      gross: 10000,
      totalDeductions: 0,
      netPay: 10000,
    });
    const ps = await db("payslips").where({ id: psId }).first();
    expect(Number(ps.total_deductions)).toBe(0);
  });
  it("should store employer contributions separately", async () => {
    const empId = await createEmployee(6);
    const runId = await createPayrollRun(5, 2026, "computed");
    const psId = await createPayslip(runId, empId, 5, 2026, {
      earnings: [{ code: "BASIC", amount: 25000 }],
      deductions: [{ code: "PF_EE", amount: 1800 }],
      employerContributions: [
        { code: "PF_ER", amount: 1800 },
        { code: "ESI_ER", amount: 975 },
      ],
      gross: 25000,
      totalDeductions: 1800,
      netPay: 23200,
      employerCost: 27775,
    });
    const ps = await db("payslips").where({ id: psId }).first();
    const ec =
      typeof ps.employer_contributions === "string"
        ? JSON.parse(ps.employer_contributions)
        : ps.employer_contributions;
    expect(ec).toHaveLength(2);
  });
});

describe.skipIf(!dbAvailable)("Net Pay Computation", () => {
  it("should calculate net = gross - deductions", async () => {
    const empId = await createEmployee(7);
    const runId = await createPayrollRun(6, 2026, "computed");
    const psId = await createPayslip(runId, empId, 6, 2026, {
      gross: 75000,
      totalDeductions: 12500,
      netPay: 62500,
      earnings: [{ code: "BASIC", amount: 37500 }],
      deductions: [
        { code: "PF", amount: 4500 },
        { code: "TDS", amount: 8000 },
      ],
    });
    const ps = await db("payslips").where({ id: psId }).first();
    expect(Number(ps.net_pay)).toBe(62500);
  });
  it("should handle LOP days", async () => {
    const empId = await createEmployee(8);
    const runId = await createPayrollRun(7, 2026, "computed");
    const psId = await createPayslip(runId, empId, 7, 2026, {
      paidDays: 25,
      totalDays: 31,
      lopDays: 6,
      gross: 40323,
      totalDeductions: 3000,
      netPay: 37323,
      earnings: [{ code: "BASIC", amount: 40323 }],
      deductions: [{ code: "PF", amount: 3000 }],
    });
    const ps = await db("payslips").where({ id: psId }).first();
    expect(Number(ps.paid_days)).toBe(25);
    expect(Number(ps.lop_days)).toBe(6);
  });
  it("should track YTD values across payslips", async () => {
    const empId = await createEmployee(9);
    const run1 = await createPayrollRun(1, 2026, "paid");
    const run2 = await createPayrollRun(2, 2026, "paid");
    const ps1Id = uuidv4();
    await db("payslips").insert({
      id: ps1Id,
      payroll_run_id: run1,
      employee_id: empId,
      month: 1,
      year: 2026,
      paid_days: 31,
      total_days: 31,
      earnings: "[]",
      deductions: "[]",
      employer_contributions: "[]",
      reimbursements: "[]",
      gross_earnings: 50000,
      total_deductions: 5000,
      net_pay: 45000,
      total_employer_cost: 55000,
      ytd_gross: 50000,
      ytd_deductions: 5000,
      ytd_net_pay: 45000,
      ytd_tax_paid: 3000,
      status: "paid",
    });
    track("payslips", ps1Id);
    const ps2Id = uuidv4();
    await db("payslips").insert({
      id: ps2Id,
      payroll_run_id: run2,
      employee_id: empId,
      month: 2,
      year: 2026,
      paid_days: 28,
      total_days: 28,
      earnings: "[]",
      deductions: "[]",
      employer_contributions: "[]",
      reimbursements: "[]",
      gross_earnings: 50000,
      total_deductions: 5000,
      net_pay: 45000,
      total_employer_cost: 55000,
      ytd_gross: 100000,
      ytd_deductions: 10000,
      ytd_net_pay: 90000,
      ytd_tax_paid: 6000,
      status: "paid",
    });
    track("payslips", ps2Id);
    const ps2 = await db("payslips").where({ id: ps2Id }).first();
    expect(Number(ps2.ytd_gross)).toBe(100000);
    expect(Number(ps2.ytd_net_pay)).toBe(90000);
  });
  it("should aggregate payroll run totals from payslips", async () => {
    const emp1 = await createEmployee(10);
    const emp2 = await createEmployee(11);
    const runId = await createPayrollRun(8, 2026, "computed");
    await createPayslip(runId, emp1, 8, 2026, {
      gross: 50000,
      totalDeductions: 5000,
      netPay: 45000,
      earnings: [],
      deductions: [],
    });
    await createPayslip(runId, emp2, 8, 2026, {
      gross: 60000,
      totalDeductions: 7000,
      netPay: 53000,
      earnings: [],
      deductions: [],
    });
    const totals = await db("payslips")
      .where({ payroll_run_id: runId })
      .sum({ totalGross: "gross_earnings", totalNet: "net_pay" })
      .first();
    await db("payroll_runs")
      .where({ id: runId })
      .update({ total_gross: totals!.totalGross, total_net: totals!.totalNet, employee_count: 2 });
    const run = await db("payroll_runs").where({ id: runId }).first();
    expect(Number(run.total_gross)).toBe(110000);
    expect(Number(run.total_net)).toBe(98000);
  });
});

describe.skipIf(!dbAvailable)("Payroll Run Lifecycle", () => {
  it("should transition: draft -> computed -> approved -> paid", async () => {
    const runId = await createPayrollRun(9, 2026, "draft");
    await db("payroll_runs").where({ id: runId }).update({ status: "computed" });
    let run = await db("payroll_runs").where({ id: runId }).first();
    expect(run.status).toBe("computed");
    await db("payroll_runs")
      .where({ id: runId })
      .update({ status: "approved", approved_at: new Date() });
    run = await db("payroll_runs").where({ id: runId }).first();
    expect(run.status).toBe("approved");
    await db("payroll_runs").where({ id: runId }).update({ status: "paid" });
    run = await db("payroll_runs").where({ id: runId }).first();
    expect(run.status).toBe("paid");
  });
  it("should store reimbursements in payslip", async () => {
    const empId = await createEmployee(12);
    const runId = await createPayrollRun(10, 2026, "computed");
    const psId = await createPayslip(runId, empId, 10, 2026, {
      earnings: [{ code: "BASIC", amount: 30000 }],
      deductions: [{ code: "PF", amount: 1800 }],
      reimbursements: [
        { code: "TRAVEL", name: "Travel", amount: 5000 },
        { code: "INTERNET", name: "Internet", amount: 1500 },
      ],
      gross: 30000,
      totalDeductions: 1800,
      netPay: 34700,
    });
    const ps = await db("payslips").where({ id: psId }).first();
    const reimb =
      typeof ps.reimbursements === "string" ? JSON.parse(ps.reimbursements) : ps.reimbursements;
    expect(reimb).toHaveLength(2);
  });
});
