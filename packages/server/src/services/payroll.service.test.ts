import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/adapters", () => ({ getDB: vi.fn() }));
vi.mock("../db/empcloud", () => ({
  findUsersByOrgId: vi.fn(),
  findOrgById: vi.fn(),
  getEmpCloudDB: vi.fn(),
}));
vi.mock("../config", () => ({
  config: { cloudHrms: { enabled: false } },
}));
vi.mock("./cloud-hrms.service", () => ({
  getMonthlyAttendance: vi.fn(),
  toLocalAttendanceFormat: vi.fn(),
}));
vi.mock("./compliance/india-statutory.service", () => ({
  computePF: vi.fn(() => ({
    employeeEPF: 1800,
    totalEmployer: 3250,
    totalEmployee: 1800,
  })),
  computeESI: vi.fn(() => null),
  computeProfessionalTax: vi.fn(() => ({ taxAmount: 200 })),
}));
vi.mock("./tax/india-tax.service", () => ({
  computeIncomeTax: vi.fn(() => ({
    monthlyTds: 5000,
    totalTax: 60000,
    taxableIncome: 800000,
  })),
}));

import { PayrollService } from "./payroll.service";
import { getDB } from "../db/adapters";
import { findUsersByOrgId, getEmpCloudDB } from "../db/empcloud";
import { computePF, computeESI } from "./compliance/india-statutory.service";

