import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UaeEmployeeProfile, UaePeriodInput } from "@emp-payroll/shared";
import type { IDBAdapter } from "../../db/adapters/interface";
vi.mock("../../db/adapters", () => ({
  getDB: vi.fn(() => {
    throw new Error("Live DB access is forbidden");
  }),
}));
vi.mock("../../db/empcloud", () => ({ findUserById: vi.fn() }));
import { findUserById } from "../../db/empcloud";
import { UaeExitService } from "./uae-exit.service";
import { UaePayrollService } from "./uae-payroll.service";

type Row = Record<string, any>;
const profile: UaeEmployeeProfile = {
  jurisdiction: "federal",
  effectiveFrom: "2020-01-01",
  nationality: "IN",
  basicSalary: 600_000,
  allowances: [{ name: "Housing", amount: 400_000 }],
  normalDailyHours: 8,
  iloe: { mode: "employee_paid" },
  healthInsuranceEmployer: 0,
  savings: { scheme: "gratuity" },
  wps: {
    employeeId: "12345678901234",
    routingCode: "123456789",
    accountNumber: "AE123456789012345678901",
  },
};
const employee = (id = "employee-1", user = 10): Row => ({
  id,
  empcloud_org_id: 1,
  empcloud_user_id: user,
  country_id: "ae",
  status: "active",
  employment_type: "direct_hire",
  first_name: "Aisha",
  last_name: id,
  email: `${id}@example.test`,
  salary_currency: "AED",
  salary_frequency: "monthly",
  salary_amount: 1_000_000,
  start_date: "2020-01-01",
  end_date: null,
  uae_profile: JSON.stringify(profile),
});
const finalInput: UaePeriodInput = {
  finalSettlement: { terminationDate: "2026-10-20", unpaidServiceDays: 0 },
};

function memoryDb() {
  let tables: Record<string, Row[]> = {
    employee_exits: [
      {
        id: "exit-1",
        org_id: 1,
        employee_id: 10,
        status: "initiated",
        last_working_date: "2026-10-20",
        fnf_calculated: 0,
        fnf_paid: 0,
      },
    ],
    countries: [{ id: "ae", code: "AE", currency: "AED" }],
    global_employees: [employee()],
    global_payroll_runs: [],
    global_payroll_items: [],
    uae_payroll_events: [],
  };
  let sequence = 0,
    failTable: string | null = null;
  const rows = (table: string) => (tables[table] ??= []);
  const matches = (row: Row, filters: Row) =>
    Object.entries(filters).every(([key, value]) =>
      Array.isArray(value) ? value.includes(row[key]) : row[key] === value,
    );
  const db = {
    findOne: vi.fn(async (table: string, filters: Row) =>
      structuredClone(rows(table).find((row) => matches(row, filters)) ?? null),
    ),
    findById: vi.fn(async (table: string, id: string) =>
      structuredClone(rows(table).find((row) => row.id === id) ?? null),
    ),
    findMany: vi.fn(async (table: string, options: Row = {}) => {
      const found = rows(table).filter((row) => matches(row, options.filters ?? {}));
      const page = options.page ?? 1,
        limit = options.limit ?? 100;
      return {
        data: structuredClone(found.slice((page - 1) * limit, page * limit)),
        total: found.length,
        page,
        limit,
        totalPages: Math.ceil(found.length / limit),
      };
    }),
    create: vi.fn(async (table: string, data: Row) => {
      if (failTable === table) {
        failTable = null;
        throw new Error("Injected storage failure");
      }
      const row = { id: `row-${++sequence}`, ...structuredClone(data) };
      rows(table).push(row);
      return structuredClone(row);
    }),
    update: vi.fn(async (table: string, id: string, data: Row) => {
      const row = rows(table).find((item) => item.id === id);
      if (!row) throw new Error("Missing update target");
      Object.assign(row, structuredClone(data));
      return structuredClone(row);
    }),
    updateMany: vi.fn(async (table: string, filters: Row, data: Row) => {
      const found = rows(table).filter((row) => matches(row, filters));
      found.forEach((row) => Object.assign(row, structuredClone(data)));
      return found.length;
    }),
    deleteMany: vi.fn(async (table: string, filters: Row) => {
      const before = rows(table).length;
      tables[table] = rows(table).filter((row) => !matches(row, filters));
      return before - rows(table).length;
    }),
    transaction: vi.fn(async (callback: () => Promise<unknown>) => {
      const before = structuredClone(tables);
      try {
        return await callback();
      } catch (error) {
        tables = before;
        throw error;
      }
    }),
  };
  return {
    db,
    adapter: db as unknown as IDBAdapter,
    rows,
    state: () => structuredClone(tables),
    failNextCreate: (table: string) => {
      failTable = table;
    },
  };
}

