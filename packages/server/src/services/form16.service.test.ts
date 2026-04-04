import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/adapters", () => ({ getDB: vi.fn() }));

import { Form16Service } from "./form16.service";
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

describe("Form16Service — generateHTML", () => {
  let service: Form16Service;
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = makeMockDb();
    mockedGetDB.mockReturnValue(mockDb as any);
    service = new Form16Service();
  });

  it("should throw 404 when employee not found", async () => {
    mockDb.findById.mockResolvedValue(null);
    await expect(service.generateHTML("bad-id")).rejects.toThrow("Employee not found");
  });

  it("should generate valid HTML with Form 16 title", async () => {
    mockDb.findById.mockImplementation(async (table: string, id: string) => {
      if (table === "employees") {
        return {
          id: "e1",
          first_name: "Rahul",
          last_name: "Kumar",
          employee_code: "EMP001",
          org_id: "1",
          tax_info: JSON.stringify({ pan: "ABCDE1234F" }),
          pf_details: null,
        };
      }
      if (table === "organizations") {
        return { name: "Acme Corp", legal_name: "Acme Corp Pvt Ltd", tan: "TAN123", pan: "PAN456" };
      }
      return null;
    });
    mockDb.findMany.mockResolvedValue({ data: [], total: 0 });
    mockDb.findOne.mockResolvedValue(null);

    const html = await service.generateHTML("e1", "2025-2026");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("FORM No. 16");
    expect(html).toContain("Rahul Kumar");
    expect(html).toContain("ABCDE1234F");
    expect(html).toContain("Acme Corp Pvt Ltd");
    expect(html).toContain("TAN123");
  });

  it("should filter payslips correctly for FY (Apr start year to Mar end year)", async () => {
    mockDb.findById.mockImplementation(async (table: string) => {
      if (table === "employees") {
        return {
          id: "e1",
          first_name: "Test",
          last_name: "User",
          employee_code: "T1",
          org_id: "1",
          tax_info: null,
          pf_details: null,
        };
      }
      if (table === "organizations") return { name: "Corp" };
      return null;
    });

    // Payslips spanning FY 2025-2026: Apr 2025 to Mar 2026
    const payslips = [
      { employee_id: "e1", month: 3, year: 2025, gross_earnings: 50000, deductions: "[]" }, // Mar 2025 = previous FY
      { employee_id: "e1", month: 4, year: 2025, gross_earnings: 50000, deductions: "[]" }, // Apr 2025 = this FY
      { employee_id: "e1", month: 12, year: 2025, gross_earnings: 50000, deductions: "[]" }, // Dec 2025 = this FY
      { employee_id: "e1", month: 3, year: 2026, gross_earnings: 50000, deductions: "[]" }, // Mar 2026 = this FY
      { employee_id: "e1", month: 4, year: 2026, gross_earnings: 50000, deductions: "[]" }, // Apr 2026 = next FY
    ];
    mockDb.findMany.mockResolvedValue({ data: payslips, total: payslips.length });
    mockDb.findOne.mockResolvedValue(null);

    const html = await service.generateHTML("e1", "2025-2026");
    // Should include 3 payslips (Apr 2025, Dec 2025, Mar 2026) = 150000 total
    // The FY filter: (year=2025 && month>=4) || (year=2026 && month<=3)
    expect(html).toContain("₹1,50,000"); // total gross in INR format
  });

  it("should aggregate TDS across all FY payslips", async () => {
    mockDb.findById.mockImplementation(async (table: string) => {
      if (table === "employees") {
        return {
          id: "e1",
          first_name: "Test",
          last_name: "User",
          employee_code: "T1",
          org_id: "1",
          tax_info: null,
          pf_details: null,
        };
      }
      if (table === "organizations") return { name: "Corp" };
      return null;
    });

    const payslips = [
      {
        employee_id: "e1",
        month: 4,
        year: 2025,
        gross_earnings: 80000,
        deductions: JSON.stringify([{ code: "TDS", amount: 8000 }]),
      },
      {
        employee_id: "e1",
        month: 5,
        year: 2025,
        gross_earnings: 80000,
        deductions: JSON.stringify([{ code: "TDS", amount: 8000 }]),
      },
    ];
    mockDb.findMany.mockResolvedValue({ data: payslips, total: 2 });
    mockDb.findOne.mockResolvedValue(null);

    const html = await service.generateHTML("e1", "2025-2026");
    // Total TDS = 16000
    expect(html).toContain("₹16,000");
  });

  it("should include monthly breakdown table rows", async () => {
    mockDb.findById.mockImplementation(async (table: string) => {
      if (table === "employees") {
        return {
          id: "e1",
          first_name: "Test",
          last_name: "User",
          employee_code: "T1",
          org_id: "1",
          tax_info: null,
          pf_details: null,
        };
      }
      if (table === "organizations") return { name: "Corp" };
      return null;
    });

    const payslips = [
      {
        employee_id: "e1",
        month: 7,
        year: 2025,
        gross_earnings: 60000,
        deductions: JSON.stringify([{ code: "TDS", amount: 5000 }]),
      },
    ];
    mockDb.findMany.mockResolvedValue({ data: payslips, total: 1 });
    mockDb.findOne.mockResolvedValue(null);

    const html = await service.generateHTML("e1", "2025-2026");
    expect(html).toContain("Jul 2025");
    expect(html).toContain("Monthly Salary");
  });

  it("should include quarterly TDS breakdown", async () => {
    mockDb.findById.mockImplementation(async (table: string) => {
      if (table === "employees") {
        return {
          id: "e1",
          first_name: "Test",
          last_name: "User",
          employee_code: "T1",
          org_id: "1",
          tax_info: null,
          pf_details: null,
        };
      }
      if (table === "organizations") return { name: "Corp" };
      return null;
    });

    mockDb.findMany.mockResolvedValue({ data: [], total: 0 });
    mockDb.findOne.mockResolvedValue(null);

    const html = await service.generateHTML("e1", "2025-2026");
    expect(html).toContain("Q1 (Apr-Jun 2025)");
    expect(html).toContain("Q2 (Jul-Sep 2025)");
    expect(html).toContain("Q3 (Oct-Dec 2025)");
    expect(html).toContain("Q4 (Jan-Mar 2026)");
  });

  it("should include Part A and Part B sections", async () => {
    mockDb.findById.mockImplementation(async (table: string) => {
      if (table === "employees") {
        return {
          id: "e1",
          first_name: "Test",
          last_name: "User",
          employee_code: "T1",
          org_id: "1",
          tax_info: null,
          pf_details: null,
        };
      }
      if (table === "organizations") return { name: "Corp" };
      return null;
    });

    mockDb.findMany.mockResolvedValue({ data: [], total: 0 });
    mockDb.findOne.mockResolvedValue(null);

    const html = await service.generateHTML("e1", "2025-2026");
    expect(html).toContain("PART A");
    expect(html).toContain("PART B");
  });

  it("should show standard deduction of 75000", async () => {
    mockDb.findById.mockImplementation(async (table: string) => {
      if (table === "employees") {
        return {
          id: "e1",
          first_name: "Test",
          last_name: "User",
          employee_code: "T1",
          org_id: "1",
          tax_info: null,
          pf_details: null,
        };
      }
      if (table === "organizations") return { name: "Corp" };
      return null;
    });

    mockDb.findMany.mockResolvedValue({ data: [], total: 0 });
    mockDb.findOne.mockResolvedValue(null);

    const html = await service.generateHTML("e1", "2025-2026");
    expect(html).toContain("Standard Deduction");
    expect(html).toContain("₹75,000");
  });

  it("should include assessment year derived from FY", async () => {
    mockDb.findById.mockImplementation(async (table: string) => {
      if (table === "employees") {
        return {
          id: "e1",
          first_name: "Test",
          last_name: "User",
          employee_code: "T1",
          org_id: "1",
          tax_info: null,
          pf_details: null,
        };
      }
      if (table === "organizations") return { name: "Corp" };
      return null;
    });

    mockDb.findMany.mockResolvedValue({ data: [], total: 0 });
    mockDb.findOne.mockResolvedValue(null);

    const html = await service.generateHTML("e1", "2025-2026");
    // Assessment year = fyEnd - (fyEnd+1) = 2026-2027
    expect(html).toContain("2026-2027");
  });

  it("should include tax computation details when available", async () => {
    mockDb.findById.mockImplementation(async (table: string) => {
      if (table === "employees") {
        return {
          id: "e1",
          first_name: "Test",
          last_name: "User",
          employee_code: "T1",
          org_id: "1",
          tax_info: null,
          pf_details: null,
        };
      }
      if (table === "organizations") return { name: "Corp" };
      return null;
    });

    mockDb.findMany.mockResolvedValue({ data: [], total: 0 });
    // tax_computations found
    mockDb.findOne.mockImplementation(async (table: string) => {
      if (table === "tax_computations") {
        return {
          total_deductions: 200000,
          taxable_income: 800000,
          tax_on_income: 53180,
          surcharge: 0,
          health_and_education_cess: 2127,
          total_tax: 55307,
        };
      }
      return null;
    });

    const html = await service.generateHTML("e1", "2025-2026");
    expect(html).toContain("Surcharge");
    expect(html).toContain("Education Cess");
    expect(html).toContain("Total Tax Liability");
  });
});