const mockedGetDB = vi.mocked(getDB);
const mockedFindUsers = vi.mocked(findUsersByOrgId);
const mockedGetEmpCloudDB = vi.mocked(getEmpCloudDB);

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
    deleteMany: vi.fn().mockResolvedValue(undefined),
    raw: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("PayrollService", () => {
  let service: PayrollService;
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = makeMockDb();
    mockedGetDB.mockReturnValue(mockDb as any);
    service = new PayrollService();
  });

  // ── listRuns ──────────────────────────────────────────────────────────

  describe("listRuns", () => {
    it("should return payroll runs for an org", async () => {
      mockDb.findMany.mockResolvedValue({
        data: [{ id: "run-1", month: 3, year: 2026 }],
        total: 1,
      });

      const result = await service.listRuns("1");

      expect(mockDb.findMany).toHaveBeenCalledWith(
        "payroll_runs",
        expect.objectContaining({
          filters: { empcloud_org_id: 1 },
        }),
      );
      expect(result.data).toHaveLength(1);
    });
  });

  // ── createRun ─────────────────────────────────────────────────────────

  describe("createRun", () => {
    it("should create a draft payroll run", async () => {
      mockDb.findOne.mockResolvedValue(null); // no existing run

      const result = await service.createRun("1", "user-1", {
        month: 3,
        year: 2026,
        payDate: "2026-03-31",
      });

      expect(mockDb.create).toHaveBeenCalledWith(
        "payroll_runs",
        expect.objectContaining({
          month: 3,
          year: 2026,
          status: "draft",
          name: "March 2026 Payroll",
        }),
      );
    });

    it("should throw 409 if run already exists for month/year", async () => {
      mockDb.findOne.mockResolvedValue({ id: "existing-run" });

      await expect(
        service.createRun("1", "user-1", { month: 3, year: 2026, payDate: "2026-03-31" }),
      ).rejects.toThrow("already exists");
    });
  });

  // ── computePayroll ────────────────────────────────────────────────────

  describe("computePayroll", () => {
    function setupComputeMocks(employeeCount: number) {
      // getRun
      mockDb.findOne
        .mockResolvedValueOnce({
          id: "run-1",
          empcloud_org_id: 1,
          status: "draft",
          month: 3,
          year: 2026,
        }) // getRun for computePayroll
        .mockResolvedValueOnce({ state: "KA" }); // org settings

      // Setup per-employee mocks
      for (let i = 0; i < employeeCount; i++) {
        mockDb.findOne
          .mockResolvedValueOnce({ pf_details: null, tax_info: null }) // profile
          .mockResolvedValueOnce({
            // salary
            gross_salary: 600000,
            components: JSON.stringify([
              { code: "BASIC", monthlyAmount: 25000 },
              { code: "HRA", monthlyAmount: 12500 },
              { code: "SPECIAL", monthlyAmount: 12500 },
            ]),
            is_active: true,
          })
          .mockResolvedValueOnce(null); // attendance (local fallback)
      }

      // After computation, getRun is called again
      mockDb.findOne.mockResolvedValueOnce({
        id: "run-1",
        empcloud_org_id: 1,
        status: "computed",
        total_gross: 50000,
        total_net: 43000,
      });

      mockedFindUsers.mockResolvedValue(
        Array.from({ length: employeeCount }, (_, i) => ({
          id: i + 100,
          first_name: `Emp${i}`,
          last_name: `Test${i}`,
        })) as any,
      );
    }

    it("should compute payroll and generate payslips for each employee", async () => {
      setupComputeMocks(2);

      const result = await service.computePayroll("run-1", "1");

      // Should create 2 payslips
      const payslipCalls = mockDb.create.mock.calls.filter((c: any[]) => c[0] === "payslips");
      expect(payslipCalls).toHaveLength(2);

      // Should update payroll run with totals
      expect(mockDb.update).toHaveBeenCalledWith(
        "payroll_runs",
        "run-1",
        expect.objectContaining({
          status: "computed",
          employee_count: 2,
        }),
      );
    });

    it("should calculate per-employee employer cost (not cumulative)", async () => {
      setupComputeMocks(2);

      await service.computePayroll("run-1", "1");

      const payslipCalls = mockDb.create.mock.calls.filter((c: any[]) => c[0] === "payslips");

      // Each payslip should have the SAME total_employer_cost (per employee, not cumulative)
      const emp1Cost = payslipCalls[0][1].total_employer_cost;
      const emp2Cost = payslipCalls[1][1].total_employer_cost;

      // Both employees have same salary structure, so employer cost should match
      expect(emp1Cost).toBe(emp2Cost);
      // Employer cost = gross + employeeEmployerContributions (PF totalEmployer = 3250)
      expect(emp1Cost).toBe(50000 + 3250); // gross 50000 + employer PF 3250
    });

    it("should generate payslip with correct earnings and deductions", async () => {
      setupComputeMocks(1);

      await service.computePayroll("run-1", "1");

      const payslipCalls = mockDb.create.mock.calls.filter((c: any[]) => c[0] === "payslips");
      expect(payslipCalls).toHaveLength(1);

      const payslip = payslipCalls[0][1];
      expect(payslip.month).toBe(3);
      expect(payslip.year).toBe(2026);
      expect(payslip.gross_earnings).toBe(50000); // 25000 + 12500 + 12500
      expect(payslip.status).toBe("generated");

      const deductions = JSON.parse(payslip.deductions);
      const deductionCodes = deductions.map((d: any) => d.code);
      expect(deductionCodes).toContain("EPF");
      expect(deductionCodes).toContain("PT");
      expect(deductionCodes).toContain("TDS");
    });

    it("should throw if payroll run is not in draft status", async () => {
      mockDb.findOne.mockResolvedValue({ id: "run-1", empcloud_org_id: 1, status: "computed" });

      await expect(service.computePayroll("run-1", "1")).rejects.toThrow("Only draft");
    });

    it("should skip employees without active salary", async () => {
      mockDb.findOne
        .mockResolvedValueOnce({
          id: "run-1",
          empcloud_org_id: 1,
          status: "draft",
          month: 3,
          year: 2026,
        })
        .mockResolvedValueOnce({ state: "KA" })
        .mockResolvedValueOnce(null) // profile
        .mockResolvedValueOnce(null); // no salary — skip

      // After computation
      mockDb.findOne.mockResolvedValueOnce({ id: "run-1", empcloud_org_id: 1, status: "computed" });

      mockedFindUsers.mockResolvedValue([{ id: 100, first_name: "Emp", last_name: "Test" }] as any);

      await service.computePayroll("run-1", "1");

      const payslipCalls = mockDb.create.mock.calls.filter((c: any[]) => c[0] === "payslips");
      expect(payslipCalls).toHaveLength(0);

      expect(mockDb.update).toHaveBeenCalledWith(
        "payroll_runs",
        "run-1",
        expect.objectContaining({
          employee_count: 0,
        }),
      );
    });

    // #268 — Regression guard: salary structure with no earning components
    // (or all-zero monthlyAmount) MUST NOT generate a payslip with bogus
    // negative net pay. The employee should be skipped and the skip
    // surfaced in the run notes + return value.
    it("should skip employees whose salary structure has no earning components (#268)", async () => {
      // Provide a working empcloud DB stub so the attendance query doesn't
      // explode before reaching the guard. The skip path triggers BEFORE
      // PF/ESI/TDS, but it does run after the attendance lookup, so we
      // need a chainable knex-like mock.
      // The service does two empcloud DB queries:
      //   1) attendance_records: chain ends with `.select(...)` and is awaited
      //      (returning an array → the rows go into `[attRecord]`)
      //   2) leave_applications: chain ends with `.first()` (returning a row)
      // Build a thenable chain so both shapes resolve correctly.
      const attRows = [{ present_days: 0, absent_days: 0, leave_days: 0 }];
      const leaveRow = { paid_leave: 0, unpaid_leave: 0 };
      const queryStub: any = {};
      queryStub.where = vi.fn().mockReturnValue(queryStub);
      queryStub.whereBetween = vi.fn().mockReturnValue(queryStub);
      queryStub.join = vi.fn().mockReturnValue(queryStub);
      queryStub.select = vi.fn().mockReturnValue(queryStub);
      queryStub.first = vi.fn().mockResolvedValue(leaveRow);
      // Make the chain awaitable: `await empcloudDb(...).where(...).select(...)`
      // resolves to the attendance rows array.
      queryStub.then = (resolve: (v: any) => any) => Promise.resolve(attRows).then(resolve);
      const empcloudDbFn: any = vi.fn(() => queryStub);
      empcloudDbFn.raw = vi.fn((s: string) => s);
      mockedGetEmpCloudDB.mockReturnValue(empcloudDbFn);

      mockDb.findOne
        .mockResolvedValueOnce({
          id: "run-1",
          empcloud_org_id: 1,
          status: "draft",
          month: 3,
          year: 2026,
        })
        .mockResolvedValueOnce({ state: "KA" }) // org settings
        .mockResolvedValueOnce({ pf_details: null, tax_info: null }) // profile
        .mockResolvedValueOnce({
          // salary with empty components — the bug shape that broke #268
          gross_salary: 10191667,
          components: JSON.stringify([]),
          is_active: true,
        });

      // After computation
      mockDb.findOne.mockResolvedValueOnce({ id: "run-1", empcloud_org_id: 1, status: "computed" });

      mockedFindUsers.mockResolvedValue([{ id: 100, first_name: "Emp", last_name: "Test" }] as any);

      const result: any = await service.computePayroll("run-1", "1");

      // No payslip should have been created — refusing to run is the fix.
      const payslipCalls = mockDb.create.mock.calls.filter((c: any[]) => c[0] === "payslips");
      expect(payslipCalls).toHaveLength(0);

      // Run state must reflect zero processed employees, not a "successful"
      // run with a giant negative net pay.
      expect(mockDb.update).toHaveBeenCalledWith(
        "payroll_runs",
        "run-1",
        expect.objectContaining({ employee_count: 0 }),
      );

      // Caller should be able to see what got skipped.
      expect(result.skipped).toBeDefined();
      expect(result.skipped[0]).toMatchObject({
        empcloudUserId: 100,
        code: "EMPTY_SALARY_STRUCTURE",
      });
    });
  });

  // ── approveRun ────────────────────────────────────────────────────────

  describe("approveRun", () => {
    it("should approve a computed run", async () => {
      mockDb.findOne.mockResolvedValue({ id: "run-1", empcloud_org_id: 1, status: "computed" });

      await service.approveRun("run-1", "1", "admin-1");

      expect(mockDb.update).toHaveBeenCalledWith(
        "payroll_runs",
        "run-1",
        expect.objectContaining({
          status: "approved",
          approved_by: "admin-1",
        }),
      );
    });

    it("should throw if run is not computed", async () => {
      mockDb.findOne.mockResolvedValue({ id: "run-1", empcloud_org_id: 1, status: "draft" });

      await expect(service.approveRun("run-1", "1", "admin-1")).rejects.toThrow("Only computed");
    });
  });

  // ── markPaid ──────────────────────────────────────────────────────────

  describe("markPaid", () => {
    it("should mark approved run as paid and update payslips", async () => {
      mockDb.findOne.mockResolvedValue({ id: "run-1", empcloud_org_id: 1, status: "approved" });

      await service.markPaid("run-1", "1");

      expect(mockDb.updateMany).toHaveBeenCalledWith(
        "payslips",
        { payroll_run_id: "run-1" },
        { status: "paid" },
      );
      expect(mockDb.update).toHaveBeenCalledWith("payroll_runs", "run-1", { status: "paid" });
    });

    it("should throw if run is not approved", async () => {
      mockDb.findOne.mockResolvedValue({ id: "run-1", empcloud_org_id: 1, status: "computed" });

      await expect(service.markPaid("run-1", "1")).rejects.toThrow("Only approved");
    });
  });

  // ── cancelRun ─────────────────────────────────────────────────────────

  describe("cancelRun", () => {
    it("should cancel a non-paid run and delete payslips", async () => {
      mockDb.findOne.mockResolvedValue({ id: "run-1", empcloud_org_id: 1, status: "computed" });

      await service.cancelRun("run-1", "1");

      expect(mockDb.deleteMany).toHaveBeenCalledWith("payslips", { payroll_run_id: "run-1" });
      expect(mockDb.update).toHaveBeenCalledWith("payroll_runs", "run-1", { status: "cancelled" });
    });

    it("should throw if run is already paid", async () => {
      mockDb.findOne.mockResolvedValue({ id: "run-1", empcloud_org_id: 1, status: "paid" });

      await expect(service.cancelRun("run-1", "1")).rejects.toThrow(
        "Paid payroll runs cannot be cancelled",
      );
    });
  });
});
