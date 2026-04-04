import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/adapters", () => ({ getDB: vi.fn() }));

import { BankFileService } from "./bank-file.service";
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

describe("BankFileService — generateBankFile", () => {
  let service: BankFileService;
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = makeMockDb();
    mockedGetDB.mockReturnValue(mockDb as any);
    service = new BankFileService();
  });

  it("should throw 404 when run not found", async () => {
    mockDb.findOne.mockResolvedValue(null);
    await expect(service.generateBankFile("bad-id", "1")).rejects.toThrow("Payroll run not found");
  });

  it("should throw 400 for draft run status", async () => {
    mockDb.findOne.mockResolvedValue({
      id: "r1",
      org_id: "1",
      status: "draft",
      month: 3,
      year: 2026,
    });
    await expect(service.generateBankFile("r1", "1")).rejects.toThrow("approved/paid");
  });

  it("should allow approved run", async () => {
    mockDb.findOne.mockResolvedValue({
      id: "r1",
      org_id: "1",
      status: "approved",
      month: 3,
      year: 2026,
      total_net: 100000,
    });
    mockDb.findMany.mockResolvedValue({ data: [], total: 0 });
    mockDb.findById.mockResolvedValue({ name: "Test Corp" });

    const result = await service.generateBankFile("r1", "1");
    expect(result.filename).toContain("bank-transfer");
    expect(result.format).toContain("CSV");
  });

  it("should allow paid run", async () => {
    mockDb.findOne.mockResolvedValue({
      id: "r1",
      org_id: "1",
      status: "paid",
      month: 6,
      year: 2026,
      total_net: 200000,
    });
    mockDb.findMany.mockResolvedValue({ data: [], total: 0 });
    mockDb.findById.mockResolvedValue({ name: "Test Corp" });

    const result = await service.generateBankFile("r1", "1");
    expect(result.filename).toContain("PAYJUN2026");
  });

  it("should include batch header line with total count and amount", async () => {
    mockDb.findOne.mockResolvedValue({
      id: "r1",
      org_id: "1",
      status: "approved",
      month: 3,
      year: 2026,
      total_net: 150000,
    });
    mockDb.findMany.mockResolvedValue({
      data: [
        { employee_id: "e1", net_pay: 50000 },
        { employee_id: "e2", net_pay: 100000 },
      ],
      total: 2,
    });
    mockDb.findById.mockImplementation(async (table: string, id: string) => {
      if (table === "organizations") return { name: "Acme Corp" };
      if (table === "employees") {
        return {
          id,
          first_name: id === "e1" ? "Alice" : "Bob",
          last_name: "Smith",
          email: `${id}@test.com`,
          employee_code: id,
          bank_details: JSON.stringify({ accountNumber: "123456", ifscCode: "BANK0001" }),
        };
      }
      return null;
    });

    const result = await service.generateBankFile("r1", "1");
    const lines = result.content.split("\n");

    // First line = header
    expect(lines[0]).toMatch(/^H,/);
    expect(lines[0]).toContain("PAYMAR2026");
    expect(lines[0]).toContain("Acme Corp");
    expect(lines[0]).toContain("2"); // employee count
    expect(lines[0]).toContain("150000"); // total net
  });

  it("should include column headers in second line", async () => {
    mockDb.findOne.mockResolvedValue({
      id: "r1",
      org_id: "1",
      status: "approved",
      month: 3,
      year: 2026,
      total_net: 50000,
    });
    mockDb.findMany.mockResolvedValue({ data: [], total: 0 });
    mockDb.findById.mockResolvedValue({ name: "Corp" });

    const result = await service.generateBankFile("r1", "1");
    const lines = result.content.split("\n");
    expect(lines[1]).toContain("ACCOUNT_NO");
    expect(lines[1]).toContain("IFSC");
    expect(lines[1]).toContain("BENEFICIARY_NAME");
    expect(lines[1]).toContain("NARRATION");
  });

  it("should output employee bank details in CSV format", async () => {
    mockDb.findOne.mockResolvedValue({
      id: "r1",
      org_id: "1",
      status: "approved",
      month: 3,
      year: 2026,
      total_net: 43000,
    });
    mockDb.findMany.mockResolvedValue({
      data: [{ employee_id: "e1", net_pay: 43000 }],
      total: 1,
    });
    mockDb.findById.mockImplementation(async (table: string, id: string) => {
      if (table === "organizations") return { name: "Corp" };
      return {
        id: "e1",
        first_name: "Rahul",
        last_name: "Kumar",
        email: "rahul@test.com",
        employee_code: "EMP001",
        bank_details: JSON.stringify({ accountNumber: "9876543210", ifscCode: "HDFC0001234" }),
      };
    });

    const result = await service.generateBankFile("r1", "1");
    const lines = result.content.split("\n");
    const dataLine = lines[2]; // third line = first employee
    expect(dataLine).toContain("9876543210");
    expect(dataLine).toContain("HDFC0001234");
    expect(dataLine).toContain("Rahul Kumar");
    expect(dataLine).toContain("43000");
    expect(dataLine).toContain("Salary MAR 2026");
  });

  it("should handle string bank_details (JSON string)", async () => {
    mockDb.findOne.mockResolvedValue({
      id: "r1",
      org_id: "1",
      status: "paid",
      month: 1,
      year: 2026,
      total_net: 50000,
    });
    mockDb.findMany.mockResolvedValue({
      data: [{ employee_id: "e1", net_pay: 50000 }],
      total: 1,
    });
    mockDb.findById.mockImplementation(async (table: string) => {
      if (table === "organizations") return { name: "Corp" };
      return {
        id: "e1",
        first_name: "Test",
        last_name: "User",
        email: "test@test.com",
        employee_code: "T1",
        bank_details: '{"accountNumber":"111","ifscCode":"ICIC0001"}',
      };
    });

    const result = await service.generateBankFile("r1", "1");
    expect(result.content).toContain("111");
    expect(result.content).toContain("ICIC0001");
  });

  it("should handle missing bank_details gracefully", async () => {
    mockDb.findOne.mockResolvedValue({
      id: "r1",
      org_id: "1",
      status: "paid",
      month: 1,
      year: 2026,
      total_net: 50000,
    });
    mockDb.findMany.mockResolvedValue({
      data: [{ employee_id: "e1", net_pay: 50000 }],
      total: 1,
    });
    mockDb.findById.mockImplementation(async (table: string) => {
      if (table === "organizations") return { name: "Corp" };
      return {
        id: "e1",
        first_name: "Test",
        last_name: "User",
        email: "test@test.com",
        employee_code: "T1",
        bank_details: null,
      };
    });

    // Should not throw
    const result = await service.generateBankFile("r1", "1");
    expect(result.content).toContain("Test User");
  });

  it("should generate correct narration format", async () => {
    mockDb.findOne.mockResolvedValue({
      id: "r1",
      org_id: "1",
      status: "approved",
      month: 12,
      year: 2025,
      total_net: 50000,
    });
    mockDb.findMany.mockResolvedValue({
      data: [{ employee_id: "e1", net_pay: 50000 }],
      total: 1,
    });
    mockDb.findById.mockImplementation(async (table: string) => {
      if (table === "organizations") return { name: "Corp" };
      return {
        id: "e1",
        first_name: "Test",
        last_name: "User",
        email: "t@t.com",
        employee_code: "T1",
        bank_details: null,
      };
    });

    const result = await service.generateBankFile("r1", "1");
    expect(result.content).toContain("Salary DEC 2025");
  });
});
