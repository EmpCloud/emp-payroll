import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/adapters", () => ({ getDB: vi.fn() }));
vi.mock("./compliance/india-statutory.service", () => ({
  computePF: vi.fn(),
  computeESI: vi.fn(),
}));

import { ReportsService } from "./reports.service";
import { getDB } from "../db/adapters";
import { computePF, computeESI } from "./compliance/india-statutory.service";

const mockedGetDB = vi.mocked(getDB);
const mockedComputePF = vi.mocked(computePF);
const mockedComputeESI = vi.mocked(computeESI);

function makeMockDb(overrides: Record<string, unknown> = {}) {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findById: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "mock-id" }),
    update: vi.fn().mockResolvedValue({}),
    raw: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function setupRunData(
  mockDb: ReturnType<typeof makeMockDb>,
  payslips: any[],
  employees: Record<string, any>,
  run: any,
  org?: any,
) {
  // findOne for the run
  mockDb.findOne.mockImplementation(async (table: string, filters: any) => {
    if (table === "payroll_runs") return run;
    if (table === "employee_salaries") {
      return {
        components: JSON.stringify([
          { code: "BASIC", monthlyAmount: 25000 },
          { code: "HRA", monthlyAmount: 12500 },
        ]),
      };
    }
    return null;
  });
  mockDb.findMany.mockResolvedValue({ data: payslips, total: payslips.length });
  mockDb.findById.mockImplementation(async (table: string, id: string) => {
    if (table === "employees") return employees[id] || null;
    if (table === "organizations")
      return org || { name: "Test Corp", pf_establishment_code: "PFCODE" };
    return null;
  });
}

// =============================================================================
// PF ECR REPORT
// =============================================================================

describe("ReportsService — generatePFECR", () => {
  let service: ReportsService;
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = makeMockDb();
    mockedGetDB.mockReturnValue(mockDb as any);
    service = new ReportsService();

    mockedComputePF.mockReturnValue({
      employeeId: "e1",
      month: 3,
      year: 2026,
      pfWages: 15000,
      employeeEPF: 1800,
      employerEPF: 551,
      employerEPS: 1250,
      employeeVPF: 0,
      adminCharges: 75,
      edliCharges: 75,
      totalEmployer: 1951,
      totalEmployee: 1800,
    });
  });

  it("should include ECR header with #~# separator", async () => {
    setupRunData(mockDb, [], {}, { id: "run-1", org_id: "1", month: 3, year: 2026 });

    const result = await service.generatePFECR("run-1", "1");
    expect(result.content).toContain("#~#");
    const firstLine = result.content.split("\n")[0];
    expect(firstLine.startsWith("#~#")).toBe(true);
  });

  it("should use #~# as field separator in data lines", async () => {
    const emp1 = {
      id: "e1",
      first_name: "Rahul",
      last_name: "Kumar",
      tax_info: JSON.stringify({ uan: "100123456789" }),
      pf_details: JSON.stringify({ pfNumber: "PF001" }),
    };

    setupRunData(
      mockDb,
      [{ employee_id: "e1", gross_earnings: 50000, month: 3, year: 2026 }],
      { e1: emp1 },
      { id: "run-1", org_id: "1", month: 3, year: 2026 },
    );

    const result = await service.generatePFECR("run-1", "1");
    const dataLine = result.content.split("\n")[1]; // second line = data
    const parts = dataLine.split("#~#");
    expect(parts.length).toBeGreaterThanOrEqual(8);
    expect(parts[0]).toBe("100123456789"); // UAN
    expect(parts[1]).toBe("Rahul Kumar"); // Name
  });

  it("should include PF wages from computePF result", async () => {
    const emp1 = {
      id: "e1",
      first_name: "Test",
      last_name: "User",
      tax_info: JSON.stringify({ uan: "100123456789" }),
      pf_details: null,
    };

    setupRunData(
      mockDb,
      [{ employee_id: "e1", gross_earnings: 50000, month: 3, year: 2026 }],
      { e1: emp1 },
      { id: "run-1", org_id: "1", month: 3, year: 2026 },
    );

    const result = await service.generatePFECR("run-1", "1");
    // PF wages = 15000 (from mock)
    expect(result.content).toContain("15000");
    expect(result.content).toContain("1800"); // employeeEPF
    expect(result.content).toContain("1250"); // employerEPS
  });

  it("should throw 404 when run not found", async () => {
    mockDb.findOne.mockResolvedValue(null);
    await expect(service.generatePFECR("bad-id", "1")).rejects.toThrow("Payroll run not found");
  });
});

// =============================================================================
// ESI RETURN
// =============================================================================

