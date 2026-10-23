import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UaeEmployeeProfile } from "@emp-payroll/shared";
import type { IDBAdapter } from "../../db/adapters/interface";

vi.mock("../../db/adapters", () => ({
  getDB: vi.fn(() => {
    throw new Error("Live DB access is forbidden in these tests");
  }),
}));

import { UaePayrollService, selectUaeProfile, uaeProfileUpdate } from "./uae-payroll.service";

type Row = Record<string, any>;
const employer = { name: "Frozen UAE LLC", address: "Dubai", registrationNumber: "REG-1" };
const exportRequest = {
  bankFormat: "dib-v1.1" as const,
  employerId: "0000000123456",
  employerRoutingCode: "802420101",
  reference: "October payroll",
};

function profile(overrides: Partial<UaeEmployeeProfile> = {}): UaeEmployeeProfile {
  return {
    jurisdiction: "federal",
    effectiveFrom: "2026-06-01",
    nationality: "IN",
    basicSalary: 800000,
    allowances: [{ name: "Housing", amount: 200000 }],
    normalDailyHours: 8,
    pension: { scheme: "none" },
    iloe: { mode: "employee_paid" },
    healthInsuranceEmployer: 10000,
    savings: { scheme: "gratuity" },
    wps: {
      employeeId: "00915012345663",
      routingCode: "802420101",
      accountNumber: "AE070331234567890123456",
    },
    ...overrides,
  };
}

function employee(overrides: Row = {}): Row {
  return {
    id: "employee-1",
    empcloud_org_id: 1,
    country_id: "ae",
    status: "active",
    employment_type: "eor",
    first_name: "Aisha",
    last_name: "Example",
    email: "aisha@example.test",
    job_title: "Engineer",
    salary_currency: "AED",
    salary_frequency: "monthly",
    salary_amount: 1000000,
    start_date: "2020-01-01",
    end_date: null,
    uae_profile: JSON.stringify(profile()),
    ...overrides,
  };
}

