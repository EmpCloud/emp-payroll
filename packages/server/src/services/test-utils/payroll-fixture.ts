import { vi } from "vitest";

/** In-memory payroll/attendance fixture: every database write stays inside a spy. */
export function makePayrollFixture(
  options: { month?: number; year?: number; employeeCount?: number } = {},
) {
  const run: any = {
    id: "run-1",
    empcloud_org_id: 1,
    status: "draft",
    month: options.month ?? 10,
    year: options.year ?? 2026,
  };
  const days = new Date(Date.UTC(run.year, run.month, 0)).getUTCDate();
  const settings: any = { state: "KA" };
  const employees = Array.from({ length: options.employeeCount ?? 1 }, (_, index) => ({
    id: 100 + index,
    organization_id: 1,
    first_name: `Employee${index}`,
    last_name: "Test",
    date_of_joining: "2020-01-01",
    date_of_exit: null,
  }));
  const profiles: Record<number, any> = {};
  const salaries: Record<number, any> = {};
  const attendance: Record<number, any[]> = {};
  const summaries: Record<number, any> = {};
  const templates: Record<string, any[]> = {};
  const loans: Record<number, any[]> = {};
  const reimbursements: Record<number, any[]> = {};
  const priorPayslips: Record<number, any[]> = {};
  for (const employee of employees) {
    profiles[employee.id] = {
      id: `profile-${employee.id}`,
      empcloud_org_id: 1,
      empcloud_user_id: employee.id,
      pf_details: { isEnrolled: true, isEpsMember: true },
      tax_info: { pan: "ABCDE1234F", regime: "new" },
      esi_details: { isEligible: false },
    };
    salaries[employee.id] = {
      gross_salary: 600000,
      is_active: true,
      components: [
        { code: "BASIC", type: "earning", monthlyAmount: 25000 },
        { code: "HRA", type: "earning", monthlyAmount: 12500 },
        { code: "SPECIAL", type: "earning", monthlyAmount: 12500 },
      ],
    };
    attendance[employee.id] = Array.from({ length: days }, (_, index) => ({
      date: `${run.year}-${String(run.month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`,
      status: "present",
    }));
  }
  const db = {
    findOne: vi.fn(async (table: string, where: any) => {
      if (table === "payroll_runs") return run;
      if (table === "organization_payroll_settings") return settings;
      if (table === "employee_payroll_profiles") return profiles[where.empcloud_user_id] ?? null;
      if (table === "employee_salaries") return salaries[where.empcloud_user_id] ?? null;
      if (table === "attendance_summaries") return summaries[where.empcloud_user_id] ?? null;
      return null;
    }),
    findMany: vi.fn(async (table: string, options?: any) => {
      const data =
        table === "salary_components"
          ? (templates[options?.filters?.structure_id] ?? [])
          : table === "loans"
            ? (loans[Number(options?.filters?.employee_id)] ?? [])
            : table === "reimbursements"
              ? (reimbursements[Number(options?.filters?.employee_id)] ?? [])
              : table === "payslips"
                ? (priorPayslips[Number(options?.filters?.empcloud_user_id)] ?? [])
                : [];
      return { data, total: data.length };
    }),
    findById: vi.fn().mockResolvedValue(null),
    create: vi.fn(async (_table: string, data: any) => ({ id: "created-id", ...data })),
    update: vi.fn(async (table: string, _id: string, data: any) => {
      if (table === "payroll_runs") Object.assign(run, data);
      return data;
    }),
    updateMany: vi.fn().mockResolvedValue(0),
    deleteMany: vi.fn().mockResolvedValue(0),
    raw: vi.fn().mockResolvedValue([]),
  };
  const externalWrites = vi.fn().mockResolvedValue(0);
  const empcloudDb: any = vi.fn((table: string) => {
    let employeeId = 100;
    let columns: string[] = [];
    const rows = () => {
      if (table === "attendance_records") {
        const daily = attendance[employeeId] ?? [];
        if (columns.some((column) => column.includes("SUM("))) {
          return [
            {
              present_days: daily.filter((row) => row.status === "present").length,
              leave_days: 0,
              total_records: daily.length,
            },
          ];
        }
        return daily;
      }
      return [];
    };
    const query: any = {};
    query.where = vi.fn((key: unknown, value: unknown) => {
      if (typeof key === "string" && (key === "user_id" || key.endsWith(".user_id")))
        employeeId = Number(value);
      return query;
    });
    for (const method of [
      "whereBetween",
      "andWhere",
      "orWhere",
      "orWhereNull",
      "whereNull",
      "whereIn",
      "leftJoin",
      "join",
    ]) {
      query[method] = vi.fn().mockReturnValue(query);
    }
    query.select = vi.fn((...names: string[]) => {
      columns = names;
      return query;
    });
    query.first = vi.fn(async () =>
      table.startsWith("leave_applications") ? { paid_leave: 0, unpaid_leave: 0 } : rows()[0],
    );
    query.then = (resolve: (value: any) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(rows()).then(resolve, reject);
    for (const method of ["insert", "update", "delete", "del"]) query[method] = externalWrites;
    return query;
  });
  empcloudDb.raw = vi.fn((sql: string) => sql);
  return {
    run,
    settings,
    employees,
    profiles,
    salaries,
    attendance,
    summaries,
    templates,
    loans,
    reimbursements,
    priorPayslips,
    db,
    empcloudDb,
    externalWrites,
  };
}