describe("ReportsService — generateESIReturn", () => {
  let service: ReportsService;
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = makeMockDb();
    mockedGetDB.mockReturnValue(mockDb as any);
    service = new ReportsService();
  });

  it("should include CSV header row with expected columns", async () => {
    setupRunData(mockDb, [], {}, { id: "run-1", org_id: "1", month: 3, year: 2026 });

    const result = await service.generateESIReturn("run-1", "1");
    expect(result.content).toContain("IP Number");
    expect(result.content).toContain("Total Wages");
    expect(result.content).toContain("IP Contribution");
  });

  it("should compute ESI contributions via computeESI", async () => {
    mockedComputeESI.mockReturnValue({
      employeeId: "e1",
      month: 3,
      year: 2026,
      esiWages: 18000,
      employeeContribution: 135,
      employerContribution: 585,
      total: 720,
    });

    const emp1 = {
      id: "e1",
      first_name: "Test",
      last_name: "User",
      esi_details: JSON.stringify({ esiNumber: "ESI001" }),
    };

    setupRunData(
      mockDb,
      [{ employee_id: "e1", gross_earnings: 18000, paid_days: 30, month: 3, year: 2026 }],
      { e1: emp1 },
      { id: "run-1", org_id: "1", month: 3, year: 2026 },
    );

    const result = await service.generateESIReturn("run-1", "1");
    expect(result.content).toContain("135");
    expect(result.content).toContain("585");
    expect(result.content).toContain("720");
  });

  it("should skip employees where computeESI returns null (gross > 21000)", async () => {
    mockedComputeESI.mockReturnValue(null);

    const emp1 = {
      id: "e1",
      first_name: "High",
      last_name: "Earner",
      esi_details: null,
    };

    setupRunData(
      mockDb,
      [{ employee_id: "e1", gross_earnings: 30000, paid_days: 30, month: 3, year: 2026 }],
      { e1: emp1 },
      { id: "run-1", org_id: "1", month: 3, year: 2026 },
    );

    const result = await service.generateESIReturn("run-1", "1");
    const lines = result.content.split("\n");
    expect(lines.length).toBe(1); // header only
  });
});

// =============================================================================
// TDS SUMMARY
// =============================================================================

describe("ReportsService — generateTDSSummary", () => {
  let service: ReportsService;
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = makeMockDb();
    mockedGetDB.mockReturnValue(mockDb as any);
    service = new ReportsService();
  });

  it("should extract TDS from payslip deductions", async () => {
    const emp1 = {
      id: "e1",
      first_name: "Test",
      last_name: "User",
      employee_code: "EMP001",
      tax_info: JSON.stringify({ pan: "ABCDE1234F" }),
    };

    setupRunData(
      mockDb,
      [
        {
          employee_id: "e1",
          gross_earnings: 50000,
          deductions: JSON.stringify([
            { code: "EPF", amount: 1800 },
            { code: "TDS", amount: 5000 },
            { code: "PT", amount: 200 },
          ]),
          month: 3,
          year: 2026,
        },
      ],
      { e1: emp1 },
      { id: "run-1", org_id: "1", month: 3, year: 2026 },
    );

    const result = await service.generateTDSSummary("run-1", "1");
    expect(result).toHaveLength(1);
    expect(result[0].tdsDeducted).toBe(5000);
    expect(result[0].pan).toBe("ABCDE1234F");
    expect(result[0].grossSalary).toBe(50000);
  });

  it("should handle missing TDS deduction (return 0)", async () => {
    const emp1 = {
      id: "e1",
      first_name: "Test",
      last_name: "User",
      employee_code: "EMP001",
      tax_info: JSON.stringify({}),
    };

    setupRunData(
      mockDb,
      [
        {
          employee_id: "e1",
          gross_earnings: 25000,
          deductions: JSON.stringify([{ code: "EPF", amount: 1800 }]),
          month: 3,
          year: 2026,
        },
      ],
      { e1: emp1 },
      { id: "run-1", org_id: "1", month: 3, year: 2026 },
    );

    const result = await service.generateTDSSummary("run-1", "1");
    expect(result[0].tdsDeducted).toBe(0);
  });

  it("should filter out null entries (missing employees)", async () => {
    setupRunData(
      mockDb,
      [{ employee_id: "ghost", gross_earnings: 50000, deductions: "[]", month: 3, year: 2026 }],
      {},
      { id: "run-1", org_id: "1", month: 3, year: 2026 },
    );

    const result = await service.generateTDSSummary("run-1", "1");
    expect(result).toHaveLength(0);
  });
});

// =============================================================================
// PT RETURN
// =============================================================================

