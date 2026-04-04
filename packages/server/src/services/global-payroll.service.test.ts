import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/adapters", () => ({ getDB: vi.fn() }));

import { GlobalPayrollService } from "./global-payroll.service";
import { getDB } from "../db/adapters";

const mockedGetDB = vi.mocked(getDB);

function makeMockDb(overrides: Record<string, unknown> = {}) {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findById: vi.fn().mockResolvedValue(null),
    create: vi
      .fn()
      .mockImplementation((_t: string, data: any) => Promise.resolve({ id: "mock-id", ...data })),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue(undefined),
    deleteMany: vi.fn().mockResolvedValue(undefined),
    raw: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

// =============================================================================
// COUNTRY DEDUCTION CALCULATIONS (via createPayrollRun)
// =============================================================================

describe("GlobalPayrollService — createPayrollRun (deduction calculations)", () => {
  let service: GlobalPayrollService;
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = makeMockDb();
    mockedGetDB.mockReturnValue(mockDb as any);
    service = new GlobalPayrollService();
  });

  function setupCreateRun(country: any, employees: any[]) {
    mockDb.findById.mockImplementation(async (table: string, id: string) => {
      if (table === "countries") return country;
      if (table === "global_payroll_runs") return { id: "run-1", ...country };
      return null;
    });
    mockDb.findOne.mockResolvedValue(null); // no existing run

    let findManyCallCount = 0;
    mockDb.findMany.mockImplementation(async (table: string, opts: any) => {
      if (table === "global_employees") {
        findManyCallCount++;
        if (findManyCallCount === 1) {
          // EOR employees
          return {
            data: employees.filter((e) => e.employment_type === "eor"),
            total: employees.filter((e) => e.employment_type === "eor").length,
          };
        }
        // direct_hire employees
        return {
          data: employees.filter((e) => e.employment_type === "direct_hire"),
          total: employees.filter((e) => e.employment_type === "direct_hire").length,
        };
      }
      return { data: [], total: 0 };
    });
  }

  it("should compute India (IN) deductions: EPF 12%, ESI, 15% tax", async () => {
    setupCreateRun({ id: "c1", code: "IN", currency: "INR", name: "India" }, [
      {
        id: "ge1",
        salary_amount: 60000,
        salary_frequency: "monthly",
        salary_currency: "INR",
        employment_type: "eor",
      },
    ]);

    await service.createPayrollRun("1", "c1", 3, 2026);

    const createCalls = mockDb.create.mock.calls.filter(
      (c: any[]) => c[0] === "global_payroll_items",
    );
    expect(createCalls).toHaveLength(1);

    const item = createCalls[0][1];
    // EPF: 12% of 60000 = 7200
    expect(item.pension_employee).toBe(7200);
    expect(item.pension_employer).toBe(7200);
    // Tax: 15% of 60000 = 9000
    expect(item.tax_amount).toBe(9000);
    // PT: min(20000, 0.2% of 60000) = min(20000, 120) = 120
    expect(item.other_deductions).toBe(120);
  });

  it("should compute US deductions: FICA 7.65%, 22% tax", async () => {
    setupCreateRun({ id: "c2", code: "US", currency: "USD", name: "United States" }, [
      {
        id: "ge1",
        salary_amount: 8000,
        salary_frequency: "monthly",
        salary_currency: "USD",
        employment_type: "eor",
      },
    ]);

    await service.createPayrollRun("1", "c2", 3, 2026);

    const createCalls = mockDb.create.mock.calls.filter(
      (c: any[]) => c[0] === "global_payroll_items",
    );
    const item = createCalls[0][1];

    expect(item.social_security_employee).toBe(Math.round(8000 * 0.0765)); // 612
    expect(item.social_security_employer).toBe(Math.round(8000 * 0.0765));
    expect(item.tax_amount).toBe(Math.round(8000 * 0.22)); // 1760
  });

  it("should compute UK (GB) deductions: NI, pension, PAYE", async () => {
    setupCreateRun({ id: "c3", code: "GB", currency: "GBP", name: "United Kingdom" }, [
      {
        id: "ge1",
        salary_amount: 5000,
        salary_frequency: "monthly",
        salary_currency: "GBP",
        employment_type: "eor",
      },
    ]);

    await service.createPayrollRun("1", "c3", 3, 2026);

    const createCalls = mockDb.create.mock.calls.filter(
      (c: any[]) => c[0] === "global_payroll_items",
    );
    const item = createCalls[0][1];

    // NI: 12% EE, 13.8% ER
    expect(item.social_security_employee).toBe(Math.round(5000 * 0.12));
    expect(item.social_security_employer).toBe(Math.round(5000 * 0.138));
    // Pension: 5% EE, 3% ER
    expect(item.pension_employee).toBe(Math.round(5000 * 0.05));
    expect(item.pension_employer).toBe(Math.round(5000 * 0.03));
    // PAYE: 20%
    expect(item.tax_amount).toBe(Math.round(5000 * 0.2));
  });

  it("should compute Germany (DE) deductions", async () => {
    setupCreateRun({ id: "c4", code: "DE", currency: "EUR", name: "Germany" }, [
      {
        id: "ge1",
        salary_amount: 6000,
        salary_frequency: "monthly",
        salary_currency: "EUR",
        employment_type: "eor",
      },
    ]);

    await service.createPayrollRun("1", "c4", 3, 2026);

    const createCalls = mockDb.create.mock.calls.filter(
      (c: any[]) => c[0] === "global_payroll_items",
    );
    const item = createCalls[0][1];

    // Pension: 9.3% EE/ER
    expect(item.pension_employee).toBe(Math.round(6000 * 0.093));
    // Health: 7.3% EE/ER
    expect(item.health_insurance_employee).toBe(Math.round(6000 * 0.073));
    // Tax: 25%
    expect(item.tax_amount).toBe(Math.round(6000 * 0.25));
  });

  it("should compute UAE (AE) with zero tax", async () => {
    setupCreateRun({ id: "c5", code: "AE", currency: "AED", name: "UAE" }, [
      {
        id: "ge1",
        salary_amount: 20000,
        salary_frequency: "monthly",
        salary_currency: "AED",
        employment_type: "eor",
      },
    ]);

    await service.createPayrollRun("1", "c5", 3, 2026);

    const createCalls = mockDb.create.mock.calls.filter(
      (c: any[]) => c[0] === "global_payroll_items",
    );
    const item = createCalls[0][1];

    expect(item.tax_amount).toBe(0);
  });

  it("should compute Singapore (SG) CPF contributions", async () => {
    setupCreateRun({ id: "c6", code: "SG", currency: "SGD", name: "Singapore" }, [
      {
        id: "ge1",
        salary_amount: 7000,
        salary_frequency: "monthly",
        salary_currency: "SGD",
        employment_type: "eor",
      },
    ]);

    await service.createPayrollRun("1", "c6", 3, 2026);

    const createCalls = mockDb.create.mock.calls.filter(
      (c: any[]) => c[0] === "global_payroll_items",
    );
    const item = createCalls[0][1];

    // CPF: 20% EE, 17% ER
    expect(item.pension_employee).toBe(Math.round(7000 * 0.2));
    expect(item.pension_employer).toBe(Math.round(7000 * 0.17));
    expect(item.tax_amount).toBe(Math.round(7000 * 0.1));
  });

  it("should convert annual salary to monthly", async () => {
    setupCreateRun({ id: "c2", code: "US", currency: "USD", name: "United States" }, [
      {
        id: "ge1",
        salary_amount: 120000, // annual
        salary_frequency: "annual",
        salary_currency: "USD",
        employment_type: "eor",
      },
    ]);

    await service.createPayrollRun("1", "c2", 3, 2026);

    const createCalls = mockDb.create.mock.calls.filter(
      (c: any[]) => c[0] === "global_payroll_items",
    );
    const item = createCalls[0][1];

    // 120000 / 12 = 10000 monthly
    expect(item.gross_salary).toBe(10000);
    expect(item.tax_amount).toBe(Math.round(10000 * 0.22));
  });

  it("should convert biweekly salary to monthly", async () => {
    setupCreateRun({ id: "c2", code: "US", currency: "USD", name: "United States" }, [
      {
        id: "ge1",
        salary_amount: 4000, // biweekly
        salary_frequency: "biweekly",
        salary_currency: "USD",
        employment_type: "eor",
      },
    ]);

    await service.createPayrollRun("1", "c2", 3, 2026);

    const createCalls = mockDb.create.mock.calls.filter(
      (c: any[]) => c[0] === "global_payroll_items",
    );
    const item = createCalls[0][1];

    // 4000 * 26 / 12 = 8667
    const expectedMonthly = Math.round((4000 * 26) / 12);
    expect(item.gross_salary).toBe(expectedMonthly);
  });

  it("should compute net salary = gross - employee deductions", async () => {
    setupCreateRun({ id: "c5", code: "AE", currency: "AED", name: "UAE" }, [
      {
        id: "ge1",
        salary_amount: 20000,
        salary_frequency: "monthly",
        salary_currency: "AED",
        employment_type: "eor",
      },
    ]);

    await service.createPayrollRun("1", "c5", 3, 2026);

    const createCalls = mockDb.create.mock.calls.filter(
      (c: any[]) => c[0] === "global_payroll_items",
    );
    const item = createCalls[0][1];

    // UAE: no tax, no deductions
    expect(item.net_salary).toBe(20000);
    expect(item.total_employer_cost).toBe(20000);
  });

  it("should compute employer cost = gross + employer contributions", async () => {
    setupCreateRun({ id: "c2", code: "US", currency: "USD", name: "United States" }, [
      {
        id: "ge1",
        salary_amount: 10000,
        salary_frequency: "monthly",
        salary_currency: "USD",
        employment_type: "eor",
      },
    ]);

    await service.createPayrollRun("1", "c2", 3, 2026);

    const createCalls = mockDb.create.mock.calls.filter(
      (c: any[]) => c[0] === "global_payroll_items",
    );
    const item = createCalls[0][1];

    const employerContributions =
      item.social_security_employer + item.pension_employer + item.health_insurance_employer;

    expect(item.total_employer_cost).toBe(10000 + employerContributions);
  });

  it("should update run totals after processing all employees", async () => {
    setupCreateRun({ id: "c5", code: "AE", currency: "AED", name: "UAE" }, [
      {
        id: "ge1",
        salary_amount: 20000,
        salary_frequency: "monthly",
        salary_currency: "AED",
        employment_type: "eor",
      },
      {
        id: "ge2",
        salary_amount: 30000,
        salary_frequency: "monthly",
        salary_currency: "AED",
        employment_type: "eor",
      },
    ]);

    await service.createPayrollRun("1", "c5", 3, 2026);

    const updateCalls = mockDb.update.mock.calls.filter(
      (c: any[]) => c[0] === "global_payroll_runs",
    );
    expect(updateCalls).toHaveLength(1);

    const totals = updateCalls[0][2];
    expect(totals.total_gross).toBe(50000);
    expect(totals.total_net).toBe(50000); // UAE: no deductions
  });

  it("should throw 404 when country not found", async () => {
    mockDb.findById.mockResolvedValue(null);
    await expect(service.createPayrollRun("1", "bad-id", 3, 2026)).rejects.toThrow(
      "Country not found",
    );
  });

  it("should throw 409 for duplicate run", async () => {
    mockDb.findById.mockResolvedValue({ id: "c1", code: "IN", currency: "INR", name: "India" });
    mockDb.findOne.mockResolvedValue({ id: "existing", status: "draft" });

    await expect(service.createPayrollRun("1", "c1", 3, 2026)).rejects.toThrow("already exists");
  });

  it("should throw 400 when no active employees found", async () => {
    mockDb.findById.mockResolvedValue({ id: "c1", code: "IN", currency: "INR", name: "India" });
    mockDb.findOne.mockResolvedValue(null);
    mockDb.findMany.mockResolvedValue({ data: [], total: 0 });

    await expect(service.createPayrollRun("1", "c1", 3, 2026)).rejects.toThrow("No active");
  });

  it("should use generic fallback for unknown country codes", async () => {
    setupCreateRun(
      {
        id: "c99",
        code: "ZZ",
        currency: "ZZD",
        name: "Unknown Country",
        has_social_security: true,
        has_pension: true,
        has_health_insurance: true,
      },
      [
        {
          id: "ge1",
          salary_amount: 5000,
          salary_frequency: "monthly",
          salary_currency: "ZZD",
          employment_type: "eor",
        },
      ],
    );

    await service.createPayrollRun("1", "c99", 3, 2026);

    const createCalls = mockDb.create.mock.calls.filter(
      (c: any[]) => c[0] === "global_payroll_items",
    );
    const item = createCalls[0][1];

    // Generic: ss 5%/8%, pension 5%/5%, health 3%/3%, tax 15%
    expect(item.social_security_employee).toBe(Math.round(5000 * 0.05));
    expect(item.social_security_employer).toBe(Math.round(5000 * 0.08));
    expect(item.pension_employee).toBe(Math.round(5000 * 0.05));
    expect(item.health_insurance_employee).toBe(Math.round(5000 * 0.03));
    expect(item.tax_amount).toBe(Math.round(5000 * 0.15));
  });
});

