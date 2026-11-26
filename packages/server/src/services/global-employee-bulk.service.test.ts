import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GLOBAL_EMPLOYEE_CSV_HEADERS,
  parseGlobalEmployeeCsv,
  stringifyGlobalEmployeeCsv,
} from "@emp-payroll/shared";

vi.mock("../db/adapters", () => ({ getDB: vi.fn() }));
vi.mock("../db/empcloud", () => ({ findUserById: vi.fn() }));
import { getDB } from "../db/adapters";
import { findUserById } from "../db/empcloud";
import { GlobalEmployeeBulkService } from "./global-employee-bulk.service";

type Row = Record<string, any>;
const base = {
  firstName: "Aisha",
  lastName: "Example",
  email: "aisha@example.test",
  countryCode: "US",
  employmentType: "direct_hire",
  contractType: "full_time",
  jobTitle: "Engineer",
  startDate: "2026-10-01",
  salaryAmount: "10000.01",
  salaryCurrency: "USD",
  salaryFrequency: "monthly",
};
const saved = (overrides: Row = {}) => ({
  id: "employee-1",
  empcloud_org_id: 1,
  first_name: "Aisha",
  last_name: "Example",
  email: "aisha@example.test",
  country_id: "us",
  employment_type: "direct_hire",
  contract_type: "full_time",
  job_title: "Engineer",
  department: "Engineering",
  start_date: "2026-10-01",
  end_date: null,
  salary_amount: 1000001,
  salary_currency: "USD",
  salary_frequency: "monthly",
  status: "active",
  bank_account: "00123456",
  notes: "Keep this",
  ...overrides,
});
const profile = () => ({
  jurisdiction: "federal",
  effectiveFrom: "2026-10-01",
  nationality: "IN",
  basicSalary: 800000,
  allowances: [{ name: "Housing", amount: 200000 }],
  normalDailyHours: 8,
  pension: { scheme: "none" },
  iloe: { mode: "employee_paid" },
  healthInsuranceEmployer: 0,
  savings: { scheme: "gratuity" },
  wps: {},
});
function csv(rows: Row[], headers = [...GLOBAL_EMPLOYEE_CSV_HEADERS]): string {
  return stringifyGlobalEmployeeCsv(
    headers,
    rows.map((row) => headers.map((header) => String(row[header] ?? ""))),
  );
}