describe("ReportsService — generatePTReturn", () => {
  let service: ReportsService;
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = makeMockDb();
    mockedGetDB.mockReturnValue(mockDb as any);
    service = new ReportsService();
  });

  it("should include PT header row", async () => {
    setupRunData(mockDb, [], {}, { id: "run-1", org_id: "1", month: 3, year: 2026 });

    const result = await service.generatePTReturn("run-1", "1");
    expect(result.content).toContain("Employee Code");
    expect(result.content).toContain("PT Amount");
  });

  it("should include employees with PT deduction > 0", async () => {
    const emp1 = {
      id: "e1",
      first_name: "Test",
      last_name: "User",
      employee_code: "EMP001",
    };

    setupRunData(
      mockDb,
      [
        {
          employee_id: "e1",
          gross_earnings: 50000,
          deductions: JSON.stringify([{ code: "PT", amount: 200 }]),
          month: 3,
          year: 2026,
        },
      ],
      { e1: emp1 },
      { id: "run-1", org_id: "1", month: 3, year: 2026 },
    );

    const result = await service.generatePTReturn("run-1", "1");
    const lines = result.content.split("\n");
    expect(lines.length).toBe(2); // header + 1 employee
    expect(lines[1]).toContain("EMP001");
    expect(lines[1]).toContain("200");
  });

  it("should skip employees with zero PT", async () => {
    const emp1 = {
      id: "e1",
      first_name: "Test",
      last_name: "User",
      employee_code: "EMP001",
    };

    setupRunData(
      mockDb,
      [
        {
          employee_id: "e1",
          gross_earnings: 10000,
          deductions: JSON.stringify([{ code: "PT", amount: 0 }]),
          month: 3,
          year: 2026,
        },
      ],
      { e1: emp1 },
      { id: "run-1", org_id: "1", month: 3, year: 2026 },
    );

    const result = await service.generatePTReturn("run-1", "1");
    const lines = result.content.split("\n");
    expect(lines.length).toBe(1); // header only
  });
});

// =============================================================================
// TDS CHALLAN
// =============================================================================

describe("ReportsService — generateTDSChallan", () => {
  let service: ReportsService;
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = makeMockDb();
    mockedGetDB.mockReturnValue(mockDb as any);
    service = new ReportsService();
  });

  it("should throw 404 when org not found", async () => {
    mockDb.findById.mockResolvedValue(null);
    await expect(
      service.generateTDSChallan("bad-org", { quarter: 1, financialYear: "2025-2026" }),
    ).rejects.toThrow("Organization not found");
  });

  it("should return correct assessment year", async () => {
    mockDb.findById.mockResolvedValue({ name: "Corp", tan: "T1", pan: "P1" });
    mockDb.findMany.mockResolvedValue({ data: [], total: 0 });

    const result = await service.generateTDSChallan("1", {
      quarter: 1,
      financialYear: "2025-2026",
    });
    expect(result.assessmentYear).toBe("2026-2027");
  });

  it("should aggregate TDS across quarterly runs", async () => {
    mockDb.findById.mockImplementation(async (table: string, id: string) => {
      if (table === "organizations") return { name: "Corp", tan: "T1", pan: "P1" };
      if (table === "employees") {
        return {
          id,
          first_name: "Emp",
          last_name: "One",
          tax_info: JSON.stringify({ pan: "PAN123" }),
        };
      }
      return null;
    });

    // First call: payroll_runs, subsequent: payslips per run
    let callCount = 0;
    mockDb.findMany.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // payroll_runs for the quarter
        return {
          data: [
            { id: "r1", month: 4, year: 2025, status: "paid" },
            { id: "r2", month: 5, year: 2025, status: "paid" },
          ],
          total: 2,
        };
      }
      // payslips for each run
      return {
        data: [
          {
            employee_id: "e1",
            gross_earnings: 50000,
            deductions: JSON.stringify([{ code: "TDS", amount: 5000 }]),
            month: callCount === 2 ? 4 : 5,
            year: 2025,
          },
        ],
        total: 1,
      };
    });

    const result = await service.generateTDSChallan("1", {
      quarter: 1,
      financialYear: "2025-2026",
    });
    expect(result.summary.totalTDSDeducted).toBe(10000); // 5000 + 5000
    expect(result.summary.totalAmountPaid).toBe(100000); // 50000 + 50000
    expect(result.deductees).toHaveLength(1); // same employee aggregated
  });

  it("should return form type 26Q", async () => {
    mockDb.findById.mockResolvedValue({ name: "Corp" });
    mockDb.findMany.mockResolvedValue({ data: [], total: 0 });

    const result = await service.generateTDSChallan("1", {
      quarter: 2,
      financialYear: "2025-2026",
    });
    expect(result.form).toBe("26Q");
  });
});
