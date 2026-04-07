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
const TEST_ORG = 88804;
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
    first_name: `Misc${suffix}`,
    last_name: `Emp${TEST_TS}`,
    email: `misc${suffix}-${TEST_TS}@test.com`,
    employee_code: `MSC-${TEST_TS}-${suffix}`,
    department: "HR",
    designation: "Analyst",
    date_of_birth: "1995-01-01",
    gender: "male",
    date_of_joining: "2024-01-15",
    is_active: true,
    tax_info: JSON.stringify({ pan: `ZZZZZ${1000 + suffix}Z`, regime: "old" }),
    pf_details: JSON.stringify({}),
    esi_details: JSON.stringify({}),
    bank_details: JSON.stringify({ accountNumber: "1234567890", ifscCode: "SBIN0001234" }),
  });
  track("employees", id);
  return id;
}

describe.skipIf(!dbAvailable)("Insurance Policies", () => {
  it("should create an insurance policy", async () => {
    const id = uuidv4();
    await db("insurance_policies").insert({
      id,
      empcloud_org_id: TEST_ORG,
      name: `Group Health-${TEST_TS}`,
      policy_number: "GHI-001",
      provider: "ICICI Lombard",
      type: "health",
      premium_total: 500000,
      premium_per_employee: 10000,
      coverage_amount: 500000,
      start_date: "2026-01-01",
      end_date: "2026-12-31",
      status: "active",
    });
    track("insurance_policies", id);
    const pol = await db("insurance_policies").where({ id }).first();
    expect(pol.type).toBe("health");
    expect(Number(pol.coverage_amount)).toBe(500000);
  });
  it("should enroll employee in insurance", async () => {
    const polId = uuidv4();
    await db("insurance_policies").insert({
      id: polId,
      empcloud_org_id: TEST_ORG,
      name: `Life-${TEST_TS}`,
      provider: "LIC",
      type: "life",
      premium_total: 200000,
      premium_per_employee: 5000,
      coverage_amount: 1000000,
      start_date: "2026-01-01",
      status: "active",
    });
    track("insurance_policies", polId);
    const enrollId = uuidv4();
    await db("employee_insurance").insert({
      id: enrollId,
      empcloud_org_id: TEST_ORG,
      policy_id: polId,
      employee_id: 88901,
      status: "active",
      sum_insured: 1000000,
      premium_share: 2500,
      nominee_name: "Jane Doe",
      nominee_relationship: "spouse",
      enrolled_at: "2026-01-15",
    });
    track("employee_insurance", enrollId);
    const enroll = await db("employee_insurance").where({ id: enrollId }).first();
    expect(enroll.status).toBe("active");
    expect(enroll.nominee_name).toBe("Jane Doe");
  });
  it("should file and approve an insurance claim", async () => {
    const polId = uuidv4();
    await db("insurance_policies").insert({
      id: polId,
      empcloud_org_id: TEST_ORG,
      name: `Claim-Policy-${TEST_TS}`,
      provider: "Star Health",
      type: "health",
      premium_total: 300000,
      premium_per_employee: 8000,
      coverage_amount: 500000,
      start_date: "2026-01-01",
      status: "active",
    });
    track("insurance_policies", polId);
    const claimId = uuidv4();
    await db("insurance_claims").insert({
      id: claimId,
      empcloud_org_id: TEST_ORG,
      policy_id: polId,
      employee_id: 88902,
      claim_number: `CLM-${TEST_TS}`,
      claim_type: "hospitalization",
      amount_claimed: 75000,
      status: "submitted",
      description: "Surgery",
    });
    track("insurance_claims", claimId);
    await db("insurance_claims").where({ id: claimId }).update({
      status: "approved",
      amount_approved: 70000,
      reviewed_by: 88999,
      reviewed_at: new Date(),
    });
    const updated = await db("insurance_claims").where({ id: claimId }).first();
    expect(updated.status).toBe("approved");
    expect(Number(updated.amount_approved)).toBe(70000);
  });
});