function memoryDb() {
  let tables: Record<string, Row[]> = {
    countries: [
      { id: "us", code: "US", currency: "USD", is_active: 1 },
      { id: "ae", code: "AE", currency: "AED", is_active: 1 },
      { id: "gb", code: "GB", currency: "GBP", is_active: 0 },
    ],
    global_employees: [],
    compliance_checklist: [],
  };
  let sequence = 0;
  let failEmail = "";
  let failUpdateId = "";
  let beforeTransaction: (() => void) | undefined;
  const rows = (table: string) => (tables[table] ??= []);
  const matches = (row: Row, filter: Row) =>
    Object.entries(filter).every(([key, value]) => row[key] === value);
  const db = {
    findMany: vi.fn(async (table: string, options: Row = {}) => {
      const all = rows(table).filter((row) => matches(row, options.filters ?? {}));
      const page = options.page ?? 1,
        limit = options.limit ?? 20;
      return {
        data: structuredClone(all.slice((page - 1) * limit, page * limit)),
        total: all.length,
        page,
        limit,
        totalPages: Math.ceil(all.length / limit),
      };
    }),
    findById: vi.fn(async (table: string, id: string) =>
      structuredClone(rows(table).find((row) => row.id === id) ?? null),
    ),
    findOne: vi.fn(async (table: string, filter: Row) =>
      structuredClone(rows(table).find((row) => matches(row, filter)) ?? null),
    ),
    create: vi.fn(async (table: string, data: Row) => {
      if (data.email === failEmail)
        throw new Error("SQL password=secret-value internal-table-name");
      const row = { id: `created-${++sequence}`, ...structuredClone(data) };
      rows(table).push(row);
      return structuredClone(row);
    }),
    update: vi.fn(async (table: string, id: string, data: Row) => {
      if (id === failUpdateId) throw new Error("Internal storage failure");
      const row = rows(table).find((item) => item.id === id)!;
      Object.assign(row, structuredClone(data));
      return structuredClone(row);
    }),
    transaction: vi.fn(async (fn: () => Promise<unknown>) => {
      beforeTransaction?.();
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
    rows,
    failFor: (email: string) => {
      failEmail = email;
    },
    failUpdate: (id: string) => {
      failUpdateId = id;
    },
    beforeTransaction: (fn: () => void) => {
      beforeTransaction = fn;
    },
  };
}

describe("Global employee CSV bulk service", () => {
  let fixture: ReturnType<typeof memoryDb>;
  let service: GlobalEmployeeBulkService;
  beforeEach(() => {
    vi.clearAllMocks();
    fixture = memoryDb();
    vi.mocked(getDB).mockReturnValue(fixture.db as any);
    vi.mocked(findUserById).mockReset();
    service = new GlobalEmployeeBulkService();
  });
  const noWrites = () => {
    expect(fixture.db.create).not.toHaveBeenCalled();
    expect(fixture.db.update).not.toHaveBeenCalled();
  };

  it("previews exact money and defaults without any writes or transaction", async () => {
    const preview = await service.process("1", { mode: "create", csv: csv([base]) });
    expect(preview).toMatchObject({
      total: 1,
      valid: 1,
      invalid: 0,
      applied: false,
      results: [{ row: 2, identifier: base.email, status: "valid" }],
    });
    expect(preview.results[0].changes).toContainEqual({
      field: "salaryAmount",
      before: "",
      after: "10000.01",
    });
    noWrites();
    expect(fixture.db.transaction).not.toHaveBeenCalled();
  });

  it("applies creates through normal onboarding and compliance checklist creation", async () => {
    const result = await service.process("1", { mode: "create", csv: csv([base]), apply: true });
    expect(result).toMatchObject({ applied: true, results: [{ status: "created" }] });
    expect(fixture.rows("global_employees")[0]).toMatchObject({
      salary_amount: 1000001,
      status: "onboarding",
      empcloud_org_id: 1,
    });
    expect(fixture.rows("compliance_checklist")).toHaveLength(10);
  });

  it.each(["1.001", "1e3", "1,000.00", "-1.00", "0.00", "10000000000.01"])(
    "rejects invalid money %s before writes",
    async (salaryAmount) => {
      const result = await service.process("1", {
        mode: "create",
        csv: csv([{ ...base, salaryAmount }]),
        apply: true,
      });
      expect(result).toMatchObject({ applied: false, invalid: 1 });
      noWrites();
    },
  );

  it("converts small decimal amounts exactly and defaults country currency", async () => {
    const result = await service.process("1", {
      mode: "create",
      csv: csv([{ ...base, salaryAmount: "0.29", salaryCurrency: "" }]),
      apply: true,
    });
    expect(result.applied).toBe(true);
    expect(fixture.rows("global_employees")[0]).toMatchObject({
      salary_amount: 29,
      salary_currency: "USD",
    });
  });

  it("preserves blank update cells and omits identical columns", async () => {
    fixture.rows("global_employees").push(saved());
    const result = await service.process("1", {
      mode: "update",
      csv: csv([
        {
          employeeId: "employee-1",
          jobTitle: "Senior Engineer",
          bankAccount: "",
          notes: "",
          salaryAmount: "10000.01",
        },
      ]),
      apply: true,
    });
    expect(result).toMatchObject({
      applied: true,
      results: [
        {
          status: "updated",
          changes: [{ field: "jobTitle", before: "Engineer", after: "Senior Engineer" }],
        },
      ],
    });
    expect(fixture.db.update).toHaveBeenCalledWith("global_employees", "employee-1", {
      job_title: "Senior Engineer",
    });
    expect(fixture.rows("global_employees")[0]).toMatchObject({
      bank_account: "00123456",
      notes: "Keep this",
      salary_amount: 1000001,
    });
  });

  it("skips unchanged updates while rejecting cross-organisation targets and inactive countries", async () => {
    fixture.rows("global_employees").push(saved(), saved({ id: "foreign", empcloud_org_id: 2 }));
    const result = await service.process("1", {
      mode: "update",
      csv: csv([
        { employeeId: "employee-1", jobTitle: "Engineer" },
        { employeeId: "foreign", jobTitle: "Changed" },
        { employeeId: "missing", jobTitle: "Changed" },
      ]),
      apply: true,
    });
    expect(result.invalid).toBe(2);
    expect(result.results[0].status).toBe("unchanged");
    expect(result.results[1].errors).toEqual(result.results[2].errors);
    const inactive = await service.process("1", {
      mode: "create",
      csv: csv([{ ...base, countryCode: "GB" }]),
    });
    expect(inactive.invalid).toBe(1);
    noWrites();
  });

  it("reports both duplicate employee IDs and both case-insensitive file emails", async () => {
    fixture.rows("global_employees").push(saved());
    const ids = await service.process("1", {
      mode: "update",
      csv: csv([
        { employeeId: "employee-1", jobTitle: "One" },
        { employeeId: "employee-1", jobTitle: "Two" },
      ]),
    });
    expect(ids.invalid).toBe(2);
    const emails = await service.process("1", {
      mode: "create",
      csv: csv([
        { ...base, email: "NEW@example.test" },
        { ...base, email: "new@EXAMPLE.test" },
      ]),
    });
    expect(emails.invalid).toBe(2);
    noWrites();
  });

  it("detects existing email collisions beyond the first page, including updates", async () => {
    for (let i = 0; i < 501; i++)
      fixture
        .rows("global_employees")
        .push(saved({ id: `employee-${i}`, email: `person${i}@example.test` }));
    const create = await service.process("1", {
      mode: "create",
      csv: csv([{ ...base, email: "PERSON500@example.test" }]),
    });
    const update = await service.process("1", {
      mode: "update",
      csv: csv([{ employeeId: "employee-1", email: "PERSON500@example.test" }]),
    });
    expect(create.invalid).toBe(1);
    expect(update.invalid).toBe(1);
    noWrites();
  });

  it.each([{ startDate: "2026-02-30" }, { startDate: "10/01/2026" }, { endDate: "2026-09-30" }])(
    "validates calendar dates and effective date order %j",
    async (fields) => {
      fixture.rows("global_employees").push(saved());
      const result = await service.process("1", {
        mode: "update",
        csv: csv([{ employeeId: "employee-1", ...fields }]),
        apply: true,
      });
      expect(result.invalid).toBe(1);
      noWrites();
    },
  );

  it("does not save a valid row when another row fails validation", async () => {
    const result = await service.process("1", {
      mode: "create",
      csv: csv([base, { ...base, email: "bad", status: "active" }]),
      apply: true,
    });
    expect(result).toMatchObject({ applied: false, valid: 1, invalid: 1 });
    noWrites();
  });

  it("revalidates current organisation data inside the apply transaction", async () => {
    expect((await service.process("1", { mode: "create", csv: csv([base]) })).valid).toBe(1);
    fixture.beforeTransaction(() => fixture.rows("global_employees").push(saved()));
    const result = await service.process("1", { mode: "create", csv: csv([base]), apply: true });
    expect(result).toMatchObject({ applied: false, invalid: 1 });
    noWrites();
  });

  it("rolls back employees and checklist rows on a later storage failure without leaking internals", async () => {
    fixture.failFor("second@example.test");
    const result = await service.process("1", {
      mode: "create",
      csv: csv([base, { ...base, email: "second@example.test" }]),
      apply: true,
    });
    expect(result).toMatchObject({
      applied: false,
      valid: 1,
      invalid: 1,
      results: [{ status: "valid" }, { status: "error" }],
    });
    expect(JSON.stringify(result)).not.toMatch(/secret-value|internal-table-name/);
    expect(fixture.rows("global_employees")).toEqual([]);
    expect(fixture.rows("compliance_checklist")).toEqual([]);
  });

  it("reuses linked employee ownership and email validation in preview", async () => {
    vi.mocked(findUserById).mockResolvedValue({
      id: 42,
      organization_id: 2,
      email: base.email,
    } as any);
    expect(
      (
        await service.process("1", {
          mode: "create",
          csv: csv([{ ...base, empcloudUserId: "42" }]),
        })
      ).invalid,
    ).toBe(1);
    vi.mocked(findUserById).mockResolvedValue({
      id: 42,
      organization_id: 1,
      email: base.email.toUpperCase(),
    } as any);
    expect(
      (
        await service.process("1", {
          mode: "create",
          csv: csv([{ ...base, empcloudUserId: "42" }]),
        })
      ).valid,
    ).toBe(1);
    noWrites();
  });

  it("retains UAE salary, currency, profile and country-transfer guards", async () => {
    fixture.rows("global_employees").push(
      saved({
        country_id: "ae",
        salary_amount: 1000000,
        salary_currency: "AED",
        uae_profile: JSON.stringify(profile()),
      }),
    );
    for (const fields of [
      { salaryAmount: "11000.00" },
      { salaryAmount: "11000.00", uaeProfile: JSON.stringify(profile()) },
      { countryCode: "US" },
      { uaeProfile: "bad-json" },
      { salaryCurrency: "USD", uaeProfile: JSON.stringify(profile()) },
    ]) {
      expect(
        (
          await service.process("1", {
            mode: "update",
            csv: csv([{ employeeId: "employee-1", ...fields }]),
            apply: true,
          })
        ).invalid,
      ).toBe(1);
    }
    noWrites();
    const newProfile = { ...profile(), basicSalary: 900000 };
    expect(
      (
        await service.process("1", {
          mode: "update",
          csv: csv([
            {
              employeeId: "employee-1",
              salaryAmount: "11000.00",
              uaeProfile: JSON.stringify(newProfile),
            },
          ]),
          apply: true,
        })
      ).applied,
    ).toBe(true);
    expect(JSON.parse(fixture.rows("global_employees")[0].uae_profile).basicSalary).toBe(900000);
  });

  it("allows UAE onboarding without a profile and optional blank bank fields", async () => {
    const result = await service.process("1", {
      mode: "create",
      csv: csv([
        { ...base, countryCode: "AE", salaryCurrency: "AED", bankName: "", bankAccount: "" },
      ]),
      apply: true,
    });
    expect(result.applied).toBe(true);
    expect(fixture.rows("global_employees")[0]).toMatchObject({
      status: "onboarding",
      bank_name: null,
      bank_account: null,
    });
  });

  it("keeps unchanged UAE salary columns out of an unrelated update", async () => {
    fixture.rows("global_employees").push(
      saved({
        country_id: "ae",
        salary_amount: 1000000,
        salary_currency: "AED",
        uae_profile: JSON.stringify(profile()),
      }),
    );
    const result = await service.process("1", {
      mode: "update",
      csv: csv([{ employeeId: "employee-1", salaryAmount: "10000.00", notes: "Reviewed" }]),
      apply: true,
    });
    expect(result.applied).toBe(true);
    expect(fixture.db.update).toHaveBeenCalledWith("global_employees", "employee-1", {
      notes: "Reviewed",
    });
  });

  it("reports the physical starting row after a multiline CSV record", async () => {
    const result = await service.process("1", {
      mode: "create",
      csv: csv([
        { ...base, notes: "First line\nSecond line" },
        { ...base, email: "invalid-email" },
      ]),
    });
    expect(result.results.map((entry) => [entry.row, entry.status])).toEqual([
      [2, "valid"],
      [4, "error"],
    ]);
    noWrites();
  });

  it("exports all tenant employees with exact money, IDs and safe CSV values", async () => {
    for (let i = 0; i < 501; i++)
      fixture.rows("global_employees").push(
        saved({
          id: `employee-${i}`,
          email: `person${i}@example.test`,
          notes: i === 500 ? '=HYPERLINK("https://example.test")' : "Keep this",
        }),
      );
    fixture.rows("global_employees").push(saved({ id: "foreign", empcloud_org_id: 2 }));
    const output = await service.export("1");
    const lines = output.trimEnd().split(/\r?\n/);
    expect(lines).toHaveLength(502);
    const parsed = parseGlobalEmployeeCsv(`${lines[0]}\r\n${lines[501]}\r\n`);
    expect(parsed.rows[0].values).toMatchObject({
      employeeId: "employee-500",
      salaryAmount: "10000.01",
      countryCode: "US",
      bankAccount: "00123456",
    });
    expect(output).toContain("'=HYPERLINK");
    expect(output).not.toContain("foreign");
    noWrites();
  });

  it("rejects oversized CSV, excess rows and invalid headers without writes", async () => {
    await expect(
      service.process("1", { mode: "create", csv: "x".repeat(2 * 1024 * 1024 + 1) }),
    ).rejects.toMatchObject({ code: "CSV_TOO_LARGE" });
    await expect(
      service.process("1", { mode: "create", csv: csv(Array.from({ length: 501 }, () => base)) }),
    ).rejects.toMatchObject({ code: "INVALID_CSV" });
    await expect(
      service.process("1", { mode: "create", csv: "email,email\na,b" }),
    ).rejects.toMatchObject({ code: "INVALID_CSV" });
    await expect(service.process("1", { mode: "create", csv: "unknown\na" })).rejects.toMatchObject(
      { code: "INVALID_CSV" },
    );
    noWrites();
  });

  it("provides a header-only template with the full update identifier column", () => {
    expect(service.template("create")).toBe(
      stringifyGlobalEmployeeCsv(GLOBAL_EMPLOYEE_CSV_HEADERS, []),
    );
    expect(service.template("update")).toBe(service.template("create"));
    noWrites();
  });

  it("exports two employees, changes one and leaves the other UAE profile history untouched", async () => {
    const uae = saved({
      id: "employee-2",
      email: "uae@example.test",
      country_id: "ae",
      salary_amount: 1000000,
      salary_currency: "AED",
      uae_profile: JSON.stringify(profile()),
      uae_profile_history: JSON.stringify([profile()]),
    });
    fixture.rows("global_employees").push(saved(), uae);
    const exported = parseGlobalEmployeeCsv(await service.export("1"));
    exported.rows[0].values.jobTitle = "Senior Engineer";
    const changedCsv = csv(exported.rows.map((row) => row.values));
    const result = await service.process("1", { mode: "update", csv: changedCsv, apply: true });
    expect(result).toMatchObject({
      applied: true,
      valid: 2,
      invalid: 0,
      results: [{ status: "updated" }, { status: "unchanged", changes: [] }],
    });
    expect(fixture.db.update).toHaveBeenCalledTimes(1);
    expect(fixture.rows("global_employees")[1]).toEqual(uae);
    fixture.db.update.mockClear();
    const repeated = await service.process("1", { mode: "update", csv: changedCsv, apply: true });
    expect(repeated).toMatchObject({
      applied: false,
      valid: 2,
      results: [{ status: "unchanged" }, { status: "unchanged" }],
    });
    noWrites();
  });

  it("keeps unchanged rows unchanged and rolls back earlier updates after failure", async () => {
    fixture
      .rows("global_employees")
      .push(
        saved(),
        saved({ id: "employee-2", email: "second@example.test" }),
        saved({ id: "employee-3", email: "third@example.test" }),
      );
    fixture.failUpdate("employee-3");
    const result = await service.process("1", {
      mode: "update",
      apply: true,
      csv: csv([
        { employeeId: "employee-1", jobTitle: "Engineer" },
        { employeeId: "employee-2", jobTitle: "Senior Engineer" },
        { employeeId: "employee-3", jobTitle: "Senior Engineer" },
      ]),
    });
    expect(result).toMatchObject({
      applied: false,
      results: [{ status: "unchanged" }, { status: "valid" }, { status: "error" }],
    });
    expect(fixture.rows("global_employees").map((employee) => employee.job_title)).toEqual([
      "Engineer",
      "Engineer",
      "Engineer",
    ]);
  });

  it("applies an exported mixed batch with an unchanged employee in an inactive country", async () => {
    const inactive = saved({
      id: "employee-2",
      email: "inactive-country@example.test",
      country_id: "gb",
      salary_currency: "GBP",
    });
    fixture.rows("global_employees").push(saved(), inactive);
    const exported = parseGlobalEmployeeCsv(await service.export("1"));
    exported.rows[0].values.jobTitle = "Senior Engineer";
    const result = await service.process("1", {
      mode: "update",
      csv: csv(exported.rows.map((row) => row.values)),
      apply: true,
    });
    expect(result).toMatchObject({
      applied: true,
      valid: 2,
      invalid: 0,
      results: [{ status: "updated" }, { status: "unchanged", changes: [] }],
    });
    expect(fixture.db.update).toHaveBeenCalledTimes(1);
    expect(fixture.db.update).toHaveBeenCalledWith("global_employees", "employee-1", {
      job_title: "Senior Engineer",
    });
    expect(fixture.rows("global_employees")[1]).toEqual(inactive);
  });

  it("still blocks new hires and transfers into an inactive country", async () => {
    fixture.rows("global_employees").push(saved());
    const create = await service.process("1", {
      mode: "create",
      csv: csv([{ ...base, countryCode: "GB", salaryCurrency: "GBP" }]),
      apply: true,
    });
    const transfer = await service.process("1", {
      mode: "update",
      csv: csv([{ employeeId: "employee-1", countryCode: "GB", salaryCurrency: "GBP" }]),
      apply: true,
    });
    for (const result of [create, transfer]) {
      expect(result).toMatchObject({ applied: false, invalid: 1 });
      expect(result.results[0].errors).toContain("countryCode: active country not found");
    }
    noWrites();
  });
});
