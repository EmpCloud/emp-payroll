import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  GLOBAL_EMPLOYEE_CSV_HEADERS,
  parseGlobalEmployeeCsv,
  stringifyGlobalEmployeeCsv,
  type GlobalEmployeeBulkMode,
  type GlobalEmployeeBulkResult,
} from "@emp-payroll/shared";
import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";
import { addGlobalEmployeeSchema, updateGlobalEmployeeSchema } from "../api/validators";
import { GlobalPayrollService } from "./global-payroll.service";
import { readUaeJson, uaeProfileUpdate } from "./uae/uae-payroll.service";

type Row = Record<string, any>;
type CsvRow = ReturnType<typeof parseGlobalEmployeeCsv>["rows"][number];
type RowResult = GlobalEmployeeBulkResult["results"][number];
type Prepared = { result: RowResult; data?: Row; employeeId?: string };

const columns: Record<string, string> = {
  employeeId: "id",
  firstName: "first_name",
  lastName: "last_name",
  email: "email",
  countryCode: "country_id",
  employmentType: "employment_type",
  contractType: "contract_type",
  jobTitle: "job_title",
  department: "department",
  startDate: "start_date",
  endDate: "end_date",
  salaryAmount: "salary_amount",
  salaryCurrency: "salary_currency",
  salaryFrequency: "salary_frequency",
  status: "status",
  empcloudUserId: "empcloud_user_id",
  taxId: "tax_id",
  bankName: "bank_name",
  bankAccount: "bank_account",
  bankRouting: "bank_routing",
  notes: "notes",
  uaeProfile: "uae_profile",
};

function calendarDate(value: unknown): string {
  if (value instanceof Date)
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return String(value ?? "").slice(0, 10);
}

function validateDate(value: string, field: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new AppError(400, "INVALID_CSV_DATE", `${field}: use a real date in YYYY-MM-DD format`);
}

function minorUnits(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value))
    throw new AppError(
      400,
      "INVALID_CSV_SALARY",
      "salaryAmount: use a positive amount with up to two decimal places and no currency symbol or grouping",
    );
  const [whole, fraction = ""] = value.split(".");
  if (whole.replace(/^0+/, "").length > 11)
    throw new AppError(
      400,
      "INVALID_CSV_SALARY",
      "salaryAmount: amount must be at most 10000000000.00",
    );
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (minor <= 0n || minor > 1000000000000n)
    throw new AppError(
      400,
      "INVALID_CSV_SALARY",
      "salaryAmount: amount must be positive and at most 10000000000.00",
    );
  return Number(minor);
}

function messages(error: unknown): string[] {
  if (error instanceof z.ZodError)
    return error.issues.map(
      (issue) => `${issue.path.filter((part) => part !== "body").join(".")}: ${issue.message}`,
    );
  if (error instanceof AppError && error.statusCode < 500) return [error.message];
  return [
    "Unable to process this row. No employees were changed; retry or contact an administrator.",
  ];
}

function display(field: string, value: unknown): string {
  if (value == null) return "";
  if (field === "salaryAmount") return (Number(value) / 100).toFixed(2);
  if (field === "startDate" || field === "endDate") return calendarDate(value);
  if (field === "uaeProfile") return typeof value === "string" ? value : JSON.stringify(value);
  return String(value);
}

/** Preview and apply share validation; apply re-reads the complete organisation inside one transaction. */
export class GlobalEmployeeBulkService {
  private db = getDB();
  private employees = new GlobalPayrollService();

  private async all(table: string, filters: Row = {}): Promise<Row[]> {
    const rows: Row[] = [];
    for (let page = 1; ; page++) {
      const result = await this.db.findMany<Row>(table, {
        filters,
        page,
        limit: 500,
        sort: { field: "id", order: "asc" },
      });
      rows.push(...result.data);
      if (!result.data.length || rows.length >= result.total) return rows;
    }
  }