// =============================================================================
// APPROVE / MARK PAID
// =============================================================================

describe("GlobalPayrollService — approvePayrollRun", () => {
  let service: GlobalPayrollService;
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = makeMockDb();
    mockedGetDB.mockReturnValue(mockDb as any);
    service = new GlobalPayrollService();
  });

  it("should approve a draft run", async () => {
    mockDb.findOne.mockResolvedValue({ id: "r1", empcloud_org_id: 1, status: "draft" });

    await service.approvePayrollRun("1", "r1", "42");

    expect(mockDb.update).toHaveBeenCalledWith("global_payroll_runs", "r1", {
      status: "approved",
      approved_by: 42,
    });
  });

  it("should throw if run is already paid", async () => {
    mockDb.findOne.mockResolvedValue({ id: "r1", empcloud_org_id: 1, status: "paid" });
    await expect(service.approvePayrollRun("1", "r1", "admin-1")).rejects.toThrow("Cannot approve");
  });

  it("should throw 404 for missing run", async () => {
    mockDb.findOne.mockResolvedValue(null);
    await expect(service.approvePayrollRun("1", "bad", "admin-1")).rejects.toThrow("not found");
  });
});

describe("GlobalPayrollService — markPayrollRunPaid", () => {
  let service: GlobalPayrollService;
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = makeMockDb();
    mockedGetDB.mockReturnValue(mockDb as any);
    service = new GlobalPayrollService();
  });

  it("should mark approved run as paid", async () => {
    mockDb.findOne.mockResolvedValue({ id: "r1", empcloud_org_id: 1, status: "approved" });

    await service.markPayrollRunPaid("1", "r1");

    expect(mockDb.update).toHaveBeenCalledWith(
      "global_payroll_runs",
      "r1",
      expect.objectContaining({
        status: "paid",
      }),
    );
  });

  it("should throw if run is not approved", async () => {
    mockDb.findOne.mockResolvedValue({ id: "r1", empcloud_org_id: 1, status: "draft" });
    await expect(service.markPayrollRunPaid("1", "r1")).rejects.toThrow("Only approved");
  });
});
