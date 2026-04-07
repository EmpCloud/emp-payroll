/**
 * Extra coverage tests for the largest uncovered payroll services.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db/adapters", () => ({ getDB: vi.fn() }));
vi.mock("../../db/empcloud", () => {
  const chainable: any = {
    where: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue({
      id: 1,
      first_name: "John",
      last_name: "Doe",
      email: "j@t.com",
      emp_code: "E1",
      designation: "Eng",
      date_of_joining: "2020-01-01",
    }),
    insert: vi.fn().mockResolvedValue([1]),
    update: vi.fn().mockResolvedValue(1),
  };
  const knexFn = vi.fn(() => chainable);
  return {
    getEmpCloudDB: vi.fn(() => knexFn),
    findUserByEmail: vi.fn().mockResolvedValue(null),
    findUserById: vi
      .fn()
      .mockResolvedValue({ id: 1, first_name: "John", last_name: "Doe", email: "j@t.com" }),
    findOrgById: vi.fn().mockResolvedValue({ name: "TestOrg" }),
    getUserDepartmentName: vi.fn().mockResolvedValue("Engineering"),
    updateUserPassword: vi.fn().mockResolvedValue(true),
    createUser: vi.fn().mockResolvedValue({ id: 1 }),
    createOrganization: vi.fn().mockResolvedValue({ id: 1 }),
    findUsersByOrgId: vi.fn().mockResolvedValue([]),
    findAllEmployeesOfOrg: vi.fn().mockResolvedValue([]),
  };
});
vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue({}) })) },
  createTransport: vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue({}) })),
}));

import { getDB } from "../../db/adapters";
const mockedGetDB = vi.mocked(getDB);

function mkDb() {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }),
    findById: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation((_t: string, d: any) => Promise.resolve({ id: "m", ...d })),
    createMany: vi.fn().mockResolvedValue([]),
    update: vi
      .fn()
      .mockImplementation((_t: string, id: string, d: any) => Promise.resolve({ id, ...d })),
    delete: vi.fn().mockResolvedValue(1),
    deleteMany: vi.fn().mockResolvedValue(1),
    raw: vi.fn().mockResolvedValue([[]]),
    count: vi.fn().mockResolvedValue(0),
    updateMany: vi.fn().mockResolvedValue(1),
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    migrate: vi.fn(),
    rollback: vi.fn(),
    seed: vi.fn(),
  };
}

let db: ReturnType<typeof mkDb>;
beforeEach(() => {
  vi.clearAllMocks();
  db = mkDb();
  mockedGetDB.mockReturnValue(db as any);
});

// =========================================================================
// GLOBAL PAYROLL SERVICE
// =========================================================================
import { GlobalPayrollService } from "../../services/global-payroll.service";

describe("GlobalPayrollService", () => {
  let svc: GlobalPayrollService;
  beforeEach(() => {
    svc = new GlobalPayrollService();
  });

  it("listCountries — active by default", async () => {
    await svc.listCountries();
    expect(db.findMany).toHaveBeenCalledWith(
      "countries",
      expect.objectContaining({ filters: { is_active: 1 } }),
    );
  });

  it("listCountries — with region filter", async () => {
    await svc.listCountries({ region: "Asia" });
    expect(db.findMany).toHaveBeenCalledWith(
      "countries",
      expect.objectContaining({ filters: expect.objectContaining({ region: "Asia" }) }),
    );
  });

  it("getCountry — throws 404", async () => {
    db.findById.mockResolvedValue(null);
    await expect(svc.getCountry("c1")).rejects.toThrow();
  });

  it("getCountry — returns country", async () => {
    db.findById.mockResolvedValue({ id: "c1", name: "India", code: "IN" });
    const r = await svc.getCountry("c1");
    expect(r.name).toBe("India");
  });

  it("addGlobalEmployee — creates employee", async () => {
    db.findById.mockResolvedValue({ id: "c1", code: "IN", compliance_notes: null });
    db.findOne.mockResolvedValue({ id: "ge1" });
    db.findMany.mockResolvedValue({ data: [], total: 0 });
    await svc.addGlobalEmployee("1", {
      employee_name: "John",
      email: "john@test.com",
      country_id: "c1",
      gross_monthly_salary: 100000,
      currency_code: "INR",
      employment_type: "full_time",
    });
    expect(db.create).toHaveBeenCalled();
  });

  it("listGlobalEmployees — lists for org", async () => {
    await svc.listGlobalEmployees("1");
    expect(db.findMany).toHaveBeenCalled();
  });

  it("getGlobalEmployee — throws 404", async () => {
    db.findOne.mockResolvedValue(null);
    await expect(svc.getGlobalEmployee("1", "ge1")).rejects.toThrow();
  });

  it("getGlobalEmployee — returns with country", async () => {
    db.findOne.mockResolvedValue({ id: "ge1", country_id: "c1" });
    db.findById.mockResolvedValue({ id: "c1", name: "India" });
    const r = await svc.getGlobalEmployee("1", "ge1");
    expect(r).toBeDefined();
  });

  it("updateGlobalEmployee — throws 404", async () => {
    db.findOne.mockResolvedValue(null);
    await expect(svc.updateGlobalEmployee("1", "ge1", {})).rejects.toThrow();
  });

  it("updateGlobalEmployee — updates employee", async () => {
    db.findOne.mockResolvedValueOnce({ id: "ge1" }).mockResolvedValueOnce({ id: "ge1" });
    db.findById.mockResolvedValue({ id: "c1" });
    db.findMany.mockResolvedValue({ data: [], total: 0 });
    await svc.updateGlobalEmployee("1", "ge1", { gross_monthly_salary: 120000 });
    expect(db.update).toHaveBeenCalled();
  });

  it("terminateGlobalEmployee — throws 404", async () => {
    db.findOne.mockResolvedValue(null);
    await expect(svc.terminateGlobalEmployee("1", "ge1")).rejects.toThrow();
  });

  it("terminateGlobalEmployee — terminates", async () => {
    db.findOne.mockResolvedValue({ id: "ge1" });
    await svc.terminateGlobalEmployee("1", "ge1", "Resigned");
    expect(db.update).toHaveBeenCalled();
  });

  it("createPayrollRun — creates run with items", async () => {
    db.findMany.mockResolvedValue({
      data: [
        {
          id: "ge1",
          gross_monthly_salary: 100000,
          country_id: "c1",
          currency_code: "INR",
          employee_name: "John",
        },
      ],
      total: 1,
    });
    db.findById.mockResolvedValue({ id: "c1", code: "IN", compliance_notes: null, name: "India" });
    db.findOne.mockResolvedValue(null); // no duplicate run
    await svc.createPayrollRun("1", "c1", 3, 2026);
    expect(db.create).toHaveBeenCalled();
  });

  it("listPayrollRuns — lists", async () => {
    await svc.listPayrollRuns("1");
    expect(db.findMany).toHaveBeenCalled();
  });

  it("getPayrollRun — throws 404", async () => {
    db.findOne.mockResolvedValue(null);
    await expect(svc.getPayrollRun("1", "r1")).rejects.toThrow();
  });

  it("approvePayrollRun — throws 404", async () => {
    db.findOne.mockResolvedValue(null);
    await expect(svc.approvePayrollRun("1", "r1", "u1")).rejects.toThrow();
  });

  it("approvePayrollRun — approves", async () => {
    db.findOne.mockResolvedValueOnce({ id: "r1", status: "draft" }).mockResolvedValue({ id: "r1" });
    db.findMany.mockResolvedValue({ data: [], total: 0 });
    await svc.approvePayrollRun("1", "r1", "u1");
    expect(db.update).toHaveBeenCalled();
  });

  it("markPayrollRunPaid — marks as paid", async () => {
    db.findOne
      .mockResolvedValueOnce({ id: "r1", status: "approved" })
      .mockResolvedValue({ id: "r1" });
    db.findMany.mockResolvedValue({ data: [], total: 0 });
    await svc.markPayrollRunPaid("1", "r1");
    expect(db.update).toHaveBeenCalled();
  });

  it("submitContractorInvoice — submits invoice", async () => {
    db.findOne.mockResolvedValue({ id: "ge1", employment_type: "contractor" });
    await svc.submitContractorInvoice("1", "ge1", {
      invoice_number: "INV-001",
      amount: 50000,
      invoice_date: "2026-03-15",
    });
    expect(db.create).toHaveBeenCalled();
  });

  it("listContractorInvoices — lists", async () => {
    await svc.listContractorInvoices("1");
    expect(db.findMany).toHaveBeenCalled();
  });

  it("approveContractorInvoice — throws 404", async () => {
    db.findOne.mockResolvedValue(null);
    await expect(svc.approveContractorInvoice("1", "inv1", "u1")).rejects.toThrow();
  });

  it("getComplianceChecklist — returns checklist", async () => {
    db.findOne.mockResolvedValue({ id: "ge1" });
    db.findMany.mockResolvedValue({ data: [{ id: "cl1" }], total: 1 });
    const r = await svc.getComplianceChecklist("1", "ge1");
    expect(r).toBeDefined();
  });

  it("updateChecklistItem — throws 404", async () => {
    db.findOne.mockResolvedValue(null);
    await expect(svc.updateChecklistItem("1", "ci1", true)).rejects.toThrow();
  });
});

// =========================================================================
// TAX DECLARATION SERVICE
// =========================================================================
import { TaxDeclarationService } from "../../services/tax-declaration.service";

describe("TaxDeclarationService", () => {
  let svc: TaxDeclarationService;
  beforeEach(() => {
    svc = new TaxDeclarationService();
  });

  it("getComputation — returns tax computation", async () => {
    db.findOne.mockResolvedValue({ id: "s1", base_salary: 100000, components: "[]" });
    db.findMany.mockResolvedValue({ data: [], total: 0 });
    const r = await svc.getComputation("e1");
    expect(r).toBeDefined();
  });

  it("computeTax — computes tax", async () => {
    db.findById.mockResolvedValue({ id: "e1", tax_info: '{"regime":"new"}' });
    db.findOne.mockResolvedValue({
      id: "s1",
      base_salary: 100000,
      is_active: true,
      components: '[{"code":"BASIC","monthlyAmount":50000}]',
    });
    db.findMany.mockResolvedValue({ data: [], total: 0 });
    const r = await svc.computeTax("e1");
    expect(r).toBeDefined();
  });

  it("getDeclarations — lists", async () => {
    await svc.getDeclarations("e1");
    expect(db.findMany).toHaveBeenCalled();
  });

  it("submitDeclarations — submits", async () => {
    await svc.submitDeclarations("e1", "2025-2026", [
      { section: "80C", amount: 150000, description: "PPF" },
    ]);
    expect(db.create).toHaveBeenCalled();
  });

  it("updateDeclaration — updates", async () => {
    db.findOne.mockResolvedValue({ id: "d1", employee_id: "e1" });
    await svc.updateDeclaration("e1", "d1", { amount: 200000 });
    expect(db.update).toHaveBeenCalled();
  });

  it("approveDeclarations — approves", async () => {
    db.findMany.mockResolvedValue({ data: [{ id: "d1", declared_amount: 150000 }], total: 1 });
    await svc.approveDeclarations("e1", "u1");
    expect(db.update).toHaveBeenCalled();
  });

  it("getRegime — returns regime", async () => {
    db.findById.mockResolvedValue({ id: "e1", tax_info: '{"regime":"new"}' });
    const r = await svc.getRegime("e1");
    expect(r).toBeDefined();
  });

  it("updateRegime — updates regime", async () => {
    db.findById.mockResolvedValue({ id: "e1", tax_info: '{"regime":"new"}' });
    await svc.updateRegime("e1", "old");
    expect(db.update).toHaveBeenCalled();
  });
});

// =========================================================================
// INSURANCE SERVICE
// =========================================================================
import { InsuranceService } from "../../services/insurance.service";

describe("InsuranceService", () => {
  let svc: InsuranceService;
  beforeEach(() => {
    svc = new InsuranceService();
  });

  it("listPolicies — lists", async () => {
    await svc.listPolicies("1");
    expect(db.findMany).toHaveBeenCalled();
  });

  it("getPolicy — throws 404", async () => {
    db.findOne.mockResolvedValue(null);
    await expect(svc.getPolicy("p1", "1")).rejects.toThrow();
  });

  it("getPolicy — returns", async () => {
    db.findOne.mockResolvedValue({ id: "p1" });
    const r = await svc.getPolicy("p1", "1");
    expect(r.id).toBe("p1");
  });

  it("createPolicy — creates", async () => {
    await svc.createPolicy("1", {
      name: "Health",
      type: "health",
      provider: "ICICI",
      premium_monthly: 5000,
      coverage_amount: 500000,
    });
    expect(db.create).toHaveBeenCalled();
  });

  it("updatePolicy — throws 404", async () => {
    db.findOne.mockResolvedValue(null);
    await expect(svc.updatePolicy("p1", "1", {})).rejects.toThrow();
  });

  it("deletePolicy — throws 404", async () => {
    db.findOne.mockResolvedValue(null);
    await expect(svc.deletePolicy("p1", "1")).rejects.toThrow();
  });

  it("enrollEmployee — creates enrollment", async () => {
    db.findOne
      .mockResolvedValueOnce({ id: "p1", status: "active", coverage_amount: 500000 }) // getPolicy
      .mockResolvedValueOnce(null); // no duplicate enrollment
    await svc.enrollEmployee("1", { policyId: "p1", employeeId: "e1", dependents: [] });
    expect(db.create).toHaveBeenCalled();
  });

  it("listEnrollments — lists", async () => {
    await svc.listEnrollments("1");
    expect(db.findMany).toHaveBeenCalled();
  });

  it("getMyInsurance — returns employee insurance", async () => {
    db.findMany.mockResolvedValue({ data: [{ id: "en1" }], total: 1 });
    const r = await svc.getMyInsurance("1", "e1");
    expect(r).toBeDefined();
  });

  it("submitClaim — creates claim", async () => {
    db.findOne.mockResolvedValue({ id: "en1", policy_id: "p1", employee_id: 1, status: "active" }); // enrollment check
    db.count.mockResolvedValue(0);
    await svc.submitClaim("1", "e1", {
      policyId: "p1",
      claimType: "hospitalization",
      amountClaimed: 25000,
    });
    expect(db.create).toHaveBeenCalled();
  });

  it("listClaims — lists claims", async () => {
    await svc.listClaims("1");
    expect(db.findMany).toHaveBeenCalled();
  });

  it("getMyClaims — returns my claims", async () => {
    db.findMany.mockResolvedValue({ data: [{ id: "cl1" }], total: 1 });
    const r = await svc.getMyClaims("1", "e1");
    expect(r).toBeDefined();
  });

  it("reviewClaim — throws 404", async () => {
    db.findOne.mockResolvedValue(null);
    await expect(svc.reviewClaim("1", "cl1", "approved", "u1")).rejects.toThrow();
  });

  it("settleClaim — throws 404", async () => {
    db.findOne.mockResolvedValue(null);
    await expect(svc.settleClaim("1", "cl1")).rejects.toThrow();
  });

  it("getDashboardStats — returns stats", async () => {
    db.raw.mockResolvedValue([[{ count: 5 }]]);
    db.findMany.mockResolvedValue({ data: [], total: 0 });
    const r = await svc.getDashboardStats("1");
    expect(r).toBeDefined();
  });
});

// =========================================================================
// EARNED WAGE SERVICE
// =========================================================================
import { EarnedWageService } from "../../services/earned-wage.service";

describe("EarnedWageService", () => {
  let svc: EarnedWageService;
  beforeEach(() => {
    svc = new EarnedWageService();
  });

  it("getSettings — returns settings", async () => {
    db.findOne.mockResolvedValue({ max_percentage: 50, enabled: true });
    const r = await svc.getSettings("1");
    expect(r).toBeDefined();
  });

  it("getSettings — returns defaults when null", async () => {
    db.findOne.mockResolvedValue(null);
    const r = await svc.getSettings("1");
    expect(r).toBeDefined();
  });

  it("updateSettings — updates", async () => {
    db.findOne.mockResolvedValue({ id: "s1" });
    await svc.updateSettings("1", { max_percentage: 60 });
    expect(db.update).toHaveBeenCalled();
  });

  it("calculateAvailable — calculates available amount", async () => {
    db.findOne.mockResolvedValue({ base_salary: 100000 });
    db.findMany.mockResolvedValue({ data: [], total: 0 });
    db.raw.mockResolvedValue([[{ total: 0 }]]);
    const r = await svc.calculateAvailable("1", "e1");
    expect(r).toBeDefined();
  });

  it("requestAdvance — creates advance request", async () => {
    db.findOne
      .mockResolvedValueOnce({
        id: "s1",
        is_enabled: true,
        max_percentage: 50,
        min_amount: 0,
        max_amount: 0,
        fee_percentage: 0,
        fee_flat: 0,
        auto_approve_below: 0,
        requires_manager_approval: false,
        cooldown_days: 0,
      }) // getSettings
      .mockResolvedValueOnce({
        id: "s1",
        is_enabled: true,
        max_percentage: 50,
        min_amount: 0,
        max_amount: 0,
        fee_percentage: 0,
        fee_flat: 0,
        auto_approve_below: 0,
        requires_manager_approval: false,
        cooldown_days: 0,
      }) // getSettings in calculateAvailable
      .mockResolvedValueOnce({ id: "sa1", ctc: 1200000, employee_id: "e1", org_id: 1 }); // salary_assignments
    db.findMany.mockResolvedValue({ data: [], total: 0 });
    await svc.requestAdvance("1", "e1", 5000, "Emergency");
    expect(db.create).toHaveBeenCalled();
  });

  it("approveRequest — throws 404", async () => {
    db.findOne.mockResolvedValue(null);
    await expect(svc.approveRequest("1", "r1", "u1")).rejects.toThrow();
  });

  it("rejectRequest — throws 404", async () => {
    db.findOne.mockResolvedValue(null);
    await expect(svc.rejectRequest("1", "r1")).rejects.toThrow();
  });

  it("listRequests — lists", async () => {
    await svc.listRequests("1");
    expect(db.findMany).toHaveBeenCalled();
  });

  it("getMyRequests — lists my requests", async () => {
    await svc.getMyRequests("1", "e1");
    expect(db.findMany).toHaveBeenCalled();
  });

  it("getDashboard — returns dashboard data", async () => {
    db.raw.mockResolvedValue([[{ count: 5, total: 100000 }]]);
    const r = await svc.getDashboard("1");
    expect(r).toBeDefined();
  });
});

// =========================================================================
// PAY EQUITY SERVICE
// =========================================================================
import { PayEquityService } from "../../services/pay-equity.service";

describe("PayEquityService", () => {
  let svc: PayEquityService;
  beforeEach(() => {
    svc = new PayEquityService();
  });

  it("analyzePayEquity — default dimension", async () => {
    db.raw.mockResolvedValue([[{ group_name: "M", avg_salary: 80000, count: 10 }]]);
    const r = await svc.analyzePayEquity("1");
    expect(r).toBeDefined();
  });

  it("analyzePayEquity — department dimension", async () => {
    db.raw.mockResolvedValue([[{ group_name: "Engineering", avg_salary: 90000, count: 20 }]]);
    const r = await svc.analyzePayEquity("1", { dimension: "department" });
    expect(r).toBeDefined();
  });

  it("generateComplianceReport — generates report", async () => {
    db.raw.mockResolvedValue([[{ group_name: "M", avg_salary: 80000, count: 10 }]]);
    const r = await svc.generateComplianceReport("1");
    expect(r).toBeDefined();
  });
});

// =========================================================================
// TOTAL REWARDS SERVICE
// =========================================================================
import { TotalRewardsService } from "../../services/total-rewards.service";

describe("TotalRewardsService", () => {
  let svc: TotalRewardsService;
  beforeEach(() => {
    svc = new TotalRewardsService();
  });

  it("generateStatement — returns total rewards statement", async () => {
    db.findOne.mockResolvedValue({
      id: "s1",
      base_salary: 100000,
      components: '[{"code":"BASIC","monthlyAmount":50000}]',
    });
    db.findMany.mockResolvedValue({ data: [], total: 0 });
    db.findById.mockResolvedValue({ name: "TestOrg" });
    const r = await svc.generateStatement("1", "e1");
    expect(r).toBeDefined();
  });

  it("generateStatementHTML — returns HTML", async () => {
    db.findOne.mockResolvedValue({ id: "s1", base_salary: 100000, components: "[]" });
    db.findMany.mockResolvedValue({ data: [], total: 0 });
    db.findById.mockResolvedValue({ name: "TestOrg" });
    const r = await svc.generateStatementHTML("1", "e1");
    expect(typeof r).toBe("string");
    expect(r).toContain("html");
  });
});
