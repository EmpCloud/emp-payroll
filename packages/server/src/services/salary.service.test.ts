import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/adapters", () => ({ getDB: vi.fn() }));

import { SalaryService } from "./salary.service";
import { getDB } from "../db/adapters";

const mockedGetDB = vi.mocked(getDB);

function makeMockDb(overrides: Record<string, unknown> = {}) {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findById: vi.fn().mockResolvedValue(null),
    create: vi
      .fn()
      .mockImplementation((_t: string, data: Record<string, unknown>) =>
        Promise.resolve({ id: "mock-id", ...data }),
      ),
    update: vi
      .fn()
      .mockImplementation((_t: string, _id: string, data: Record<string, unknown>) =>
        Promise.resolve(data),
      ),
    updateMany: vi.fn().mockResolvedValue(undefined),
    raw: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("SalaryService", () => {
  let service: SalaryService;
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = makeMockDb();
    mockedGetDB.mockReturnValue(mockDb as any);
    service = new SalaryService();
  });

  // ── listStructures ────────────────────────────────────────────────────

  describe("listStructures", () => {
    it("should return active structures for org", async () => {
      mockDb.findMany.mockResolvedValue({
        data: [{ id: "s1", name: "Standard" }],
        total: 1,
      });

      const result = await service.listStructures("1");

      expect(mockDb.findMany).toHaveBeenCalledWith(
        "salary_structures",
        expect.objectContaining({
          filters: { empcloud_org_id: 1, is_active: true },
        }),
      );
      expect(result.data).toHaveLength(1);
    });
  });

  // ── createStructure ───────────────────────────────────────────────────

  describe("createStructure", () => {
    it("should create structure with components", async () => {
      mockDb.create.mockResolvedValue({ id: "struct-1", name: "CTC Structure" });

      const result = await service.createStructure("1", {
        name: "CTC Structure",
        description: "Standard CTC",
        components: [
          {
            name: "Basic",
            code: "BASIC",
            type: "earning",
            calculationType: "percentage",
            value: 50,
          },
          {
            name: "HRA",
            code: "HRA",
            type: "earning",
            calculationType: "percentage",
            value: 25,
            percentageOf: "BASIC",
          },
        ],
      });

      // Structure created
      expect(mockDb.create).toHaveBeenCalledWith(
        "salary_structures",
        expect.objectContaining({
          name: "CTC Structure",
          empcloud_org_id: 1,
          is_active: true,
        }),
      );

      // Components created (2 components + 1 structure = 3 total create calls)
      expect(mockDb.create).toHaveBeenCalledTimes(3);
      expect(mockDb.create).toHaveBeenCalledWith(
        "salary_components",
        expect.objectContaining({
          code: "BASIC",
          type: "earning",
        }),
      );
      expect(mockDb.create).toHaveBeenCalledWith(
        "salary_components",
        expect.objectContaining({
          code: "HRA",
          percentage_of: "BASIC",
        }),
      );
    });

    it("should create structure without components", async () => {
      mockDb.create.mockResolvedValue({ id: "struct-1" });

      await service.createStructure("1", { name: "Empty Structure" });

      // Only 1 create call (no components)
      expect(mockDb.create).toHaveBeenCalledTimes(1);
    });
  });

  // ── updateStructure ───────────────────────────────────────────────────

  describe("updateStructure", () => {
    it("should update structure fields", async () => {
      mockDb.findOne.mockResolvedValue({ id: "s1", empcloud_org_id: 1 });

      await service.updateStructure("s1", "1", { name: "Updated Name", isDefault: true });

      expect(mockDb.update).toHaveBeenCalledWith(
        "salary_structures",
        "s1",
        expect.objectContaining({
          name: "Updated Name",
          is_default: true,
        }),
      );
    });

    it("should throw NotFoundError when structure does not exist", async () => {
      mockDb.findOne.mockResolvedValue(null);

      await expect(service.updateStructure("nonexistent", "1", { name: "X" })).rejects.toThrow(
        "not found",
      );
    });
  });

  // ── deleteStructure ───────────────────────────────────────────────────

  describe("deleteStructure", () => {
    it("should soft-delete a structure", async () => {
      mockDb.findOne.mockResolvedValue({ id: "s1", empcloud_org_id: 1 });

      const result = await service.deleteStructure("s1", "1");

      expect(mockDb.update).toHaveBeenCalledWith("salary_structures", "s1", { is_active: false });
      expect(result.message).toContain("deactivated");
    });
  });

  // ── getComponents ─────────────────────────────────────────────────────

  describe("getComponents", () => {
    it("should return active components sorted by order", async () => {
      mockDb.findMany.mockResolvedValue({
        data: [
          { id: "c1", code: "BASIC", sort_order: 0 },
          { id: "c2", code: "HRA", sort_order: 1 },
        ],
        total: 2,
      });

      const result = await service.getComponents("s1");

      expect(mockDb.findMany).toHaveBeenCalledWith(
        "salary_components",
        expect.objectContaining({
          filters: { structure_id: "s1", is_active: true },
          sort: { field: "sort_order", order: "asc" },
        }),
      );
      expect(result.data).toHaveLength(2);
    });
  });

  // ── updateComponent ───────────────────────────────────────────────────

  describe("updateComponent", () => {
    it("should update a specific component", async () => {
      mockDb.findOne.mockResolvedValue({ id: "c1", structure_id: "s1" });

      await service.updateComponent("s1", "c1", { name: "Updated Basic" });

      expect(mockDb.update).toHaveBeenCalledWith("salary_components", "c1", {
        name: "Updated Basic",
      });
    });

    it("should throw NotFoundError when component not found", async () => {
      mockDb.findOne.mockResolvedValue(null);

      await expect(service.updateComponent("s1", "nonexistent", { name: "X" })).rejects.toThrow(
        "not found",
      );
    });
  });

  // ── assignToEmployee ──────────────────────────────────────────────────

  describe("assignToEmployee", () => {
    it("should deactivate old salary and create new one", async () => {
      await service.assignToEmployee({
        employeeId: "100",
        structureId: "s1",
        ctc: 600000,
        effectiveFrom: "2026-04-01",
        components: [
          { code: "BASIC", monthlyAmount: 25000 },
          { code: "HRA", monthlyAmount: 12500 },
        ],
      });

      // Should deactivate old salary AND close out its effective window at the
      // day before the new salary's effective_from (2026-04-01 -> 2026-03-31).
      expect(mockDb.updateMany).toHaveBeenCalledWith(
        "employee_salaries",
        { empcloud_user_id: 100, is_active: true },
        { is_active: false, effective_to: "2026-03-31" },
      );

      // Should create new salary with computed gross
      expect(mockDb.create).toHaveBeenCalledWith(
        "employee_salaries",
        expect.objectContaining({
          empcloud_user_id: 100,
          ctc: 600000,
          gross_salary: 450000, // (25000 + 12500) * 12
          is_active: true,
        }),
      );
    });
  });

  // ── getEmployeeSalary ─────────────────────────────────────────────────

  describe("getEmployeeSalary", () => {
    it("should return active salary for employee", async () => {
      mockDb.findOne.mockResolvedValue({
        id: "sal-1",
        empcloud_user_id: 100,
        gross_salary: 600000,
      });

      const result = await service.getEmployeeSalary("100");

      expect(result.gross_salary).toBe(600000);
    });

    it("should throw NotFoundError when no active salary", async () => {
      mockDb.findOne.mockResolvedValue(null);

      await expect(service.getEmployeeSalary("100")).rejects.toThrow("No active salary");
    });
  });
});
