import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/adapters", () => ({ getDB: vi.fn() }));
vi.mock("./pf-ecr.service", () => ({ generatePFECRFile: vi.fn() }));

import { generatePFECRFile } from "./pf-ecr.service";

import { GovtFormatsService } from "./govt-formats.service";
import { getDB } from "../db/adapters";

const mockedGetDB = vi.mocked(getDB);

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

// =============================================================================
// EPFO ECR FORMAT
// =============================================================================

describe("GovtFormatsService - generateEPFOFile", () => {
  it("uses the same ECR content and metadata with the EPFO filename", async () => {
    const db = makeMockDb();
    mockedGetDB.mockReturnValue(db as any);
    const file = {
      filename: "PF-ECR-SEP-2026.txt",
      content: "saved-ecr",
      dueDate: "2026-10-31",
      summary: {},
    };
    vi.mocked(generatePFECRFile).mockResolvedValue(file as any);
    const result = await new GovtFormatsService().generateEPFOFile("run-1", "1");
    expect(generatePFECRFile).toHaveBeenCalledWith(db, "run-1", "1");
    expect(result).toEqual({ ...file, filename: "EPFO-ECR-SEP-2026.txt" });
  });
});

// =============================================================================
// ESIC RETURN FORMAT
// =============================================================================

describe("GovtFormatsService — generateESICReturn", () => {
  let service: GovtFormatsService;
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = makeMockDb();
    mockedGetDB.mockReturnValue(mockDb as any);
    service = new GovtFormatsService();
  });

  function setupRunData(payslips: any[], employees: Record<string, any>, run: any) {
    mockDb.findOne.mockResolvedValue(run);
    mockDb.findMany.mockResolvedValue({ data: payslips, total: payslips.length });
    mockDb.findById.mockImplementation(async (table: string, id: string) => {
      if (table === "employees") return employees[id] || null;
      if (table === "organizations") return { name: "Test Corp" };
      return null;
    });
  }

  it("should include CSV header row", async () => {
    setupRunData([], {}, { id: "run-1", org_id: "1", month: 3, year: 2026 });

    const result = await service.generateESICReturn("run-1", "1");
    const firstLine = result.content.split("\n")[0];
    expect(firstLine).toContain("IP Number");
    expect(firstLine).toContain("Total Wages");
  });

  it("should compute employee ESI at 0.75% of gross", async () => {
    const emp1 = {
      id: "e1",
      first_name: "Test",
      last_name: "User",
      employee_code: "EMP001",
    };

    setupRunData(
      [{ employee_id: "e1", gross_earnings: 20000, paid_days: 30, month: 3, year: 2026 }],
      { e1: emp1 },
      { id: "run-1", org_id: "1", month: 3, year: 2026 },
    );

    const result = await service.generateESICReturn("run-1", "1");
    const lines = result.content.split("\n");
    expect(lines.length).toBe(2); // header + 1 employee
    // EE = 0.75% of 20000 = 150
    expect(lines[1]).toContain("150.00");
  });

  it("should compute employer ESI at 3.25% of gross", async () => {
    const emp1 = {
      id: "e1",
      first_name: "Test",
      last_name: "User",
      employee_code: "EMP001",
    };

    setupRunData(
      [{ employee_id: "e1", gross_earnings: 20000, paid_days: 30, month: 3, year: 2026 }],
      { e1: emp1 },
      { id: "run-1", org_id: "1", month: 3, year: 2026 },
    );

    const result = await service.generateESICReturn("run-1", "1");
    const lines = result.content.split("\n");
    // ER = 3.25% of 20000 = 650
    expect(lines[1]).toContain("650.00");
  });

  it("should skip employees with gross > 21000", async () => {
    const emp1 = {
      id: "e1",
      first_name: "High",
      last_name: "Earner",
      employee_code: "EMP002",
    };

    setupRunData(
      [{ employee_id: "e1", gross_earnings: 25000, paid_days: 30, month: 3, year: 2026 }],
      { e1: emp1 },
      { id: "run-1", org_id: "1", month: 3, year: 2026 },
    );

    const result = await service.generateESICReturn("run-1", "1");
    const lines = result.content.split("\n");
    expect(lines.length).toBe(1); // header only
  });

  it("should name the file with month and year", async () => {
    setupRunData([], {}, { id: "run-1", org_id: "1", month: 9, year: 2025 });

    const result = await service.generateESICReturn("run-1", "1");
    expect(result.filename).toBe("ESIC-Return-SEP-2025.csv");
  });
});

// =============================================================================
// FORM 24Q
// =============================================================================

describe("GovtFormatsService — generateForm24Q", () => {
  let service: GovtFormatsService;
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = makeMockDb();
    mockedGetDB.mockReturnValue(mockDb as any);
    service = new GovtFormatsService();
  });

  it("should throw 404 when org not found", async () => {
    mockDb.findById.mockResolvedValue(null);
    await expect(
      service.generateForm24Q("bad-org", { quarter: 1, financialYear: "2025-2026" }),
    ).rejects.toThrow("Organization not found");
  });

  it("should include header with org name, TAN, PAN", async () => {
    mockDb.findById.mockResolvedValue({ name: "Acme Corp", tan: "TAN123", pan: "PAN456" });
    mockDb.findMany.mockResolvedValue({ data: [], total: 0 });

    const result = await service.generateForm24Q("1", { quarter: 1, financialYear: "2025-2026" });
    expect(result.content).toContain("Acme Corp");
    expect(result.content).toContain("TAN123");
    expect(result.content).toContain("PAN456");
    expect(result.content).toContain("Q1");
  });

  it("should use correct months for each quarter", async () => {
    mockDb.findById.mockResolvedValue({ name: "Corp" });
    mockDb.findMany.mockResolvedValue({ data: [], total: 0 });

    const q4 = await service.generateForm24Q("1", { quarter: 4, financialYear: "2025-2026" });
    expect(q4.filename).toContain("Q4");
    expect(q4.content).toContain("Q4");
  });

  it("should output CSV format with column headers", async () => {
    mockDb.findById.mockResolvedValue({ name: "Corp" });
    mockDb.findMany.mockResolvedValue({ data: [], total: 0 });

    const result = await service.generateForm24Q("1", { quarter: 1, financialYear: "2025-2026" });
    expect(result.content).toContain("Employee PAN,Employee Name,Amount Paid,TDS Deducted");
    expect(result.filename).toMatch(/\.csv$/);
  });
});