describe.skipIf(!dbAvailable)("Benefit Plans", () => {
  it("should create and enroll in a benefit plan", async () => {
    const planId = uuidv4();
    await db("benefit_plans").insert({
      id: planId,
      empcloud_org_id: TEST_ORG,
      name: `Dental Plan-${TEST_TS}`,
      type: "dental",
      provider: "Delta Dental",
      premium_amount: 500,
      employer_contribution: 300,
      coverage_details: JSON.stringify({ maxCoverage: 50000 }),
      enrollment_period_start: "2026-01-01",
      enrollment_period_end: "2026-03-31",
      is_active: true,
    });
    track("benefit_plans", planId);
    const enrollId = uuidv4();
    await db("employee_benefits").insert({
      id: enrollId,
      empcloud_org_id: TEST_ORG,
      empcloud_user_id: 88903,
      plan_id: planId,
      status: "enrolled",
      coverage_type: "family",
      start_date: "2026-02-01",
      premium_employee_share: 200,
      premium_employer_share: 300,
    });
    track("employee_benefits", enrollId);
    const enroll = await db("employee_benefits").where({ id: enrollId }).first();
    expect(enroll.status).toBe("enrolled");
    expect(enroll.coverage_type).toBe("family");
  });
  it("should deactivate a benefit plan", async () => {
    const planId = uuidv4();
    await db("benefit_plans").insert({
      id: planId,
      empcloud_org_id: TEST_ORG,
      name: `Vision-${TEST_TS}`,
      type: "vision",
      premium_amount: 200,
      employer_contribution: 100,
      is_active: true,
    });
    track("benefit_plans", planId);
    await db("benefit_plans").where({ id: planId }).update({ is_active: false });
    const plan = await db("benefit_plans").where({ id: planId }).first();
    expect(plan.is_active).toBe(0);
  });
});

describe.skipIf(!dbAvailable)("Tax Declarations", () => {
  it("should submit and approve tax declarations", async () => {
    const empId = await createEmployee(4);
    const decls = [
      {
        id: uuidv4(),
        employee_id: empId,
        financial_year: "2025-26",
        section: "80C",
        description: "ELSS Investment",
        declared_amount: 150000,
        approval_status: "pending",
      },
      {
        id: uuidv4(),
        employee_id: empId,
        financial_year: "2025-26",
        section: "80D",
        description: "Health Insurance",
        declared_amount: 25000,
        approval_status: "pending",
      },
    ];
    for (const d of decls) {
      await db("tax_declarations").insert(d);
      track("tax_declarations", d.id);
    }
    for (const d of decls) {
      await db("tax_declarations").where({ id: d.id }).update({
        approval_status: "approved",
        approved_amount: d.declared_amount,
        approved_by: uuidv4(),
        approved_at: new Date(),
      });
    }
    const approved = await db("tax_declarations").where({
      employee_id: empId,
      approval_status: "approved",
    });
    expect(approved).toHaveLength(2);
    expect(Number(approved[0].approved_amount) + Number(approved[1].approved_amount)).toBe(175000);
  });
  it("should store tax computation results", async () => {
    const empId = await createEmployee(5);
    const compId = uuidv4();
    await db("tax_computations").insert({
      id: compId,
      employee_id: empId,
      financial_year: "2025-26",
      regime: "new",
      gross_income: 1200000,
      exemptions: JSON.stringify([]),
      total_exemptions: 0,
      deductions: JSON.stringify([{ section: "80C", amount: 150000 }]),
      total_deductions: 150000,
      taxable_income: 1050000,
      tax_on_income: 115000,
      surcharge: 0,
      health_and_education_cess: 4600,
      total_tax: 119600,
      tax_already_paid: 60000,
      remaining_tax: 59600,
      monthly_tds: 9933,
    });
    track("tax_computations", compId);
    const comp = await db("tax_computations").where({ id: compId }).first();
    expect(comp.regime).toBe("new");
    expect(Number(comp.taxable_income)).toBe(1050000);
    expect(Number(comp.monthly_tds)).toBe(9933);
  });
});

describe.skipIf(!dbAvailable)("Earned Wage Access", () => {
  it("should create and manage EWA settings", async () => {
    const id = uuidv4();
    await db("earned_wage_settings").insert({
      id,
      empcloud_org_id: TEST_ORG,
      is_enabled: true,
      max_percentage: 50,
      min_amount: 1000,
      max_amount: 50000,
      fee_percentage: 1.5,
      fee_flat: 50,
      auto_approve_below: 5000,
      requires_manager_approval: true,
      cooldown_days: 7,
    });
    track("earned_wage_settings", id);
    const settings = await db("earned_wage_settings").where({ empcloud_org_id: TEST_ORG }).first();
    expect(settings.is_enabled).toBe(1);
    expect(Number(settings.max_percentage)).toBe(50);
  });
  it("should create an EWA request and approve it", async () => {
    const reqId = uuidv4();
    await db("earned_wage_access_requests").insert({
      id: reqId,
      empcloud_org_id: TEST_ORG,
      employee_id: 88906,
      amount: 10000,
      currency: "INR",
      status: "pending",
      max_available: 25000,
      fee_amount: 200,
      reason: "Emergency",
    });
    track("earned_wage_access_requests", reqId);
    await db("earned_wage_access_requests")
      .where({ id: reqId })
      .update({ status: "approved", approved_by: 88999, approved_at: new Date() });
    const approved = await db("earned_wage_access_requests").where({ id: reqId }).first();
    expect(approved.status).toBe("approved");
  });
  it("should reject an EWA request", async () => {
    const reqId = uuidv4();
    await db("earned_wage_access_requests").insert({
      id: reqId,
      empcloud_org_id: TEST_ORG,
      employee_id: 88907,
      amount: 60000,
      currency: "INR",
      status: "pending",
      max_available: 25000,
      fee_amount: 950,
    });
    track("earned_wage_access_requests", reqId);
    await db("earned_wage_access_requests")
      .where({ id: reqId })
      .update({ status: "rejected", notes: "Amount exceeds available" });
    const rej = await db("earned_wage_access_requests").where({ id: reqId }).first();
    expect(rej.status).toBe("rejected");
  });
});

