import { beforeEach, describe, expect, it, vi } from "vitest";
const context = vi.hoisted(() => vi.fn());
vi.mock("./uae/uae-exit.service", () => ({
  UaeExitService: class {
    context = context;
  },
}));
vi.mock("../db/adapters", () => ({ getDB: vi.fn() }));
vi.mock("../db/empcloud", () => ({
  getEmpCloudDB: vi.fn(() => {
    throw new Error("No live EmpCloud calls");
  }),
  findUserById: vi.fn(),
}));
vi.mock("../utils/logger", () => ({ logger: { error: vi.fn() } }));
import { getDB } from "../db/adapters";
import { calculateFnF, updateExit } from "./exit.service";

describe("generic exit endpoints enforce UAE settlement evidence", () => {
  const exit = {
    id: "exit-1",
    org_id: 1,
    employee_id: 10,
    status: "initiated",
    last_working_date: "2026-10-20",
  };
  let db: {
    findOne: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    raw: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    vi.clearAllMocks();
    db = {
      findOne: vi.fn().mockResolvedValue(exit),
      updateMany: vi.fn().mockResolvedValue(1),
      raw: vi.fn().mockResolvedValue([[exit]]),
    };
    vi.mocked(getDB).mockReturnValue(db as any);
    context.mockResolvedValue({ isUae: true, fnfPaid: false, employees: [] });
  });
  it.each([
    "fnf_calculated",
    "fnf_paid",
    "pending_salary",
    "leave_encashment",
    "gratuity",
    "bonus_due",
    "deductions",
    "fnf_total",
  ])("blocks manual %s even when the UI sends the old endpoint", async (field) => {
    await expect(updateExit("exit-1", 1, { [field]: 1 })).rejects.toMatchObject({
      code: "UAE_SETTLEMENT_EVIDENCE_REQUIRED",
    });
    expect(db.updateMany).not.toHaveBeenCalled();
  });
  it.each(["completed", "fnf_processed"])(
    "blocks %s until approved settlement has full payment evidence",
    async (status) => {
      await expect(updateExit("exit-1", 1, { status })).rejects.toMatchObject({
        code: "UAE_SETTLEMENT_UNPAID",
      });
      expect(db.updateMany).not.toHaveBeenCalled();
    },
  );
  it("allows completion after the UAE service confirms actual payment", async () => {
    context.mockResolvedValue({ isUae: true, fnfPaid: true, employees: [] });
    expect(await updateExit("exit-1", 1, { status: "completed" })).toBe(true);
    expect(db.updateMany).toHaveBeenCalledWith(
      "employee_exits",
      { id: "exit-1", org_id: 1 },
      expect.objectContaining({ status: "completed" }),
    );
  });
  it("blocks changing the termination date of locked payroll", async () => {
    context.mockResolvedValue({
      isUae: true,
      fnfPaid: false,
      employees: [{ run: { status: "locked" } }],
    });
    await expect(
      updateExit("exit-1", 1, { last_working_date: "2026-10-21" }),
    ).rejects.toMatchObject({ code: "IMMUTABLE_UAE_SETTLEMENT" });
    expect(db.updateMany).not.toHaveBeenCalled();
  });
  it("never invokes the India approximation for a linked UAE exit", async () => {
    await expect(calculateFnF("exit-1", 1)).rejects.toMatchObject({
      code: "UAE_SETTLEMENT_INPUTS_REQUIRED",
    });
    expect(db.raw).toHaveBeenCalledTimes(1);
    expect(db.raw.mock.calls[0][0]).toContain("employee_exits");
    expect(db.updateMany).not.toHaveBeenCalled();
  });
  it("retains the existing non-UAE calculation path", async () => {
    context.mockResolvedValue({ isUae: false, fnfPaid: false, employees: [] });
    db.raw
      .mockResolvedValueOnce([[exit]])
      .mockResolvedValueOnce([[{ gross_salary: 1_200_000 }]])
      .mockResolvedValueOnce([[{ balance: 10 }]]);
    const result = await calculateFnF("exit-1", 1);
    expect(result!.pending_salary).toBe(50_000);
    expect(result!.leave_encashment).toBe(33_333);
    expect(result!.fnf_total).toBe(83_333);
    expect(db.updateMany).toHaveBeenCalledWith(
      "employee_exits",
      { id: "exit-1", org_id: 1 },
      expect.objectContaining({ fnf_calculated: 1, fnf_total: 83_333 }),
    );
  });
});
