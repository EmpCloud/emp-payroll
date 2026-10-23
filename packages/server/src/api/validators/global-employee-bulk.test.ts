import { describe, expect, it } from "vitest";
import {
  parseGlobalEmployeeCsv,
  stringifyGlobalEmployeeCsv,
  GLOBAL_EMPLOYEE_CSV_MAX_ROWS,
} from "@emp-payroll/shared";
import { globalEmployeeBulkSchema, globalEmployeeBulkTemplateSchema } from "./global-employee-bulk";

describe("Global employee bulk CSV boundary", () => {
  it("reads BOM, quoted commas, escaped quotes and multiline records with physical row numbers", () => {
    const csv =
      '\uFEFFemail,notes\r\na@example.com,"First line\r\nA, \"\"quoted\"\" value"\r\nb@example.com,Plain\r\n';
    expect(parseGlobalEmployeeCsv(csv).rows).toEqual([
      { row: 2, values: { email: "a@example.com", notes: 'First line\nA, "quoted" value' } },
      { row: 4, values: { email: "b@example.com", notes: "Plain" } },
    ]);
  });

  it.each([
    ["email,email\na@b.com,b@b.com", "unique"],
    ["email,empcloudOrgId\na@b.com,7", "Unknown CSV columns"],
    ["email,\na@b.com,", "header"],
    ['email,notes\na@b.com,"unclosed', "not closed"],
    ['email,notes\na@b.com,"value"other', "unexpected text"],
    ["email,notes\na@b.com", "expected 2 columns"],
    ["email\n", "at least one"],
  ])("rejects malformed or unsupported CSV %s", (csv, message) => {
    expect(() => parseGlobalEmployeeCsv(csv)).toThrow(message);
  });

  it("enforces row and UTF-8 byte limits", () => {
    const csv = "email\n" + "a@example.com\n".repeat(GLOBAL_EMPLOYEE_CSV_MAX_ROWS);
    expect(parseGlobalEmployeeCsv(csv).rows).toHaveLength(GLOBAL_EMPLOYEE_CSV_MAX_ROWS);
    expect(() => parseGlobalEmployeeCsv(csv + "b@example.com")).toThrow("500");
    expect(() => parseGlobalEmployeeCsv("notes\n" + "界".repeat(700000))).toThrow("2 MB");
  });

  it("exports spreadsheet-safe text and round-trips quotes, formula-like data and profile JSON", () => {
    const values = [
      '=HYPERLINK("https://example.test")',
      "+value",
      "-value",
      "@value",
      "'literal",
      "\tvalue",
      "\nvalue",
    ];
    const csv = stringifyGlobalEmployeeCsv(
      ["notes", "uaeProfile"],
      values.map((value) => [value, '{"basicSalary":1000000,"allowances":[]}']),
    );
    expect(csv).toContain("\"'=HYPERLINK");
    const parsed = parseGlobalEmployeeCsv(csv);
    expect(parsed.rows.map((row) => row.values.notes)).toEqual(values);
    expect(
      parsed.rows.every((row) => JSON.parse(row.values.uaeProfile).basicSalary === 1000000),
    ).toBe(true);
  });

  it("defaults to read-only preview and accepts only explicit boolean apply", () => {
    const body = { mode: "update", csv: "employeeId,department\nid,QA" };
    expect(globalEmployeeBulkSchema.parse({ body }).body.apply).toBe(false);
    expect(globalEmployeeBulkSchema.safeParse({ body: { ...body, apply: "true" } }).success).toBe(
      false,
    );
    expect(globalEmployeeBulkSchema.safeParse({ body: { ...body, orgId: 7 } }).success).toBe(false);
    expect(globalEmployeeBulkTemplateSchema.parse({ query: {} }).query.mode).toBe("create");
  });
});
