import { describe, expect, it, vi } from "vitest";
import type { UaeEmployeeProfile, UaePeriodInput } from "@emp-payroll/shared";
import type { IDBAdapter } from "../../db/adapters/interface";
vi.mock("../../db/adapters", () => ({
  getDB: vi.fn(() => {
    throw new Error("Live DB forbidden");
  }),
}));
import { UaeGratuityReportService } from "./uae-gratuity-report.service";
import { calculateUaePayroll } from "./uae-payroll";

type Row = Record<string, any>;
function profile(overrides: Partial<UaeEmployeeProfile> = {}): UaeEmployeeProfile {
  return {
    jurisdiction: "federal",
    effectiveFrom: "2020-01-01",
    nationality: "IN",
    basicSalary: 600000,
    allowances: [{ name: "Housing", amount: 400000 }],
    normalDailyHours: 8,
    iloe: { mode: "employee_paid" },
    healthInsuranceEmployer: 0,
    savings: { scheme: "gratuity" },
    pension: { scheme: "none" },
    wps: {
      employeeId: "12345678901234",
      routingCode: "802420101",
      accountNumber: "AE070331234567890123456",
    },
    gratuityHistory: {
      asOf: "2026-09-30",
      cumulativeUnpaidServiceDays: 0,
      settlementsPaid: 0,
      reference: "Verified service and paid settlement ledger",
    },
    ...overrides,
  };
}
function fixture(periodInput: UaePeriodInput = {}, endDate?: string) {
  const frozen = profile();
  const calculation = calculateUaePayroll(frozen, periodInput, {
    month: 10,
    year: 2026,
    startDate: "2024-01-01",
    endDate,
  });
  const employee: Row = {
    id: "employee-1",
    empcloud_org_id: 1,
    country_id: "ae",
    employment_type: "eor",
    first_name: "Aisha",
    last_name: "Example",
    start_date: "2024-01-01",
    end_date: endDate,
    uae_profile: JSON.stringify(frozen),
    uae_profile_history: JSON.stringify([frozen]),
  };
  const run: Row = {
    id: "run-1",
    empcloud_org_id: 1,
    country_id: "ae",
    status: "approved",
    period_month: 10,
    period_year: 2026,
    uae_employer: '{"name":"Example LLC"}',
  };
  const item: Row = {
    id: "item-1",
    empcloud_org_id: 1,
    payroll_run_id: run.id,
    global_employee_id: employee.id,
    uae_profile: JSON.stringify(frozen),
    uae_input: JSON.stringify(periodInput),
    uae_calculation: JSON.stringify(calculation),
    uae_payment: null,
  };
  const tables: Record<string, Row[]> = {
    countries: [{ id: "ae", code: "AE" }],
    global_employees: [employee],
    global_payroll_runs: [run],
    global_payroll_items: [item],
    uae_payroll_events: [],
  };
  const matches = (row: Row, filters: Row) =>
    Object.entries(filters).every(([key, value]) =>
      Array.isArray(value) ? value.includes(row[key]) : row[key] === value,
    );
  const db = {
    findOne: vi.fn(async (table: string, filters: Row) =>
      structuredClone(tables[table]?.find((row) => matches(row, filters)) ?? null),
    ),
    findMany: vi.fn(async (table: string, options: Row = {}) => {
      const rows = (tables[table] ?? []).filter((row) => matches(row, options.filters ?? {}));
      const page = options.page ?? 1,
        limit = options.limit ?? 100;
      return {
        data: structuredClone(rows.slice((page - 1) * limit, page * limit)),
        total: rows.length,
      };
    }),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
    transaction: vi.fn(),
  };
  return {
    employee,
    run,
    item,
    calculation,
    tables,
    db,
    report: (org = "1", month = 10, year = 2026) =>
      new UaeGratuityReportService(db as unknown as IDBAdapter).report(org, month, year),
  };
}