describe("UAE exit preparation and settlement evidence", () => {
  let fixture: ReturnType<typeof memoryDb>;
  let service: UaeExitService;
  const prepare = () =>
    service.prepare("1", "exit-1", { globalEmployeeId: "employee-1", uaeInput: finalInput }, "42");
  const createDraft = (inputs: Record<string, UaePeriodInput> = {}) =>
    new UaePayrollService(fixture.adapter).createRun(
      "1",
      "ae",
      10,
      2026,
      inputs,
      { name: "UAE Employer" },
      "42",
    );
  beforeEach(() => {
    fixture = memoryDb();
    service = new UaeExitService(fixture.adapter);
    vi.mocked(findUserById).mockResolvedValue({ id: 10, organization_id: 1 } as any);
  });
  it("detects a linked UAE exit while leaving unapproved and unpaid flags false", async () => {
    const result = await service.context("1", "exit-1");
    expect(result.isUae).toBe(true);
    expect(result.employees[0].id).toBe("employee-1");
    expect(result.fnfCalculated).toBe(false);
    expect(result.fnfPaid).toBe(false);
    expect(fixture.db.updateMany).not.toHaveBeenCalled();
  });
  it("scopes exits and linked employments to their organisation", async () => {
    await expect(service.context("2", "exit-1")).rejects.toMatchObject({ statusCode: 404 });
    fixture.rows("global_employees")[0].empcloud_org_id = 2;
    expect((await service.context("1", "exit-1")).isUae).toBe(false);
    await expect(prepare()).rejects.toThrow("Linked UAE employment");
    expect(fixture.db.updateMany).not.toHaveBeenCalled();
  });
  it("validates date, actual EmpCloud tenancy and country before any write", async () => {
    await expect(
      service.prepare(
        "1",
        "exit-1",
        {
          globalEmployeeId: "employee-1",
          uaeInput: { finalSettlement: { terminationDate: "2026-10-21", unpaidServiceDays: 0 } },
        },
        "42",
      ),
    ).rejects.toThrow("last working date");
    vi.mocked(findUserById).mockResolvedValue({ id: 10, organization_id: 2 } as any);
    await expect(prepare()).rejects.toThrow("belong to this organisation");
    fixture.rows("countries")[0].code = "IN";
    await expect(prepare()).rejects.toThrow("UAE employment");
    expect(fixture.db.updateMany).not.toHaveBeenCalled();
  });
  it("rejects incomplete or invalid final calculations without offboarding the employee", async () => {
    await expect(
      service.prepare("1", "exit-1", { globalEmployeeId: "employee-1", uaeInput: {} }, "42"),
    ).rejects.toThrow("Final settlement");
    await expect(
      service.prepare(
        "1",
        "exit-1",
        { globalEmployeeId: "employee-1", uaeInput: { ...finalInput, unpaidDays: 31 } },
        "42",
      ),
    ).rejects.toThrow("active calendar days");
    expect(fixture.rows("global_employees")[0].status).toBe("active");
    expect(fixture.db.updateMany).not.toHaveBeenCalled();
  });
  it("prepares a reviewed final calculation without creating, approving or paying a run", async () => {
    const result = await prepare();
    expect(result.calculation.finalSettlement!.gratuity).toBeGreaterThan(0);
    expect(result.calculation.currency).toBe("AED");
    expect(result.runId).toBeUndefined();
    expect(fixture.rows("global_employees")[0]).toMatchObject({
      status: "offboarding",
      end_date: "2026-10-20",
    });
    const exit = fixture.rows("employee_exits")[0];
    expect(JSON.parse(exit.uae_settlement).uaeInput).toEqual(finalInput);
    expect(exit.fnf_calculated).toBe(0);
    expect(exit.fnf_paid).toBe(0);
    expect(fixture.rows("global_payroll_runs")).toHaveLength(0);
    expect((await service.context("1", "exit-1")).fnfCalculated).toBe(false);
  });
  it("atomically recalculates an existing draft while preserving other employees' inputs", async () => {
    fixture.rows("global_employees").push(employee("employee-2", 11));
    const otherInput = { variableEarnings: [{ name: "Bonus", amount: 10_000 }] };
    const run = await createDraft({ "employee-2": otherInput });
    const result = await prepare();
    expect(result.runId).toBe(run.id);
    const updated = fixture.rows("global_payroll_runs")[0];
    expect(updated.status).toBe("draft");
    expect(JSON.parse(updated.uae_inputs)).toEqual({
      "employee-1": finalInput,
      "employee-2": otherInput,
    });
    const item = fixture
      .rows("global_payroll_items")
      .find((row) => row.global_employee_id === "employee-1")!;
    expect(JSON.parse(item.uae_calculation).finalSettlement).toEqual(
      result.calculation.finalSettlement,
    );
    expect(JSON.parse(item.uae_input).finalSettlement.terminationDate).toBe("2026-10-20");
  });
  it("rejects locked, approved and paid runs without changing exit or employment", async () => {
    await createDraft();
    for (const status of ["locked", "approved", "paid"]) {
      fixture.rows("global_payroll_runs")[0].status = status;
      const before = fixture.state();
      await expect(prepare()).rejects.toThrow("cannot be changed");
      expect(fixture.state()).toEqual(before);
    }
  });
  it("rolls back both preparation and end date when draft recalculation fails", async () => {
    await createDraft();
    const before = fixture.state();
    fixture.failNextCreate("uae_payroll_events");
    await expect(prepare()).rejects.toThrow("Injected storage failure");
    expect(fixture.state()).toEqual(before);
  });
  it("derives calculated and paid exclusively from a matching approved snapshot and full payment", async () => {
    await createDraft();
    await prepare();
    const run = fixture.rows("global_payroll_runs")[0];
    const item = fixture.rows("global_payroll_items")[0];
    expect((await service.context("1", "exit-1")).fnfCalculated).toBe(false);
    run.status = "approved";
    expect((await service.context("1", "exit-1")).fnfCalculated).toBe(true);
    expect((await service.context("1", "exit-1")).fnfPaid).toBe(false);
    item.uae_payment = JSON.stringify({
      status: "paid",
      paidAmount: item.net_salary - 1,
      paidOn: "2026-10-21",
      reference: "Bank evidence",
    });
    expect((await service.context("1", "exit-1")).fnfPaid).toBe(false);
    item.uae_payment = JSON.stringify({
      status: "paid",
      paidAmount: item.net_salary,
      paidOn: "2026-10-21",
      reference: "Bank evidence",
    });
    expect((await service.context("1", "exit-1")).fnfPaid).toBe(true);
    item.uae_payment = JSON.stringify({
      status: "refunded",
      paidAmount: item.net_salary,
      paidOn: "2026-10-21",
      reference: "Reversal",
    });
    expect((await service.context("1", "exit-1")).fnfPaid).toBe(false);
  });
  it("refuses to inherit historical paid flags from another linked identity or exit date", async () => {
    await createDraft();
    await prepare();
    fixture.rows("global_payroll_runs")[0].status = "paid";
    const item = fixture.rows("global_payroll_items")[0];
    item.uae_employee = JSON.stringify({ empcloudUserId: 99 });
    item.uae_payment = JSON.stringify({
      status: "paid",
      paidAmount: item.net_salary,
      paidOn: "2026-10-21",
      reference: "Bank evidence",
    });
    const result = await service.context("1", "exit-1");
    expect(result.fnfCalculated).toBe(false);
    expect(result.fnfPaid).toBe(false);
    expect(result.warnings.join(" ")).toContain("does not match");
  });
  it("retains the UAE guard when a prepared employment is later unlinked", async () => {
    await prepare();
    fixture.rows("global_employees")[0].empcloud_user_id = 99;
    const result = await service.context("1", "exit-1");
    expect(result.isUae).toBe(true);
    expect(result.employees).toHaveLength(0);
    expect(result.fnfCalculated).toBe(false);
    expect(result.fnfPaid).toBe(false);
    expect(result.warnings.join(" ")).toContain("no longer linked");
  });
  it("blocks a second final settlement created through another exit date or period", async () => {
    await createDraft();
    await prepare();
    fixture.rows("global_payroll_runs")[0].status = "approved";
    fixture.rows("employee_exits")[0].last_working_date = "2026-11-20";
    const before = fixture.state();
    await expect(
      service.prepare(
        "1",
        "exit-1",
        {
          globalEmployeeId: "employee-1",
          uaeInput: {
            finalSettlement: { terminationDate: "2026-11-20", unpaidServiceDays: 0 },
          },
        },
        "42",
      ),
    ).rejects.toMatchObject({ code: "UAE_SETTLEMENT_ALREADY_EXISTS" });
    expect(fixture.state()).toEqual(before);
  });
});