describe.skipIf(!dbAvailable)("Global Employees", () => {
  it("should create a global employee record", async () => {
    const geId = uuidv4();
    // Use existing country from seed data
    const country = await db("countries").first();
    await db("global_employees").insert({
      id: geId,
      empcloud_org_id: TEST_ORG,
      first_name: `Global${TEST_TS}`,
      last_name: "Emp",
      email: `global-${TEST_TS}@test.com`,
      country_id: country.id,
      employment_type: "full_time",
      contract_type: "permanent",
      job_title: "Engineer",
      start_date: "2026-01-01",
      salary_amount: 60000,
      salary_currency: "GBP",
      status: "active",
    });
    track("global_employees", geId);
    const ge = await db("global_employees").where({ id: geId }).first();
    expect(ge).toBeTruthy();
    expect(ge.salary_currency).toBe("GBP");
  });
});

describe.skipIf(!dbAvailable)("Compensation Benchmarks", () => {
  it("should create and query benchmark data", async () => {
    const benchmarks = [
      {
        id: uuidv4(),
        empcloud_org_id: TEST_ORG,
        job_title: "Software Engineer",
        department: "Engineering",
        location: "Mumbai",
        market_p25: 800000,
        market_p50: 1200000,
        market_p75: 1600000,
        source: "Glassdoor",
        effective_date: "2026-01-01",
      },
      {
        id: uuidv4(),
        empcloud_org_id: TEST_ORG,
        job_title: "Product Manager",
        department: "Product",
        location: "Bangalore",
        market_p25: 1500000,
        market_p50: 2000000,
        market_p75: 2800000,
        source: "Glassdoor",
        effective_date: "2026-01-01",
      },
    ];
    for (const b of benchmarks) {
      await db("compensation_benchmarks").insert(b);
      track("compensation_benchmarks", b.id);
    }
    const results = await db("compensation_benchmarks")
      .where({ empcloud_org_id: TEST_ORG })
      .whereIn(
        "id",
        benchmarks.map((b) => b.id),
      );
    expect(results).toHaveLength(2);
    const se = results.find((r: any) => r.job_title === "Software Engineer");
    expect(Number(se.market_p50)).toBe(1200000);
  });
});

describe.skipIf(!dbAvailable)("Payroll Adjustments", () => {
  it("should create one-time adjustments", async () => {
    const empId = await createEmployee(10);
    const adjId = uuidv4();
    await db("payroll_adjustments").insert({
      id: adjId,
      org_id: TEST_ORG_ID,
      employee_id: empId,
      type: "bonus",
      amount: 25000,
      description: "Annual bonus",
      effective_month: "2026-03-01",
      status: "pending",
      created_by: uuidv4(),
    });
    track("payroll_adjustments", adjId);
    const adj = await db("payroll_adjustments").where({ id: adjId }).first();
    expect(adj.type).toBe("bonus");
    expect(Number(adj.amount)).toBe(25000);
  });
});

describe.skipIf(!dbAvailable)("Salary Structures", () => {
  it("should create a salary structure with components", async () => {
    const structId = uuidv4();
    await db("salary_structures").insert({
      id: structId,
      empcloud_org_id: TEST_ORG,
      org_id: TEST_ORG_ID,
      name: `Std Structure-${TEST_TS}`,
      description: "Standard CTC structure",
      is_default: true,
    });
    track("salary_structures", structId);
    const components = [
      {
        id: uuidv4(),
        structure_id: structId,
        code: "BASIC",
        name: "Basic Salary",
        type: "earning",
        calculation_type: "percentage",
        value: 50,
        is_taxable: true,
        is_active: true,
      },
      {
        id: uuidv4(),
        structure_id: structId,
        code: "HRA",
        name: "HRA",
        type: "earning",
        calculation_type: "percentage",
        value: 20,
        is_taxable: true,
        is_active: true,
      },
      {
        id: uuidv4(),
        structure_id: structId,
        code: "PF",
        name: "PF Employee",
        type: "deduction",
        calculation_type: "percentage",
        value: 12,
        is_taxable: false,
        is_active: true,
      },
    ];
    for (const c of components) {
      await db("salary_components").insert(c);
      track("salary_components", c.id);
    }
    const comps = await db("salary_components").where({ structure_id: structId });
    expect(comps).toHaveLength(3);
    expect(comps.filter((c: any) => c.type === "earning")).toHaveLength(2);
  });
});