describe("UAE gratuity liability report using frozen approved payroll and verified history", () => {
  it("reconciles a monthly movement from an exact opening baseline and approved unpaid days without writes", async () => {
    const f = fixture({ unpaidDays: 2 });
    const report = await f.report();
    const row = report.items[0];
    expect(row.status).toBe("calculated");
    expect(row.openingAccruedLiability).toBe(Math.round(420000 * (2 + 273 / 365)));
    expect(row.closingAccruedLiability).toBe(Math.round(420000 * (2 + 302 / 365)));
    expect(row.openingAccruedLiability! + row.accrualExpense! - row.settlementsPaid).toBe(
      row.closingAccruedLiability,
    );
    expect(report.totals.closingAccruedLiability).toBe(row.closingAccruedLiability);
    expect(row.salaryRevaluation).toBe(0);
    for (const write of [f.db.create, f.db.update, f.db.deleteMany, f.db.transaction])
      expect(write).not.toHaveBeenCalled();
  });

  it.each([undefined, "2026-09-29", "2026-10-01"])(
    "leaves missing or nonmatching opening history %s unknown rather than zero",
    async (asOf) => {
      const f = fixture();
      const p = profile({
        gratuityHistory: asOf ? { ...profile().gratuityHistory!, asOf } : undefined,
      });
      f.employee.uae_profile = JSON.stringify(p);
      f.employee.uae_profile_history = JSON.stringify([p]);
      const report = await f.report();
      expect(report.items[0]).toMatchObject({
        status: "needs_review",
        openingAccruedLiability: null,
        closingAccruedLiability: null,
      });
      expect(report.totals).toMatchObject({
        openingAccruedLiability: null,
        closingAccruedLiability: null,
        settlementsPaid: null,
      });
      expect(report.items[0].warnings.join(" ")).toContain("2026-09-30");
    },
  );

  it("uses the approved closing snapshot after a current salary profile amendment", async () => {
    const f = fixture();
    const original = await f.report();
    const amended = profile({ effectiveFrom: "2026-10-01", basicSalary: 900000 });
    f.employee.uae_profile = JSON.stringify(amended);
    f.employee.uae_profile_history = JSON.stringify([profile(), amended]);
    const after = await f.report();
    expect(after.items[0]).toMatchObject({
      closingAccruedLiability: original.items[0].closingAccruedLiability,
      salaryRevaluation: 0,
    });
  });

  it("keeps the prior month's approved opening salary after a same-date profile correction", async () => {
    const f = fixture();
    const original = await f.report();
    f.tables.global_payroll_runs.push({ ...f.run, id: "september-run", period_month: 9 });
    f.tables.global_payroll_items.push({
      ...f.item,
      id: "september-item",
      payroll_run_id: "september-run",
      uae_calculation: JSON.stringify(
        calculateUaePayroll(profile(), {}, { month: 9, year: 2026, startDate: "2024-01-01" }),
      ),
    });
    const corrected = profile({ basicSalary: 900000 });
    f.employee.uae_profile = JSON.stringify(corrected);
    f.employee.uae_profile_history = JSON.stringify([corrected]);
    const report = await f.report();
    expect(report.items[0]).toMatchObject({
      status: "calculated",
      openingAccruedLiability: original.items[0].openingAccruedLiability,
      closingAccruedLiability: original.items[0].closingAccruedLiability,
      salaryRevaluation: 0,
    });
  });

  it.each(["draft", "locked", "cancelled"])(
    "does not consume %s payroll as an approved service history",
    async (status) => {
      const f = fixture();
      f.run.status = status;
      const report = await f.report();
      expect(report.items[0]).toMatchObject({
        status: "needs_review",
        closingAccruedLiability: null,
      });
      expect(report.items[0].warnings.join(" ")).toContain("Approve this month's payroll");
    },
  );

  it("isolates employees and approved snapshots by organisation and country", async () => {
    const f = fixture();
    f.tables.global_employees.push(
      { ...f.employee, id: "foreign", empcloud_org_id: 2 },
      { ...f.employee, id: "usa", country_id: "us" },
      { ...f.employee, id: "future", start_date: "2026-11-01" },
    );
    f.tables.global_payroll_items.push({ ...f.item, id: "foreign-item", empcloud_org_id: 2 });
    expect((await f.report()).items.map((row) => row.employeeId)).toEqual(["employee-1"]);
    const other = await f.report("2");
    expect(other.items.map((row) => row.employeeId)).toEqual(["foreign"]);
    expect(other.items[0].closingAccruedLiability).toBeNull();
  });

  it("releases cash gratuity only after the entire final settlement is confirmed paid during the period", async () => {
    const f = fixture(
      { finalSettlement: { terminationDate: "2026-10-31", unpaidServiceDays: 0 } },
      "2026-10-31",
    );
    const gratuity = f.calculation.finalSettlement!.gratuity;
    f.item.uae_payment = JSON.stringify({ status: "accepted", paidAmount: 0 });
    const accepted = await f.report();
    expect(accepted.items[0]).toMatchObject({
      status: "calculated",
      settlementsPaid: 0,
      closingAccruedLiability: gratuity,
    });
    f.item.uae_payment = JSON.stringify({
      status: "paid",
      paidAmount: f.calculation.netSalary,
      paidOn: "2026-10-31",
    });
    const paid = await f.report();
    expect(paid.items[0]).toMatchObject({
      status: "calculated",
      settlementsPaid: gratuity,
      closingAccruedLiability: 0,
    });
    expect(paid.totals.settlementsPaid).toBe(gratuity);
    f.item.uae_payment = JSON.stringify({
      status: "paid",
      paidAmount: f.calculation.netSalary,
      paidOn: "2026-11-01",
    });
    expect((await f.report()).items[0]).toMatchObject({
      settlementsPaid: 0,
      closingAccruedLiability: gratuity,
    });
  });

  it("does not invent a gratuity cash allocation for a partial final payment", async () => {
    const f = fixture(
      { finalSettlement: { terminationDate: "2026-10-31", unpaidServiceDays: 0 } },
      "2026-10-31",
    );
    f.item.uae_payment = JSON.stringify({
      status: "paid",
      paidAmount: f.calculation.netSalary - 1,
      paidOn: "2026-10-31",
    });
    const report = await f.report();
    expect(report.items[0]).toMatchObject({
      status: "needs_review",
      settlementsPaid: null,
      closingAccruedLiability: null,
      accrualExpense: null,
      netMovement: null,
    });
    expect(report.items[0].warnings.join(" ")).toContain("partial final payment");
    expect(report.totals.settlementsPaid).toBeNull();
  });

  it("flags refunded settlements rather than recording the reversal as paid cash", async () => {
    const f = fixture(
      { finalSettlement: { terminationDate: "2026-10-31", unpaidServiceDays: 0 } },
      "2026-10-31",
    );
    f.item.uae_payment = JSON.stringify({
      status: "refunded",
      paidAmount: f.calculation.netSalary,
      paidOn: "2026-10-31",
      recordedAt: "2026-10-31T12:00:00Z",
    });
    const report = await f.report();
    expect(report.items[0]).toMatchObject({
      status: "needs_review",
      settlementsPaid: null,
      closingAccruedLiability: null,
    });
    expect(report.items[0].warnings.join(" ")).toContain("refunded settlement");
  });

  it("keeps an October partial settlement unknown after the current payment is completed in November", async () => {
    const f = fixture(
      { finalSettlement: { terminationDate: "2026-10-31", unpaidServiceDays: 0 } },
      "2026-10-31",
    );
    const partial = {
      employeeId: "employee-1",
      status: "paid",
      paidAmount: 1000000,
      paidOn: "2026-10-31",
      recordedAt: "2026-10-31T12:00:00Z",
    };
    const full = {
      employeeId: "employee-1",
      status: "paid",
      paidAmount: f.calculation.netSalary,
      paidOn: "2026-11-01",
      recordedAt: "2026-11-01T12:00:00Z",
      previous: partial,
    };
    f.item.uae_payment = JSON.stringify(full);
    f.tables.uae_payroll_events.push(
      {
        id: "october",
        empcloud_org_id: 1,
        payroll_run_id: "run-1",
        kind: "payment",
        payload: JSON.stringify(partial),
      },
      {
        id: "november",
        empcloud_org_id: 1,
        payroll_run_id: "run-1",
        kind: "payment",
        payload: JSON.stringify(full),
      },
    );
    const report = await f.report();
    expect(report.items[0]).toMatchObject({
      status: "needs_review",
      settlementsPaid: null,
      closingAccruedLiability: null,
    });
    expect(report.items[0].warnings.join(" ")).toContain("partial final payment");
  });

  it("retains October full cash when a November refund supersedes the current payment status", async () => {
    const f = fixture(
      { finalSettlement: { terminationDate: "2026-10-31", unpaidServiceDays: 0 } },
      "2026-10-31",
    );
    const full = {
      employeeId: "employee-1",
      status: "paid",
      paidAmount: f.calculation.netSalary,
      paidOn: "2026-10-31",
      recordedAt: "2026-10-31T12:00:00Z",
    };
    const refund = {
      employeeId: "employee-1",
      status: "refunded",
      paidAmount: f.calculation.netSalary,
      paidOn: "2026-11-02",
      recordedAt: "2026-11-02T12:00:00Z",
      previous: full,
    };
    f.item.uae_payment = JSON.stringify(refund);
    f.tables.uae_payroll_events.push(
      {
        id: "paid",
        empcloud_org_id: 1,
        payroll_run_id: "run-1",
        kind: "payment",
        payload: JSON.stringify(full),
      },
      {
        id: "refunded",
        empcloud_org_id: 1,
        payroll_run_id: "run-1",
        kind: "payment",
        payload: JSON.stringify(refund),
      },
    );
    expect((await f.report()).items[0]).toMatchObject({
      status: "calculated",
      settlementsPaid: f.calculation.finalSettlement!.gratuity,
      closingAccruedLiability: 0,
    });
    // Repeated evidence of the same cumulative total must not be added a second time.
    f.tables.uae_payroll_events.push({
      id: "verified",
      empcloud_org_id: 1,
      payroll_run_id: "run-1",
      kind: "payment",
      payload: JSON.stringify({ ...full, recordedAt: "2026-10-31T13:00:00Z" }),
    });
    expect((await f.report()).totals.settlementsPaid).toBe(f.calculation.finalSettlement!.gratuity);
  });

  it("does not add previously paid gratuity to an approved gross entitlement twice", async () => {
    const f = fixture(
      {
        finalSettlement: {
          terminationDate: "2026-10-31",
          unpaidServiceDays: 0,
          gratuityAlreadyPaid: 100000,
          approvedGratuity: { amount: 1300000, reference: "Reviewed gross entitlement" },
        },
      },
      "2026-10-31",
    );
    const verified = profile({
      gratuityHistory: { ...profile().gratuityHistory!, settlementsPaid: 100000 },
    });
    f.employee.uae_profile_history = JSON.stringify([verified]);
    f.item.uae_payment = JSON.stringify({
      status: "paid",
      paidAmount: f.calculation.netSalary,
      paidOn: "2026-10-31",
    });
    expect(f.calculation.finalSettlement!.gratuity).toBe(1200000);
    expect((await f.report()).items[0]).toMatchObject({
      status: "calculated",
      settlementsPaid: 1200000,
      closingAccruedLiability: 0,
    });
  });

  it("carries the approved gross final entitlement into later liability months", async () => {
    const f = fixture(
      {
        finalSettlement: {
          terminationDate: "2026-10-31",
          unpaidServiceDays: 0,
          approvedGratuity: { amount: 1300000, reference: "Reviewed final entitlement" },
        },
      },
      "2026-10-31",
    );
    const novemberHistory = profile({
      effectiveFrom: "2026-11-01",
      basicSalary: 900000,
      gratuityHistory: {
        asOf: "2026-10-31",
        cumulativeUnpaidServiceDays: 0,
        settlementsPaid: 0,
        reference: "Verified November opening",
      },
    });
    f.employee.uae_profile_history = JSON.stringify([profile(), novemberHistory]);
    f.employee.uae_profile = JSON.stringify(novemberHistory);
    const report = await f.report("1", 11);
    expect(report.items[0]).toMatchObject({
      status: "calculated",
      openingAccruedLiability: 1300000,
      closingAccruedLiability: 1300000,
      accrualExpense: 0,
      settlementsPaid: 0,
    });
  });

  it("restores the retained liability for a fully documented later-month refund", async () => {
    const f = fixture(
      { finalSettlement: { terminationDate: "2026-10-31", unpaidServiceDays: 0 } },
      "2026-10-31",
    );
    const gratuity = f.calculation.finalSettlement!.gratuity;
    const full = {
      employeeId: "employee-1",
      status: "paid",
      paidAmount: f.calculation.netSalary,
      paidOn: "2026-10-31",
      recordedAt: "2026-10-31T12:00:00Z",
    };
    const refund = {
      employeeId: "employee-1",
      status: "refunded",
      paidAmount: f.calculation.netSalary,
      paidOn: "2026-11-02",
      recordedAt: "2026-11-02T12:00:00Z",
      previous: full,
    };
    f.item.uae_payment = JSON.stringify(refund);
    f.tables.uae_payroll_events.push(
      {
        id: "paid",
        empcloud_org_id: 1,
        payroll_run_id: "run-1",
        kind: "payment",
        payload: JSON.stringify(full),
      },
      {
        id: "refunded",
        empcloud_org_id: 1,
        payroll_run_id: "run-1",
        kind: "payment",
        payload: JSON.stringify(refund),
      },
    );
    const verified = profile({
      effectiveFrom: "2026-11-01",
      gratuityHistory: {
        asOf: "2026-10-31",
        cumulativeUnpaidServiceDays: 0,
        settlementsPaid: gratuity,
        reference: "Confirmed October closing cash",
      },
    });
    f.employee.uae_profile_history = JSON.stringify([profile(), verified]);
    const report = await f.report("1", 11);
    expect(report.items[0]).toMatchObject({
      status: "calculated",
      openingAccruedLiability: 0,
      closingAccruedLiability: gratuity,
      settlementsPaid: -gratuity,
      netMovement: gratuity,
      accrualExpense: 0,
    });
    expect(report.totals.settlementsPaid).toBe(-gratuity);
  });
});
