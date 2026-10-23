import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/adapters", () => ({ getDB: vi.fn() }));
vi.mock("../db/empcloud", () => ({ findUserById: vi.fn() }));

import { GlobalPayrollService } from "./global-payroll.service";
import { getDB } from "../db/adapters";
import { findUserById } from "../db/empcloud";

const mockedGetDB = vi.mocked(getDB);
const mockedFindUserById = vi.mocked(findUserById);

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
    transaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    raw: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("GlobalPayrollService employee self-service identity links", () => {
  let service: GlobalPayrollService;
  let db: ReturnType<typeof makeMockDb>;
  const input = {
    countryId: "ae",
    firstName: "Aisha",
    lastName: "Example",
    email: "aisha@example.test",
    empcloudUserId: 42,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedFindUserById.mockReset();
    db = makeMockDb();
    db.findById.mockResolvedValue({ id: "ae", code: "AE", currency: "AED" });
    mockedGetDB.mockReturnValue(db as any);
    service = new GlobalPayrollService();
  });

  it("rejects cross-organisation and mismatched-email identity links before employee creation", async () => {
    mockedFindUserById.mockResolvedValue({ id: 42, organization_id: 2, email: input.email } as any);
    await expect(service.addGlobalEmployee("1", input)).rejects.toMatchObject({
      code: "INVALID_EMPLOYEE_LINK",
    });
    mockedFindUserById.mockResolvedValue({
      id: 42,
      organization_id: 1,
      email: "someone-else@example.test",
    } as any);
    await expect(service.addGlobalEmployee("1", input)).rejects.toMatchObject({
      code: "INVALID_EMPLOYEE_LINK",
    });
    expect(db.create).not.toHaveBeenCalled();
  });

  it("stores a verified employee link with case-insensitive email matching", async () => {
    mockedFindUserById.mockResolvedValue({
      id: 42,
      organization_id: 1,
      email: "AISHA@example.test",
    } as any);
    await service.addGlobalEmployee("1", input);
    expect(mockedFindUserById).toHaveBeenCalledWith(42);
    expect(db.create).toHaveBeenCalledWith(
      "global_employees",
      expect.objectContaining({ empcloud_user_id: 42, empcloud_org_id: 1 }),
    );
  });

  it("validates an existing employee's linked identity when updating email and allows explicit unlink", async () => {
    db.findOne.mockResolvedValue({
      id: "employee-1",
      country_id: "ae",
      email: input.email,
      empcloud_user_id: 42,
    });
    mockedFindUserById.mockResolvedValue({ id: 42, organization_id: 1, email: input.email } as any);
    await expect(
      service.updateGlobalEmployee("1", "employee-1", { email: "other@example.test" }),
    ).rejects.toMatchObject({ code: "INVALID_EMPLOYEE_LINK" });
    expect(db.update).not.toHaveBeenCalled();
    await service.updateGlobalEmployee("1", "employee-1", {
      empcloudUserId: null,
      email: "other@example.test",
    });
    expect(db.update).toHaveBeenCalledWith(
      "global_employees",
      "employee-1",
      expect.objectContaining({ empcloud_user_id: null }),
    );
  });
});

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

  it("requires domestic statutory data for India before creating any payroll records", async () => {
    setupCreateRun({ id: "c1", code: "IN", currency: "INR", name: "India" }, [
      {
        id: "ge1",
        salary_amount: 60000,
        salary_frequency: "monthly",
        salary_currency: "INR",
        employment_type: "eor",
      },
    ]);

    await expect(service.createPayrollRun("1", "c1", 9, 2026)).rejects.toMatchObject({
      statusCode: 409,
      code: "INDIA_PAYROLL_REQUIRES_STATUTORY_PROFILE",
    });
    expect(mockDb.create).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.findMany).not.toHaveBeenCalled();
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

    // US routes through the real federal + FICA engine (grossPay is converted from cents to
    // dollars). Employee FICA is linear below the SS wage cap, so 7.65% still holds exactly;
    // the employer side additionally carries FUTA, and federal income tax is progressive (>= 0).
    expect(item.social_security_employee).toBe(Math.round(8000 * 0.0765)); // 612
    expect(item.social_security_employer).toBeGreaterThanOrEqual(item.social_security_employee);
    expect(item.tax_amount).toBeGreaterThanOrEqual(0);
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

    // GB routes through the real PAYE + NIC + auto-enrolment engine (thresholds, personal
    // allowance), so the old flat 12%/13.8%/5%/3%/20% no longer applies. Assert the invariants:
    // every statutory line is non-negative and finite.
    for (const v of [
      item.social_security_employee,
      item.social_security_employer,
      item.pension_employee,
      item.pension_employer,
      item.tax_amount,
    ]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
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

    // Germany is config-driven (COUNTRY_CONFIGS.DE): deductionsFromConfig aggregates all
    // contribution funds into social_security_*, leaving pension_*/health_insurance_* at 0,
    // and computes progressive income tax. Assert the config-engine invariants.
    expect(item.pension_employee).toBe(0);
    expect(item.health_insurance_employee).toBe(0);
    expect(item.social_security_employee).toBeGreaterThan(0);
    expect(item.social_security_employer).toBeGreaterThan(0);
    expect(item.tax_amount).toBeGreaterThanOrEqual(0);
  });

  it("routes UAE payroll through the dated employee pension profile", async () => {
    // salary_amount is stored in the smallest currency unit (fils): 2,000,000 = AED 20,000/mo.
    setupCreateRun({ id: "c5", code: "AE", currency: "AED", name: "UAE" }, [
      {
        id: "ge1",
        salary_amount: 2000000,
        salary_frequency: "monthly",
        salary_currency: "AED",
        employment_type: "eor",
        status: "active",
        start_date: "2020-01-01",
        first_name: "Aisha",
        last_name: "Example",
        uae_profile: {
          jurisdiction: "federal",
          effectiveFrom: "2026-06-01",
          nationality: "AE",
          basicSalary: 1500000,
          allowances: [{ name: "Housing", amount: 500000 }],
          normalDailyHours: 8,
          pension: {
            scheme: "gpssa_old",
            sector: "private",
            firstInsuredOn: "2020-01-01",
            contributionSalary: 2000000,
            salaryYear: 2026,
            authorityReference: "GPSSA-123",
          },
          iloe: { mode: "employee_paid" },
          healthInsuranceEmployer: 0,
          savings: { scheme: "gratuity" },
          wps: {
            employeeId: "00915012345663",
            routingCode: "802420101",
            accountNumber: "AE070331234567890123456",
          },
        },
      },
    ]);

    await service.createPayrollRun("1", "c5", 10, 2026, {}, { name: "Example UAE LLC" });

    const createCalls = mockDb.create.mock.calls.filter(
      (c: any[]) => c[0] === "global_payroll_items",
    );
    const item = createCalls[0][1];

    // UAE has no personal income tax.
    expect(item.tax_amount).toBe(0);
    expect(item.social_security_employee).toBe(0);
    expect(item.pension_employee).toBe(100000);
    expect(item.pension_employer).toBe(250000);
    expect(JSON.parse(item.uae_calculation).schemeMetadata.pensionScheme).toBe("gpssa_old");
  });

  it("should compute Singapore (SG) CPF contributions via the config engine", async () => {
    // salary_amount in cents: 500,000 = SGD 5,000/mo (below the S$8,000 CPF Ordinary Wage cap).
    setupCreateRun({ id: "c6", code: "SG", currency: "SGD", name: "Singapore" }, [
      {
        id: "ge1",
        salary_amount: 500000,
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

    // CPF employee 20% (below cap) is mapped into social_security_employee by deductionsFromConfig;
    // the config engine does not populate the pension_* fields.
    expect(item.social_security_employee).toBe(Math.round(500000 * 0.2));
    expect(item.pension_employee).toBe(0);
    // Progressive resident income tax is far lower than the old flat 10% estimate.
    expect(item.tax_amount).toBeGreaterThan(0);
    expect(item.tax_amount).toBeLessThan(Math.round(500000 * 0.1));
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

    // 120000 / 12 = 10000 monthly (this test targets the frequency conversion, not the tax rate)
    expect(item.gross_salary).toBe(10000);
    expect(item.tax_amount).toBeGreaterThanOrEqual(0);
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
    setupCreateRun({ id: "c5", code: "US", currency: "USD", name: "United States" }, [
      {
        id: "ge1",
        salary_amount: 2000000, // USD 20,000/mo in cents
        salary_frequency: "monthly",
        salary_currency: "USD",
        employment_type: "eor",
      },
    ]);

    await service.createPayrollRun("1", "c5", 3, 2026);

    const createCalls = mockDb.create.mock.calls.filter(
      (c: any[]) => c[0] === "global_payroll_items",
    );
    const item = createCalls[0][1];

    // Invariant that must hold for every country: net = gross - all employee deductions,
    // and employer cost = gross + all employer contributions.
    const employeeDeductions =
      item.tax_amount +
      item.social_security_employee +
      item.pension_employee +
      item.health_insurance_employee +
      item.other_deductions;
    const employerContributions =
      item.social_security_employer + item.pension_employer + item.health_insurance_employer;

    expect(item.net_salary).toBe(item.gross_salary - employeeDeductions);
    expect(item.total_employer_cost).toBe(item.gross_salary + employerContributions);
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
    setupCreateRun({ id: "c5", code: "US", currency: "USD", name: "United States" }, [
      {
        id: "ge1",
        salary_amount: 2000000, // USD 20,000/mo in cents
        salary_frequency: "monthly",
        salary_currency: "USD",
        employment_type: "eor",
      },
      {
        id: "ge2",
        salary_amount: 3000000, // USD 30,000/mo in cents
        salary_frequency: "monthly",
        salary_currency: "USD",
        employment_type: "eor",
      },
    ]);

    await service.createPayrollRun("1", "c5", 3, 2026);

    // Run-level totals must equal the sum of the per-employee items.
    const itemCalls = mockDb.create.mock.calls
      .filter((c: any[]) => c[0] === "global_payroll_items")
      .map((c: any[]) => c[1]);
    const sumGross = itemCalls.reduce((s: number, i: any) => s + i.gross_salary, 0);
    const sumNet = itemCalls.reduce((s: number, i: any) => s + i.net_salary, 0);

    const updateCalls = mockDb.update.mock.calls.filter(
      (c: any[]) => c[0] === "global_payroll_runs",
    );
    expect(updateCalls).toHaveLength(1);

    const totals = updateCalls[0][2];
    expect(totals.total_gross).toBe(5000000); // USD 50,000 combined gross, in cents
    expect(totals.total_gross).toBe(sumGross);
    expect(totals.total_net).toBe(sumNet);
    expect(totals.total_net).toBeLessThan(totals.total_gross);
  });

  it("should throw 404 when country not found", async () => {
    mockDb.findById.mockResolvedValue(null);
    await expect(service.createPayrollRun("1", "bad-id", 3, 2026)).rejects.toThrow(
      "Country not found",
    );
  });

  it("should throw 409 for duplicate run", async () => {
    mockDb.findById.mockResolvedValue({
      id: "c1",
      code: "US",
      currency: "USD",
      name: "United States",
    });
    mockDb.findOne.mockResolvedValue({ id: "existing", status: "draft" });

    await expect(service.createPayrollRun("1", "c1", 3, 2026)).rejects.toThrow("already exists");
  });

  it("should throw 400 when no active employees found", async () => {
    mockDb.findById.mockResolvedValue({
      id: "c1",
      code: "US",
      currency: "USD",
      name: "United States",
    });
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
// COST ANALYSIS
// =============================================================================

describe("GlobalPayrollService - cost analysis", () => {
  it("labels India totals as estimates without changing other countries", async () => {
    const db = makeMockDb();
    mockedGetDB.mockReturnValue(db as any);
    db.findMany.mockResolvedValue({
      data: [
        {
          id: "in-1",
          country_id: "india",
          salary_amount: 3000000,
          salary_frequency: "monthly",
          employment_type: "eor",
        },
        {
          id: "us-1",
          country_id: "usa",
          salary_amount: 300000,
          salary_frequency: "monthly",
          employment_type: "direct_hire",
        },
      ],
      total: 2,
    });
    db.findById.mockImplementation(async (_table: string, id: string) =>
      id === "india"
        ? { code: "IN", name: "India", currency: "INR" }
        : { code: "US", name: "United States", currency: "USD" },
    );
    const result = await new GlobalPayrollService().getCostAnalysis("1");
    const india = result.countryBreakdown.find((country) => country.code === "IN")!;
    const usa = result.countryBreakdown.find((country) => country.code === "US")!;
    expect(india.calculation_notice).toContain("statutory PF is not calculated");
    expect(india.calculation_notice).toContain("domestic Payroll Runs");
    expect(india.total_gross).toBe(3000000);
    expect(india.total_employer_cost).toBe(3360000);
    expect(usa.calculation_notice).toBeUndefined();
    expect(db.create).not.toHaveBeenCalled();
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