  private async prepare(
    orgId: string,
    mode: GlobalEmployeeBulkMode,
    rows: CsvRow[],
  ): Promise<Prepared[]> {
    const existing = await this.all("global_employees", { empcloud_org_id: Number(orgId) });
    const countries = await this.all("countries");
    const countryById = new Map(countries.map((country) => [country.id, country]));
    const ids = new Map<string, number>();
    const emails = new Map<string, number>();
    for (const { values } of rows) {
      const id = values.employeeId?.trim();
      const email = values.email?.trim().toLowerCase();
      if (id) ids.set(id, (ids.get(id) ?? 0) + 1);
      if (email) emails.set(email, (emails.get(email) ?? 0) + 1);
    }
    const prepared: Prepared[] = [];
    for (const row of rows) {
      const values = Object.fromEntries(
        Object.entries(row.values).map(([key, value]) => [key, value.trim()]),
      );
      const result: RowResult = {
        row: row.row,
        identifier: mode === "update" ? values.employeeId || "" : values.email || "",
        status: "valid",
        errors: [],
        changes: [],
      };
      const entry: Prepared = { result, employeeId: values.employeeId };
      prepared.push(entry);
      try {
        if (values.employeeId && (ids.get(values.employeeId) ?? 0) > 1)
          result.errors.push("employeeId: appears more than once in this file");
        if (values.email && (emails.get(values.email.toLowerCase()) ?? 0) > 1)
          result.errors.push("email: appears more than once in this file (case-insensitive)");
        if (mode === "create" && values.employeeId)
          result.errors.push("employeeId: leave blank when creating employees");
        if (mode === "create" && values.status)
          result.errors.push("status: leave blank; new employees start in onboarding");
        const employee =
          mode === "update" ? existing.find((item) => item.id === values.employeeId) : null;
        if (mode === "update" && !employee)
          throw new AppError(
            404,
            "NOT_FOUND",
            "employeeId: global employee not found in this organisation",
          );
        let country = employee ? countryById.get(employee.country_id) : undefined;
        if (values.countryCode) {
          if (!/^[A-Za-z]{2}$/.test(values.countryCode))
            throw new AppError(
              400,
              "INVALID_COUNTRY",
              "countryCode: use a two-letter ISO country code",
            );
          // Existing employment remains editable after a country is disabled for new hires.
          // Exported rows include the current country even when that field is unchanged.
          if (country?.code !== values.countryCode.toUpperCase())
            country = countries.find(
              (item) =>
                item.code === values.countryCode.toUpperCase() &&
                (item.is_active === true || Number(item.is_active) === 1),
            );
          if (!country)
            throw new AppError(400, "INVALID_COUNTRY", "countryCode: active country not found");
        }
        if (!country)
          throw new AppError(400, "INVALID_COUNTRY", "countryCode: provide an active country");
        const raw: Row = Object.fromEntries(
          Object.entries(values).filter(
            ([key, value]) => value !== "" && key !== "employeeId" && key !== "countryCode",
          ),
        );
        if (values.countryCode || mode === "create") raw.countryId = country.id;
        if (values.salaryAmount) raw.salaryAmount = minorUnits(values.salaryAmount);
        if (values.salaryCurrency) {
          raw.salaryCurrency = values.salaryCurrency.toUpperCase();
          if (!/^[A-Z]{3}$/.test(raw.salaryCurrency))
            throw new AppError(
              400,
              "INVALID_CURRENCY",
              "salaryCurrency: use a three-letter currency code",
            );
        }
        if (values.empcloudUserId && !/^[1-9]\d*$/.test(values.empcloudUserId))
          throw new AppError(
            400,
            "INVALID_EMPLOYEE_LINK",
            "empcloudUserId: use a positive integer employee ID",
          );
        for (const field of ["startDate", "endDate"])
          if (values[field]) validateDate(values[field], field);
        const start = values.startDate || calendarDate(employee?.start_date);
        const end = values.endDate || calendarDate(employee?.end_date);
        if (start && end && end < start)
          throw new AppError(400, "INVALID_CSV_DATE", "endDate: must be on or after startDate");
        if (values.uaeProfile) {
          try {
            raw.uaeProfile = JSON.parse(values.uaeProfile);
          } catch {
            throw new AppError(
              400,
              "INVALID_UAE_PROFILE",
              "uaeProfile: provide a valid JSON object",
            );
          }
        }
        let data: Row =
          mode === "create"
            ? addGlobalEmployeeSchema.parse({ body: raw }).body
            : updateGlobalEmployeeSchema.parse({ params: { id: values.employeeId }, body: raw })
                .body;
        if (
          values.email &&
          existing.some(
            (item) =>
              item.id !== employee?.id &&
              String(item.email).trim().toLowerCase() === values.email.toLowerCase(),
          )
        )
          result.errors.push("email: already belongs to another employee in this organisation");
        if (employee?.uae_profile && data.countryId && data.countryId !== employee.country_id)
          throw new AppError(
            409,
            "UAE_EMPLOYMENT_TRANSFER",
            "Create a separate employment record for a cross-country transfer to preserve UAE history",
          );
        if (mode === "create")
          data = { ...data, salaryCurrency: data.salaryCurrency ?? country.currency };
        for (const [key, after] of Object.entries(data)) {
          const field = key === "countryId" ? "countryCode" : key;
          const previous = employee?.[columns[field]];
          const before = field === "countryCode" ? countryById.get(previous)?.code : previous;
          const next = field === "countryCode" ? country.code : after;
          const equal =
            field === "uaeProfile"
              ? isDeepStrictEqual(readUaeJson(before, null), next)
              : display(field, before) === display(field, next);
          if (!equal)
            result.changes.push({
              field,
              before: display(field, before),
              after: display(field, next),
            });
        }
        if (mode === "update") {
          const changed = new Set(result.changes.map((change) => change.field));
          data = Object.fromEntries(
            Object.entries(data).filter(
              ([key]) =>
                changed.has(key === "countryId" ? "countryCode" : key) ||
                (key === "uaeProfile" &&
                  ["salaryAmount", "salaryCurrency", "salaryFrequency"].some((field) =>
                    changed.has(field),
                  )),
            ),
          );
          if (!result.changes.length) result.status = "unchanged";
        }
        uaeProfileUpdate(employee, data, country.code);
        if (
          mode === "create" ||
          data.empcloudUserId !== undefined ||
          (data.email !== undefined && employee?.empcloud_user_id)
        )
          await this.employees.validateEmployeeLink(
            orgId,
            data.empcloudUserId ?? employee?.empcloud_user_id,
            data.email ?? employee?.email,
          );
        entry.data = data;
      } catch (error) {
        result.errors.push(...messages(error));
      }
      if (result.errors.length) result.status = "error";
    }
    return prepared;
  }

