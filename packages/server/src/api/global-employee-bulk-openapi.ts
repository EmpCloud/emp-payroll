import { GLOBAL_EMPLOYEE_CSV_HEADERS } from "@emp-payroll/shared";

const mode = { type: "string", enum: ["create", "update"] };
const errors = {
  "400": { description: "Invalid CSV, unsupported headers, request or batch limits exceeded" },
  "401": { description: "Authentication required" },
  "403": { description: "HR administrator or manager access required" },
};
const csvResponse = {
  description:
    "UTF-8 CSV attachment with a BOM; text cells are protected against spreadsheet formulas",
  content: { "text/csv": { schema: { type: "string" } } },
};
export const globalEmployeeBulkApiPaths = {
  "/global/employees/bulk": {
    post: {
      tags: ["Global payroll"],
      summary: "Preview or apply a global employee CSV upload or update",
      description: `HR admin/manager, scoped to the authenticated organisation. Maximum 500 employee rows and 2 MB UTF-8 CSV. Supported columns: ${GLOBAL_EMPLOYEE_CSV_HEADERS.join(", ")}. Use ISO2 countryCode, YYYY-MM-DD dates, and salaryAmount in major currency units with up to two decimal places (10000.00 AED becomes 1000000 fils). The optional uaeProfile column contains the complete statutory profile as JSON with monetary values in minor units. UAE salary amendments require a matching full profile. Create mode produces onboarding employees. Update mode requires employeeId; blank cells leave fields unchanged. Unknown columns, duplicate identifiers and invalid rows block the entire batch. Preview performs no writes; apply validates current records again and writes all rows in one transaction. Results include physical CSV line numbers, row errors and before/after values.`,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["mode", "csv"],
              properties: {
                mode,
                csv: { type: "string", maxLength: 2097152 },
                apply: { type: "boolean", default: false },
              },
            },
            example: {
              mode: "update",
              csv: "employeeId,department\r\nemployee-id,Engineering\r\n",
              apply: false,
            },
          },
        },
      },
      responses: {
        "200": {
          description:
            "Validation results. Unchanged rows are skipped. applied=false means no records were changed, including all-unchanged batches and when invalid rows prevent an apply request.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    type: "object",
                    properties: {
                      mode,
                      total: { type: "integer" },
                      valid: { type: "integer" },
                      invalid: { type: "integer" },
                      applied: { type: "boolean" },
                      results: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            row: { type: "integer" },
                            identifier: { type: "string" },
                            status: {
                              type: "string",
                              enum: ["valid", "error", "created", "updated", "unchanged"],
                            },
                            errors: { type: "array", items: { type: "string" } },
                            changes: {
                              type: "array",
                              items: {
                                type: "object",
                                properties: {
                                  field: { type: "string" },
                                  before: { type: "string" },
                                  after: { type: "string" },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        ...errors,
      },
    },
  },
  "/global/employees/bulk/template": {
    get: {
      tags: ["Global payroll"],
      summary: "Download the global employee upload or update CSV template",
      parameters: [{ name: "mode", in: "query", schema: { ...mode, default: "create" } }],
      responses: { "200": csvResponse, ...errors },
    },
  },
  "/global/employees/bulk/export": {
    get: {
      tags: ["Global payroll"],
      summary: "Export all organisation global employees for bulk editing",
      description:
        "Includes employee IDs and existing UAE profile JSON. Export is not limited to the 500 records displayed in the employee list. Split larger exports into batches of up to 500 data rows before applying updates.",
      responses: { "200": csvResponse, ...errors },
    },
  },
};