/** A detached-read, filter-aware adapter with atomic rollback; never connects to a database. */
function memoryDb(initialEmployees: Row[] = [employee()]) {
  let tables: Record<string, Row[]> = {
    countries: [{ id: "ae", code: "AE", currency: "AED" }],
    global_employees: structuredClone(initialEmployees),
    global_payroll_runs: [],
    global_payroll_items: [],
    uae_payroll_events: [],
  };
  let sequence = 0;
  let failTable: string | undefined;
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
      const all = rows(table).filter((row) => matches(row, options.filters ?? {}));
      const page = options.page ?? 1,
        limit = options.limit ?? 100;
      return {
        data: structuredClone(all.slice((page - 1) * limit, page * limit)),
        total: all.length,
        page,
        limit,
        totalPages: Math.ceil(all.length / limit),
      };
    }),
    create: vi.fn(async (table: string, data: Row) => {
      if (failTable === table) {
        failTable = undefined;
        throw new Error("Injected storage failure");
      }
      const row = { id: `row-${++sequence}`, ...structuredClone(data) };
      rows(table).push(row);
      return structuredClone(row);
    }),
    update: vi.fn(async (table: string, id: string, data: Row) => {
      const row = rows(table).find((entry) => entry.id === id);
      if (!row) throw new Error("Fixture update target not found");
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
      return before - tables[table].length;
    }),
    transaction: vi.fn(async (fn: () => Promise<unknown>) => {
      const before = structuredClone(tables);
      try {
        return await fn();
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
    failNextCreate: (table: string) => {
      failTable = table;
    },
    clearWrites: () => {
      db.create.mockClear();
      db.update.mockClear();
      db.updateMany.mockClear();
      db.deleteMany.mockClear();
    },
    state: () => structuredClone(tables),
  };
}

describe("UAE payroll persistence and reporting with real calculation", () => {
  let fixture: ReturnType<typeof memoryDb>;
  let service: UaePayrollService;
  const create = (inputs: Row = {}) =>
    service.createRun("1", "ae", 10, 2026, inputs, employer, "42");
  const item = () => structuredClone(fixture.rows("global_payroll_items")[0]);
  const run = () => structuredClone(fixture.rows("global_payroll_runs")[0]);
  const details = () =>
    service.details("1", run(), structuredClone(fixture.rows("global_payroll_items")));
  const approve = async (orgId: string, runId: string, actor: string) => {
    let current = fixture
      .rows("global_payroll_runs")
      .find((entry) => entry.id === runId && entry.empcloud_org_id === Number(orgId));
    if (current?.status === "draft") {
      await service.lock(orgId, runId, current.uae_revision, actor);
      current = fixture.rows("global_payroll_runs").find((entry) => entry.id === runId);
    }
    return service.approve(orgId, runId, actor, current?.uae_revision ?? 1);
  };
  const noWrites = () => {
    expect(fixture.db.create).not.toHaveBeenCalled();
    expect(fixture.db.update).not.toHaveBeenCalled();
    expect(fixture.db.updateMany).not.toHaveBeenCalled();
    expect(fixture.db.deleteMany).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    fixture = memoryDb();
    service = new UaePayrollService(fixture.adapter);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it.each(["create", "edit"])(
    "saves a %s UAE profile before WPS details are available",
    (operation) => {
      const existing = operation === "edit" ? employee() : null;
      const incomplete = profile({ effectiveFrom: "2026-10-01", wps: {} });
      const update = uaeProfileUpdate(
        existing,
        { salaryAmount: 1000000, uaeProfile: incomplete },
        "AE",
      );
      expect(JSON.parse(update.uae_profile)).toEqual(incomplete);
      const history = JSON.parse(update.uae_profile_history);
      expect(history).toHaveLength(operation === "edit" ? 2 : 1);
      expect(history.at(-1).wps).toEqual({});
      if (existing) expect(history[0].wps).toEqual(profile().wps);
    },
  );

  it.each([{}, { employeeId: "00915012345663" }])(
    "rejects payroll with incomplete WPS details before any writes: %j",
    async (wps) => {
      fixture.rows("global_employees")[0].uae_profile = JSON.stringify(profile({ wps }));
      await expect(create()).rejects.toThrow(/WPS/);
      noWrites();
      expect(fixture.db.transaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    { reason: "", reference: "EXEMPT-1" },
    { reason: "Documented exemption", reference: "" },
  ])("rejects incomplete WPS exemption evidence when saving a profile: %j", (exemption) => {
    expect(() =>
      uaeProfileUpdate(
        null,
        { salaryAmount: 1000000, uaeProfile: profile({ wps: { exemption } }) },
        "AE",
      ),
    ).toThrow();
  });

  it("validates every employee before writing any run or items", async () => {
    fixture.rows("global_employees").push(employee({ id: "employee-2", uae_profile: null }));
    await expect(create()).rejects.toMatchObject({ code: "UAE_PROFILE_REQUIRED" });
    noWrites();
    expect(fixture.db.transaction).not.toHaveBeenCalled();
  });

  it("rejects missing employer, unsupported historical periods and wrong-currency profiles before writes", async () => {
    await expect(service.createRun("1", "ae", 10, 2026)).rejects.toMatchObject({
      code: "INVALID_UAE_INPUT",
    });
    await expect(service.createRun("1", "ae", 5, 2026, {}, employer)).rejects.toMatchObject({
      code: "UNSUPPORTED_UAE_PERIOD",
    });
    fixture.rows("global_employees")[0].salary_currency = "USD";
    await expect(create()).rejects.toMatchObject({ code: "INVALID_UAE_SALARY" });
    noWrites();
  });

  it("limits calculations to the organisation, eligible employees and supplied period", async () => {
    fixture
      .rows("global_employees")
      .push(
        employee({ id: "foreign", empcloud_org_id: 2 }),
        employee({ id: "contractor", employment_type: "contractor" }),
        employee({ id: "future", start_date: "2026-11-01" }),
      );
    await expect(create({ foreign: {} })).rejects.toMatchObject({ code: "INVALID_UAE_EMPLOYEE" });
    noWrites();
    const created = await create();
    expect(created.employee_count).toBe(1);
    expect(item().global_employee_id).toBe("employee-1");
    fixture.clearWrites();
    await expect(approve("2", created.id, "42")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(service.payslip("2", created.id, item().id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    noWrites();
  });

  it("stores a zero-tax expat calculation and immutable employer/employee/profile snapshots", async () => {
    const created = await create();
    const original = item();
    const calculation = JSON.parse(original.uae_calculation);
    expect(original).toMatchObject({
      gross_salary: 1000000,
      net_salary: 1000000,
      tax_amount: 0,
      pension_employee: 0,
      pension_employer: 0,
      health_insurance_employer: 10000,
    });
    expect(calculation.paymentDueDate).toBe("2026-11-01");
    expect(calculation.schemeMetadata.pensionScheme).toBe("none");
    await approve("1", created.id, "42");
    Object.assign(fixture.rows("global_employees")[0], {
      first_name: "Changed",
      uae_profile: JSON.stringify(profile({ basicSalary: 1200000 })),
      bank_account: "CHANGED",
    });
    const html = await service.payslip("1", created.id, original.id);
    expect(html).toContain("Aisha Example");
    expect(html).not.toContain("Changed");
    expect(html).toContain("Frozen UAE LLC");
    expect(html).toContain("Net pay: AED 10000.00");
    expect(item().uae_calculation).toBe(original.uae_calculation);
    expect((await details()).items[0].employee_name).toBe("Aisha Example");
    fixture.clearWrites();
    await expect(service.recalculate("1", created.id, {}, "42")).rejects.toMatchObject({
      code: "IMMUTABLE_PAYROLL",
    });
    noWrites();
  });

  it("leaves draft rows untouched when recalculation fails validation", async () => {
    const created = await create();
    const previous = fixture.state();
    fixture.clearWrites();
    await expect(
      service.recalculate(
        "1",
        created.id,
        {
          "employee-1": {
            deductions: [{ name: "Loan", amount: 10000, kind: "loan", reference: "LOAN-1" }],
          },
        },
        "42",
      ),
    ).rejects.toThrow(/consent/);
    noWrites();
    expect(fixture.state()).toEqual(previous);
  });

  it("limits self-service to the immutable employee identity and organisation after profile unlink", async () => {
    fixture.rows("global_employees")[0].empcloud_user_id = 77;
    const created = await create();
    const original = item();
    expect(original.uae_empcloud_user_id).toBe(77);
    expect(await service.myPayslips("1", "77")).toEqual([]);
    await expect(service.myPayslip("1", "77", original.id)).rejects.toMatchObject({
      code: "INVALID_STATUS",
    });
    await approve("1", created.id, "42");
    Object.assign(fixture.rows("global_employees")[0], {
      empcloud_user_id: 88,
      email: "relinked@example.test",
    });
    expect(await service.myPayslips("1", "77")).toEqual([
      expect.objectContaining({ id: original.id, runId: created.id, netSalary: 1000000 }),
    ]);
    expect(await service.myPayslip("1", "77", original.id)).toContain("Aisha Example");
    expect(await service.myPayslips("1", "88")).toEqual([]);
    expect(await service.myPayslips("2", "77")).toEqual([]);
    await expect(service.myPayslip("1", "88", original.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(service.myPayslip("2", "77", original.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("checks the frozen owner even when the self-service lookup column matches", async () => {
    fixture.rows("global_employees")[0].empcloud_user_id = 77;
    const created = await create();
    await approve("1", created.id, "42");
    fixture.rows("global_payroll_items")[0].uae_empcloud_user_id = 88;
    expect(await service.myPayslips("1", "88")).toEqual([]);
    await expect(service.myPayslip("1", "88", item().id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("atomically rolls back run/item creation when audit persistence fails", async () => {
    const previous = fixture.state();
    fixture.failNextCreate("uae_payroll_events");
    await expect(create()).rejects.toThrow("Injected storage failure");
    expect(fixture.state()).toEqual(previous);
  });

  it("atomically restores the prior draft and items after a failed replacement", async () => {
    const created = await create();
    const previous = fixture.state();
    fixture.failNextCreate("global_payroll_items");
    await expect(
      service.recalculate(
        "1",
        created.id,
        { "employee-1": { variableEarnings: [{ name: "Bonus", amount: 10000 }] } },
        "42",
      ),
    ).rejects.toThrow("Injected storage failure");
    expect(fixture.state()).toEqual(previous);
    expect(run().status).toBe("draft");
  });

  it("rolls back an approval if its audit event cannot be written", async () => {
    const created = await create();
    await service.lock("1", created.id, run().uae_revision, "42");
    const previous = fixture.state();
    fixture.failNextCreate("uae_payroll_events");
    await expect(approve("1", created.id, "42")).rejects.toThrow("Injected storage failure");
    expect(fixture.state()).toEqual(previous);
  });

  it("requires a locked run and rejects approval of a stale reviewed revision", async () => {
    const created = await create();
    await expect(service.approve("1", created.id, "42", run().uae_revision)).rejects.toMatchObject({
      code: "PAYROLL_CHANGED",
    });
    const draftRevision = run().uae_revision;
    await service.lock("1", created.id, draftRevision, "42");
    const lockedRevision = run().uae_revision;
    const lockedState = fixture.state();
    await expect(service.approve("1", created.id, "42", lockedRevision - 1)).rejects.toMatchObject({
      code: "PAYROLL_CHANGED",
    });
    expect(fixture.state()).toEqual(lockedState);
    await service.approve("1", created.id, "42", lockedRevision);
    expect(run().status).toBe("approved");
  });

  it.each(
    ["uae_profile", "uae_calculation", "uae_employee", "uae_input"].flatMap((field) =>
      ["string", "object"].map((storage) => ({ field, storage })),
    ),
  )(
    "locks revision 2 and approves after database key reordering of $field as $storage",
    async ({ field, storage }) => {
      const inputs = {
        "employee-1": {
          variableEarnings: [
            { name: "Commission", amount: 12345 },
            { name: "Bonus", amount: 23456 },
          ],
        },
      };
      const created = await create(inputs);
      await service.recalculate("1", created.id, inputs, "42", undefined, 1);
      expect(run().uae_revision).toBe(2);
      const reorderObjectKeys = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(reorderObjectKeys);
        if (value && typeof value === "object")
          return Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([key, entry]) => [key, reorderObjectKeys(entry)]),
          );
        return value;
      };
      const saved = fixture.rows("global_payroll_items")[0];
      const reordered = reorderObjectKeys(JSON.parse(saved[field]));
      saved[field] = storage === "string" ? JSON.stringify(reordered) : reordered;
      const originalSnapshot = structuredClone(saved);
      await service.lock("1", created.id, 2, "42");
      expect(run().status).toBe("locked");
      await service.approve("1", created.id, "42", 3);
      expect(run().status).toBe("approved");
      expect(fixture.rows("global_payroll_items")[0]).toEqual(originalSnapshot);
    },
  );

  it.each(["nested value", "array order", "value type"])(
    "rejects a real snapshot change in %s without writes",
    async (change) => {
      const earnings = [
        { name: "Commission", amount: 12345 },
        { name: "Bonus", amount: 23456 },
      ];
      const created = await create({ "employee-1": { variableEarnings: earnings } });
      if (change === "nested value") {
        const current = fixture.rows("global_employees")[0];
        const updatedProfile = JSON.parse(current.uae_profile);
        updatedProfile.wps.accountNumber = "AE070331234567890123457";
        current.uae_profile = JSON.stringify(updatedProfile);
      } else if (change === "array order") {
        fixture.rows("global_payroll_runs")[0].uae_inputs = JSON.stringify({
          "employee-1": { variableEarnings: [...earnings].reverse() },
        });
      } else {
        const saved = fixture.rows("global_payroll_items")[0];
        const calculation = JSON.parse(saved.uae_calculation);
        calculation.earnings[0].amount = String(calculation.earnings[0].amount);
        saved.uae_calculation = JSON.stringify(calculation);
      }
      const originalSnapshot = item();
      fixture.clearWrites();
      await expect(service.lock("1", created.id, 1, "42")).rejects.toMatchObject({
        code: "STALE_UAE_INPUTS",
      });
      noWrites();
      expect(item()).toEqual(originalSnapshot);
      expect(run().status).toBe("draft");
    },
  );

  it("preserves a locked snapshot until an audited unlock with the current revision", async () => {
    const created = await create();
    await service.lock("1", created.id, run().uae_revision, "42");
    const lockedState = fixture.state();
    await expect(service.recalculate("1", created.id, {}, "42")).rejects.toMatchObject({
      code: "IMMUTABLE_PAYROLL",
    });
    await expect(
      service.unlock("1", created.id, run().uae_revision - 1, "Correct approved inputs", "42"),
    ).rejects.toMatchObject({ code: "PAYROLL_CHANGED" });
    expect(fixture.state()).toEqual(lockedState);
    await service.unlock("1", created.id, run().uae_revision, "Correct payroll inputs", "42");
    expect(run().status).toBe("draft");
    expect(fixture.rows("uae_payroll_events").some((event) => event.kind === "unlocked")).toBe(
      true,
    );
  });

  it("rejects approval when employee inputs changed after the payroll was locked", async () => {
    const created = await create();
    await service.lock("1", created.id, run().uae_revision, "42");
    const originalSnapshot = item().uae_calculation;
    const revised = profile({ basicSalary: 900000 });
    Object.assign(fixture.rows("global_employees")[0], {
      salary_amount: 1100000,
      uae_profile: JSON.stringify(revised),
    });
    fixture.clearWrites();
    await expect(service.approve("1", created.id, "42", run().uae_revision)).rejects.toMatchObject({
      code: "STALE_UAE_INPUTS",
    });
    noWrites();
    expect(item().uae_calculation).toBe(originalSnapshot);
    expect(run().status).toBe("locked");
    await service.unlock("1", created.id, run().uae_revision, "Review salary amendment", "42");
    await service.recalculate("1", created.id, {}, "42");
    await approve("1", created.id, "42");
    expect(run().status).toBe("approved");
    expect(item().gross_salary).toBe(1100000);
  });

  it("separates bank acceptance, 85% WPS threshold and fully paid status, including refunds", async () => {
    const created = await create();
    await approve("1", created.id, "42");
    const evidence = {
      employeeId: "employee-1",
      reference: "BANK-1",
      status: "accepted" as const,
      paidAmount: 0,
    };
    await service.recordPayment("1", created.id, evidence, "42");
    expect(await service.payslip("1", created.id, item().id)).toContain(
      "File accepted — payment not confirmed",
    );
    expect((await details()).payment_summary).toMatchObject({
      fullyPaid: false,
      wpsThresholdMet: false,
      paidAmount: 0,
    });
    const partial = await service.recordPayment(
      "1",
      created.id,
      { ...evidence, status: "paid", paidAmount: 850000, paidOn: "2026-11-01" },
      "42",
    );
    expect(partial.payment_summary).toMatchObject({
      fullyPaid: false,
      wpsThresholdMet: true,
      paidAmount: 850000,
    });
    expect(run().status).toBe("approved");
    await expect(service.exportWps("1", created.id, exportRequest, "42")).rejects.toMatchObject({
      code: "PAYMENT_ALREADY_RECORDED",
    });
    await service.recordPayment(
      "1",
      created.id,
      { ...evidence, status: "refunded", paidAmount: 850000, paidOn: "2026-11-02" },
      "42",
    );
    expect((await details()).payment_summary).toMatchObject({ fullyPaid: false, paidAmount: 0 });
    expect(await service.payslip("1", created.id, item().id)).toContain(
      "Payment refunded — wages outstanding",
    );
    await service.recordPayment(
      "1",
      created.id,
      { ...evidence, status: "paid", paidAmount: 1000000, paidOn: "2026-11-02" },
      "42",
    );
    expect(run().status).toBe("paid");
    expect((await details()).payment_summary).toMatchObject({
      fullyPaid: true,
      wpsThresholdMet: false,
    });
    expect(
      fixture.rows("uae_payroll_events").filter((event) => event.kind === "payment"),
    ).toHaveLength(4);
  });

  it("rejects overpayment, future evidence, invalid status transitions and other-tenant employees", async () => {
    const created = await create();
    await approve("1", created.id, "42");
    const payment = {
      employeeId: "employee-1",
      reference: "BANK-1",
      status: "paid" as const,
      paidAmount: 1000000,
      paidOn: "2026-11-01",
    };
    const previous = fixture.state();
    await expect(
      service.recordPayment("1", created.id, { ...payment, paidAmount: 1000001 }, "42"),
    ).rejects.toMatchObject({ code: "INVALID_PAYMENT" });
    await expect(
      service.recordPayment("1", created.id, { ...payment, paidOn: "2026-11-03" }, "42"),
    ).rejects.toMatchObject({ code: "INVALID_PAYMENT_DATE" });
    await expect(
      service.recordPayment("1", created.id, { ...payment, employeeId: "foreign" }, "42"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fixture.state()).toEqual(previous);
    await service.recordPayment("1", created.id, payment, "42");
    await expect(
      service.recordPayment(
        "1",
        created.id,
        { ...payment, status: "accepted", paidAmount: 0 },
        "42",
      ),
    ).rejects.toMatchObject({ code: "INVALID_PAYMENT" });
    expect(run().status).toBe("paid");
  });

  it("retains on-time partial disbursement evidence after a late top-up and rejects reductions without refund", async () => {
    const created = await create();
    await approve("1", created.id, "42");
    const payment = {
      employeeId: "employee-1",
      reference: "BANK-1",
      status: "paid" as const,
      paidAmount: 850000,
      paidOn: "2026-11-01",
    };
    await service.recordPayment("1", created.id, payment, "42");
    const final = await service.recordPayment(
      "1",
      created.id,
      { ...payment, reference: "BANK-TOPUP", paidAmount: 1000000, paidOn: "2026-11-02" },
      "42",
    );
    expect(final.payment_summary).toMatchObject({
      fullyPaid: true,
      wpsThresholdMet: true,
      wpsPaidOnTime: 850000,
    });
    const previous = fixture.state();
    await expect(
      service.recordPayment("1", created.id, { ...payment, paidAmount: 800000 }, "42"),
    ).rejects.toMatchObject({ code: "INVALID_PAYMENT" });
    expect(fixture.state()).toEqual(previous);
  });

  it("requests a manual WPS allocation review for a partial payment including reimbursements", async () => {
    const created = await create({
      "employee-1": {
        variableEarnings: [{ name: "Travel reimbursement", amount: 100000, kind: "reimbursement" }],
      },
    });
    await approve("1", created.id, "42");
    const result = await service.recordPayment(
      "1",
      created.id,
      {
        employeeId: "employee-1",
        reference: "BANK-1",
        status: "paid",
        paidAmount: 850000,
        paidOn: "2026-11-01",
      },
      "42",
    );
    expect(result.payment_summary).toMatchObject({
      fullyPaid: false,
      wpsThresholdMet: null,
      wpsPaidOnTime: null,
    });
    expect(result.payment_summary.warnings.join(" ")).toContain("allocation");
  });

  it("accepts today's UAE bank evidence before midnight UTC", async () => {
    vi.setSystemTime(new Date("2026-11-01T21:30:00Z"));
    const created = await create();
    await approve("1", created.id, "42");
    await expect(
      service.recordPayment(
        "1",
        created.id,
        {
          employeeId: "employee-1",
          reference: "BANK-1",
          status: "paid",
          paidAmount: 1000000,
          paidOn: "2026-11-02",
        },
        "42",
      ),
    ).resolves.toMatchObject({ payment_summary: { fullyPaid: true } });
  });

  it("builds reconciled net SIF and escaped printable payslip from frozen variable pay", async () => {
    fixture.rows("global_employees")[0].first_name = "<script>alert(1)</script>";
    const created = await create({
      "employee-1": {
        variableEarnings: [{ name: "Sales bonus", amount: 20000 }],
        deductions: [
          {
            name: "Loan repayment",
            amount: 10000,
            kind: "loan",
            reference: "LOAN-1",
            consent: true,
          },
        ],
      },
    });
    await approve("1", created.id, "42");
    const file = await service.exportWps("1", created.id, exportRequest, "42");
    const lines = file.content
      .trim()
      .split("\r\n")
      .map((line) => line.split(","));
    expect(lines.map((line) => line[0])).toEqual(["EDR", "EVP", "SCR"]);
    expect(lines[0].slice(7, 9)).toEqual(["9900.00", "200.00"]);
    expect(lines[1][8]).toBe("200.00");
    expect(lines[2][7]).toBe("10100.00");
    expect(file.totalPayment).toBe(item().net_salary);
    expect(run().status).toBe("approved");
    const html = await service.payslip("1", created.id, item().id);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Loan repayment");
    expect(html).toContain("Print payslip");
    expect(html).not.toContain("AE070331234567890123456");
  });

  it("rejects legacy runs without statutory snapshots and duplicate months", async () => {
    fixture
      .rows("global_payroll_runs")
      .push({ id: "legacy", country_id: "ae", empcloud_org_id: 1, status: "approved" });
    await expect(service.payslip("1", "legacy", "any")).rejects.toMatchObject({
      code: "LEGACY_UAE_PAYROLL",
    });
    await create();
    fixture.clearWrites();
    await expect(create()).rejects.toMatchObject({ code: "DUPLICATE_RUN" });
    noWrites();
  });

  it("excludes ADGM employees from a mixed UAE WPS export while retaining their payslips", async () => {
    fixture.rows("global_employees").push(
      employee({
        id: "adgm-employee",
        first_name: "Omar",
        uae_profile: JSON.stringify(profile({ jurisdiction: "adgm" })),
      }),
    );
    const created = await create();
    await approve("1", created.id, "42");
    const file = await service.exportWps("1", created.id, exportRequest, "42");
    expect(file.employeeCount).toBe(1);
    expect(file.excluded).toEqual([
      { employeeId: "adgm-employee", reason: expect.stringContaining("ADGM") },
    ]);
    const adgmItem = fixture
      .rows("global_payroll_items")
      .find((row) => row.global_employee_id === "adgm-employee")!;
    expect(await service.payslip("1", created.id, adgmItem.id)).toContain("Omar Example");
  });

  it("keeps EVP equal to variable net pay when lawful deductions exceed fixed pay", async () => {
    const created = await create({
      "employee-1": {
        variableEarnings: [{ name: "Sales bonus", amount: 2000000 }],
        deductions: [
          {
            name: "Loan repayment",
            amount: 1500000,
            kind: "loan",
            reference: "LOAN-1",
            consent: true,
          },
        ],
      },
    });
    await approve("1", created.id, "42");
    const file = await service.exportWps("1", created.id, exportRequest, "42");
    const lines = file.content
      .trim()
      .split("\r\n")
      .map((line) => line.split(","));
    expect(lines[0].slice(7, 9)).toEqual(["0.00", "15000.00"]);
    expect(lines[1].slice(3).reduce((sum, value) => sum + Number(value), 0)).toBe(15000);
    expect(file.totalPayment).toBe(1500000);
  });

  it("rolls back recorded payment and run revision if its audit event fails", async () => {
    const created = await create();
    await approve("1", created.id, "42");
    const previous = fixture.state();
    fixture.failNextCreate("uae_payroll_events");
    await expect(
      service.recordPayment(
        "1",
        created.id,
        {
          employeeId: "employee-1",
          status: "paid",
          reference: "BANK-1",
          paidAmount: 1000000,
          paidOn: "2026-11-01",
        },
        "42",
      ),
    ).rejects.toThrow("Injected storage failure");
    expect(fixture.state()).toEqual(previous);
  });

  it("requires offboarding settlement input and keeps gratuity/notice separate from regular wages", async () => {
    Object.assign(fixture.rows("global_employees")[0], {
      status: "offboarding",
      end_date: "2026-10-31",
    });
    await expect(create()).rejects.toMatchObject({ code: "NO_EMPLOYEES" });
    const created = await create({
      "employee-1": {
        finalSettlement: {
          terminationDate: "2026-10-31",
          unpaidServiceDays: 0,
          unusedAnnualLeaveDays: 5,
          noticePayDays: 3,
          noticePayDirection: "employee_owes",
        },
      },
    });
    const calculation = JSON.parse(item().uae_calculation);
    expect(calculation.finalSettlement.gratuity).toBeGreaterThan(0);
    expect(calculation.finalSettlement.noticePay).toBe(-100000);
    expect(calculation.finalSettlement.paymentDueDate).toBe("2026-11-14");
    expect(
      calculation.deductions.some((line: Row) => line.code === "NOTICE" && line.amount === 100000),
    ).toBe(true);
    await approve("1", created.id, "42");
    expect(await service.payslip("1", created.id, item().id)).toContain(
      "Final settlement breakdown",
    );
    await expect(service.exportWps("1", created.id, exportRequest, "42")).rejects.toThrow(
      /Final settlements/,
    );
  });

  it("uses the calendar date of a DB DATE in Asia/Kolkata without UTC shifting", async () => {
    vi.stubEnv("TZ", "Asia/Kolkata");
    const joinDate = new Date(2026, 9, 17);
    Object.assign(fixture.rows("global_employees")[0], { start_date: joinDate });
    await create({
      "employee-1": {
        approvedAdjustments: {
          regularSalary: { amount: 500000, reference: "Reviewed 17–31 October salary" },
        },
      },
    });
    const calculation = JSON.parse(item().uae_calculation);
    expect(calculation.paidDays).toBe(15);
  });

  it("rejects reimbursement WPS export without preventing the approved payslip", async () => {
    const created = await create({
      "employee-1": {
        variableEarnings: [{ name: "Travel expense", amount: 10_000, kind: "reimbursement" }],
      },
    });
    await approve("1", created.id, "42");
    expect(await service.payslip("1", created.id, item().id)).toContain("Travel expense");
    fixture.clearWrites();
    await expect(service.exportWps("1", created.id, exportRequest, "42")).rejects.toMatchObject({
      code: "UAE_WPS_ALLOCATION_REQUIRED",
    });
    noWrites();
  });

  it("blocks a second final settlement after an employment end date is moved to another month", async () => {
    Object.assign(fixture.rows("global_employees")[0], {
      status: "offboarding",
      end_date: "2026-10-31",
    });
    const created = await create({
      "employee-1": { finalSettlement: { terminationDate: "2026-10-31", unpaidServiceDays: 0 } },
    });
    await approve("1", created.id, "42");
    fixture.rows("global_employees")[0].end_date = "2026-11-30";
    fixture.clearWrites();
    await expect(
      service.createRun(
        "1",
        "ae",
        11,
        2026,
        {
          "employee-1": {
            finalSettlement: { terminationDate: "2026-11-30", unpaidServiceDays: 0 },
          },
        },
        employer,
        "42",
      ),
    ).rejects.toMatchObject({ code: "UAE_SETTLEMENT_ALREADY_EXISTS" });
    noWrites();
    expect(fixture.rows("global_payroll_runs")).toHaveLength(1);
  });
});

describe("UAE profile history", () => {
  it("selects the effective profile and keeps future amendments out of earlier payroll", () => {
    const earlier = profile();
    const later = profile({ effectiveFrom: "2026-11-01", basicSalary: 900000 });
    const record = employee({
      uae_profile: JSON.stringify(later),
      uae_profile_history: JSON.stringify([earlier, later]),
    });
    expect(selectUaeProfile(record, 10, 2026).basicSalary).toBe(800000);
    expect(selectUaeProfile(record, 11, 2026).basicSalary).toBe(900000);
  });

  it("requires consistent salary changes and first-of-month amendments", () => {
    const existing = employee();
    expect(() => uaeProfileUpdate(existing, { salaryAmount: 1200000 }, "AE")).toThrow(/together/);
    expect(() =>
      uaeProfileUpdate(existing, { uaeProfile: profile({ effectiveFrom: "2026-10-17" }) }, "AE"),
    ).toThrow(/first/);
    expect(() =>
      uaeProfileUpdate(existing, { uaeProfile: profile({ basicSalary: 900000 }) }, "AE"),
    ).toThrow(/equal/);
    const update = uaeProfileUpdate(
      existing,
      {
        uaeProfile: profile({ effectiveFrom: "2026-11-01", basicSalary: 900000 }),
        salaryAmount: 1100000,
      },
      "AE",
    );
    expect(JSON.parse(update.uae_profile_history)).toHaveLength(2);
  });
});