  async process(
    orgId: string,
    request: { mode: GlobalEmployeeBulkMode; csv: string; apply?: boolean },
  ): Promise<GlobalEmployeeBulkResult> {
    if (!["create", "update"].includes(request.mode))
      throw new AppError(400, "INVALID_BULK_MODE", "Select create or update mode");
    if (typeof request.csv !== "string" || Buffer.byteLength(request.csv, "utf8") > 2 * 1024 * 1024)
      throw new AppError(400, "CSV_TOO_LARGE", "CSV must be at most 2 MB");
    let rows: CsvRow[];
    try {
      rows = parseGlobalEmployeeCsv(request.csv).rows;
    } catch (error) {
      throw new AppError(
        400,
        "INVALID_CSV",
        error instanceof Error ? error.message : "Invalid CSV file",
      );
    }
    if (!rows.length || rows.length > 500)
      throw new AppError(400, "INVALID_CSV_ROWS", "Provide between 1 and 500 employee rows");
    const summarize = (prepared: Prepared[], applied = false): GlobalEmployeeBulkResult => ({
      mode: request.mode,
      total: prepared.length,
      valid: prepared.filter((entry) => !entry.result.errors.length).length,
      invalid: prepared.filter((entry) => entry.result.errors.length).length,
      applied,
      results: prepared.map((entry) => entry.result),
    });
    if (!request.apply) return summarize(await this.prepare(orgId, request.mode, rows));
    let prepared: Prepared[] = [];
    let current: Prepared | undefined;
    try {
      return await this.db.transaction(async () => {
        prepared = await this.prepare(orgId, request.mode, rows);
        if (prepared.some((entry) => entry.result.errors.length)) return summarize(prepared);
        if (prepared.every((entry) => entry.result.status === "unchanged"))
          return summarize(prepared);
        for (const entry of prepared) {
          if (entry.result.status === "unchanged") continue;
          current = entry;
          if (request.mode === "create") await this.employees.addGlobalEmployee(orgId, entry.data);
          else await this.employees.updateGlobalEmployee(orgId, entry.employeeId!, entry.data);
        }
        prepared.forEach((entry) => {
          if (entry.result.status !== "unchanged")
            entry.result.status = request.mode === "create" ? "created" : "updated";
        });
        return summarize(prepared, true);
      });
    } catch (error) {
      if (!prepared.length)
        throw new AppError(
          500,
          "BULK_APPLY_FAILED",
          "Unable to apply employees. No changes were saved.",
        );
      prepared.forEach((entry) => {
        if (entry.result.status !== "unchanged") entry.result.status = "valid";
      });
      const failed = current ?? prepared[0];
      failed.result.status = "error";
      failed.result.errors.push(...messages(error));
      return summarize(prepared);
    }
  }

  template(mode: GlobalEmployeeBulkMode): string {
    if (!["create", "update"].includes(mode))
      throw new AppError(400, "INVALID_BULK_MODE", "Select create or update mode");
    return stringifyGlobalEmployeeCsv([...GLOBAL_EMPLOYEE_CSV_HEADERS], []);
  }

  async export(orgId: string): Promise<string> {
    const employees = await this.all("global_employees", { empcloud_org_id: Number(orgId) });
    const countries = new Map(
      (await this.all("countries")).map((country) => [country.id, country.code]),
    );
    return stringifyGlobalEmployeeCsv(
      [...GLOBAL_EMPLOYEE_CSV_HEADERS],
      employees.map((employee) =>
        GLOBAL_EMPLOYEE_CSV_HEADERS.map((field) =>
          display(
            field,
            field === "countryCode" ? countries.get(employee.country_id) : employee[columns[field]],
          ),
        ),
      ),
    );
  }
}
