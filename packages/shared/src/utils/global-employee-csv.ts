export type GlobalEmployeeBulkMode = "create" | "update";

export interface GlobalEmployeeBulkResult {
  mode: GlobalEmployeeBulkMode;
  total: number;
  valid: number;
  invalid: number;
  applied: boolean;
  results: {
    row: number;
    identifier: string;
    status: "valid" | "error" | "created" | "updated" | "unchanged";
    errors: string[];
    changes: { field: string; before: string; after: string }[];
  }[];
}

export const GLOBAL_EMPLOYEE_CSV_MAX_ROWS = 500;
export const GLOBAL_EMPLOYEE_CSV_MAX_BYTES = 2 * 1024 * 1024;
export const GLOBAL_EMPLOYEE_CSV_HEADERS = [
  "employeeId",
  "firstName",
  "lastName",
  "email",
  "countryCode",
  "employmentType",
  "contractType",
  "jobTitle",
  "department",
  "startDate",
  "endDate",
  "salaryAmount",
  "salaryCurrency",
  "salaryFrequency",
  "status",
  "empcloudUserId",
  "taxId",
  "bankName",
  "bankAccount",
  "bankRouting",
  "notes",
  "uaeProfile",
] as const;

/** CSV records may span physical lines; preserve the starting line for actionable errors. */
export function parseGlobalEmployeeCsv(csv: string): {
  headers: string[];
  rows: { row: number; values: Record<string, string> }[];
} {
  let bytes = 0;
  for (const character of csv) {
    const point = character.codePointAt(0)!;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    if (bytes > GLOBAL_EMPLOYEE_CSV_MAX_BYTES)
      throw new Error("CSV files must be no larger than 2 MB.");
  }
  csv = csv.replace(/^\uFEFF/, "");
  const records: { row: number; cells: string[] }[] = [];
  let cells: string[] = [],
    cell = "",
    quoted = false,
    closedQuote = false;
  let line = 1,
    startLine = 1;
  const finishCell = () => {
    cells.push(cell);
    cell = "";
    closedQuote = false;
  };
  const finishRow = () => {
    finishCell();
    if (cells.some((value) => value.trim() !== "")) records.push({ row: startLine, cells });
    cells = [];
    if (records.length > GLOBAL_EMPLOYEE_CSV_MAX_ROWS + 1)
      throw new Error("Upload no more than 500 employees at a time.");
  };
  for (let i = 0; i < csv.length; i++) {
    const character = csv[i];
    if (quoted) {
      if (character === '"') {
        if (csv[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else if (character === "\r" || character === "\n") {
        if (character === "\r" && csv[i + 1] === "\n") i++;
        cell += "\n";
        line++;
      } else cell += character;
    } else if (character === ",") finishCell();
    else if (character === "\r" || character === "\n") {
      if (character === "\r" && csv[i + 1] === "\n") i++;
      finishRow();
      line++;
      startLine = line;
    } else if (closedQuote) {
      if (character !== " " && character !== "\t")
        throw new Error(`Row ${line}: unexpected text after a quoted field.`);
    } else if (character === '"') {
      if (cell.length) throw new Error(`Row ${line}: quotes must enclose the entire field.`);
      quoted = true;
    } else cell += character;
  }
  if (quoted) throw new Error(`Row ${startLine}: a quoted field is not closed.`);
  if (cell.length || cells.length || closedQuote) finishRow();
  if (!records.length) throw new Error("The CSV file is empty.");
  const headers = records[0].cells.map((header) => header.trim());
  if (headers.some((header) => !header)) throw new Error("Every CSV column needs a header.");
  if (new Set(headers).size !== headers.length) throw new Error("CSV headers must be unique.");
  const unknown = headers.filter(
    (header) => !(GLOBAL_EMPLOYEE_CSV_HEADERS as readonly string[]).includes(header),
  );
  if (unknown.length)
    throw new Error(
      `Unknown CSV columns: ${unknown.join(", ")}. Download the template for supported headers.`,
    );
  if (records.length === 1) throw new Error("Include at least one employee row.");
  return {
    headers,
    rows: records.slice(1).map((record) => {
      if (record.cells.length !== headers.length)
        throw new Error(
          `Row ${record.row}: expected ${headers.length} columns, received ${record.cells.length}.`,
        );
      return {
        row: record.row,
        values: Object.fromEntries(
          headers.map((header, index) => {
            const value = record.cells[index];
            // Undo the spreadsheet-safe prefix used by our export, including literal apostrophes.
            return [header, /^'[=+\-@'\t\r\n]/.test(value) ? value.slice(1) : value];
          }),
        ),
      };
    }),
  };
}

/** Quote every cell and protect exported text from being interpreted as spreadsheet formulas. */
export function stringifyGlobalEmployeeCsv(headers: readonly string[], rows: string[][]): string {
  const quote = (value: string) => {
    const protectedValue = /^[=+\-@'\t\r\n]/.test(value) ? `'${value}` : value;
    return `"${protectedValue.replace(/"/g, '""')}"`;
  };
  return "\uFEFF" + [headers, ...rows].map((row) => row.map(quote).join(",")).join("\r\n") + "\r\n";
}
