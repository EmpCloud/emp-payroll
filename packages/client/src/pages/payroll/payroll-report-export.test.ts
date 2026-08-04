import { describe, expect, it } from "vitest";
import { buildPayrollReportCsv } from "./payroll-report-export";

describe("buildPayrollReportCsv", () => {
  it("exports the payslip TDS deduction in its own salary-sheet column", () => {
    const csv = buildPayrollReportCsv(
      [
        {
          first_name: "Asha",
          last_name: "Rao",
          employee_code: "EMP-1",
          monthly_gross: 50000,
          total_days: 31,
          gross_earnings: 50000,
          net_pay: 43800,
          earnings: [],
          deductions: JSON.stringify([
            { code: "EPF", amount: 1800 },
            { code: "PT", amount: 200 },
            { code: "TDS", amount: 4200 },
          ]),
        },
      ],
      { organization_name: "EmpCloud" },
    );

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [header, row] = csv
      .replace(/^\uFEFF/, "")
      .split("\n")
      .map((line) => line.split(","));
    const tdsColumn = header.indexOf("Deductions TDS");

    expect(tdsColumn).toBeGreaterThan(-1);
    expect(row[tdsColumn]).toBe("4200");
    expect(header.at(-1)).toBe("Final Net Pay");
    expect(row.at(-1)).toBe("43800");
  });

  it("exports zero when a payslip has no TDS deduction", () => {
    const csv = buildPayrollReportCsv([{ deductions: [], earnings: [], net_pay: 10000 }], {});
    const [header, row] = csv
      .replace(/^\uFEFF/, "")
      .split("\n")
      .map((line) => line.split(","));

    expect(row[header.indexOf("Deductions TDS")]).toBe("0");
  });
});
