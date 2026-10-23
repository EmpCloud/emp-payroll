import { describe, expect, it } from "vitest";
import { exportUaeBankFile, UAE_BANK_FORMATS, type UaeBankExportInput } from "./uae-bank-exports";
import { generateUaeSif, type UaeReportingSnapshot } from "./uae-reporting";

function snapshot(): UaeReportingSnapshot {
  return {
    approvalStatus: "approved",
    employer: { name: "Example LLC" },
    employee: { id: "employee-1", name: "Aisha" },
    year: 2026,
    month: 10,
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    dueDate: "2026-11-01",
    currency: "AED",
    grossPay: 1000000,
    totalDeductions: 100000,
    netPay: 900000,
    earnings: [
      { label: "Basic", amount: 800000 },
      { label: "Variable pay", amount: 200000 },
    ],
    deductions: [{ label: "Loan repayment", amount: 100000 }],
    employerBenefits: [],
    wps: {
      scope: "mohre",
      employeeId: "00915012345663",
      agentRoutingCode: "802420101",
      account: "AE070331234567890123456",
      fixedIncome: 700000,
      variableIncome: 200000,
      unpaidLeaveDays: 0,
      variableBreakdown: {
        housing: 10000,
        conveyance: 20000,
        medical: 30000,
        annualPassage: 40000,
        overtime: 50000,
        other: 40000,
        leaveEncashment: 10000,
      },
    },
  };
}
function input(overrides: Partial<UaeBankExportInput> = {}): UaeBankExportInput {
  return {
    bankFormat: "mohre-sif",
    employerId: "0000000123456",
    employerRoutingCode: "802420101",
    reference: "October payroll",
    createdAt: "2026-10-31T21:30:45Z",
    month: 10,
    year: 2026,
    items: [snapshot()],
    ...overrides,
  };
}
const lines = (file: ReturnType<typeof exportUaeBankFile>) =>
  String(file.content)
    .trim()
    .split("\r\n")
    .map((line) => line.split(","));

describe("UAE receiving-bank export profiles", () => {
  it("creates an exact 25-digit standard filename with UAE-local timestamp, EDR and final SCR", () => {
    const file = exportUaeBankFile(input());
    expect(file.filename).toBe("0000000123456261101013045.sif");
    expect(file.filename).toMatch(/^\d{25}\.sif$/);
    expect(lines(file).map((line) => line[0])).toEqual(["EDR", "SCR"]);
    expect(lines(file)[1].slice(3, 9)).toEqual([
      "2026-11-01",
      "0130",
      "102026",
      "1",
      "9000.00",
      "AED",
    ]);
    expect(file.contentType).toBe("text/plain; charset=us-ascii");
    expect(file.paymentStatus).toBe("not_confirmed");
  });

  it("preserves DIB v1.1 output and longer alphanumeric authority identifiers", () => {
    const request = input({ bankFormat: "dib-v1.1", employerId: "ESTABLISHMENT12345678" });
    request.items[0].wps!.employeeId = "EMPLOYEE123456789";
    const file = exportUaeBankFile(request);
    const existing = generateUaeSif({ ...request, version: "dib-v1.1" });
    expect(file.content).toBe(existing.content);
    expect(file.filename).toBe(existing.filename);
    expect(lines(file).map((line) => line[0])).toEqual(["EDR", "EVP", "SCR"]);
  });

  it("pads RAK standard employee IDs to 14 digits without modifying approved snapshots", () => {
    const request = input({
      bankFormat: "rakbank-sif",
      employerId: "123456",
      employerRoutingCode: "604060101",
    });
    request.items[0].wps!.employeeId = "915012345663";
    const original = structuredClone(request);
    const file = exportUaeBankFile(request);
    expect(lines(file)[0][1]).toBe("00915012345663");
    expect(lines(file).at(-1)![1]).toBe("0000000123456");
    expect(file.filename).toMatch(/^\d{25}\.sif$/);
    expect(file.warnings.join(" ")).toContain("proprietary converter");
    expect(request).toEqual(original);
  });

  it("generates Emirates NBD CSV records with SIF extension and all seven EVP fields", () => {
    const file = exportUaeBankFile(
      input({ bankFormat: "emirates-nbd-sif", employerRoutingCode: "302620122" }),
    );
    const rows = lines(file);
    expect(rows.map((row) => row[0])).toEqual(["EDR", "EVP", "SCR"]);
    expect(rows[1].slice(3)).toEqual([
      "100.00",
      "200.00",
      "300.00",
      "400.00",
      "500.00",
      "400.00",
      "100.00",
    ]);
    expect(rows[0].slice(7, 9)).toEqual(["7000.00", "2000.00"]);
    expect(rows[2][7]).toBe("9000.00");
    expect(file.filename).toMatch(/^\d{25}\.sif$/);
    expect(String(file.content)).not.toContain("\nEDR,");
  });

  it("omits optional EVP without discarding the variable payable amount and permits explicit extension", () => {
    const request = input();
    delete request.items[0].wps!.variableBreakdown;
    expect(lines(exportUaeBankFile(request))[0][8]).toBe("2000.00");
    expect(() => exportUaeBankFile({ ...request, includeEvp: true })).toThrow(/breakdown/);
    const extended = exportUaeBankFile(input({ includeEvp: true }));
    expect(lines(extended).map((line) => line[0])).toEqual(["EDR", "EVP", "SCR"]);
    expect(extended.warnings.join(" ")).toContain("EVP extension");
  });

  it("requires variable-pay EVP for the Emirates NBD profile but no EVP when variable pay is zero", () => {
    const request = input({
      bankFormat: "emirates-nbd-sif",
      employerRoutingCode: "302620122",
      includeEvp: false,
    });
    expect(() => exportUaeBankFile(request)).toThrow(/requires an EVP/);
    request.items[0].wps!.fixedIncome = 900000;
    request.items[0].wps!.variableIncome = 0;
    delete request.items[0].wps!.variableBreakdown;
    expect(lines(exportUaeBankFile(request)).map((line) => line[0])).toEqual(["EDR", "SCR"]);
  });

  it.each(["emirates-nbd-sif", "rakbank-sif"] as const)(
    "rejects a mismatched employer bank routing for %s",
    (bankFormat) => {
      expect(() => exportUaeBankFile(input({ bankFormat }))).toThrow(/routing/);
    },
  );

  it.each(["123456789012345", "EMPLOYEE1234567", "123,456", "=123", " 123", "123\n456"])(
    "rejects invalid strict employee identifier %j without truncation",
    (employeeId) => {
      const request = input();
      request.items[0].wps!.employeeId = employeeId;
      expect(() => exportUaeBankFile(request)).toThrow(/14 digits/);
    },
  );

  it("rejects collisions after padding, invalid IBANs and altered net allocation", () => {
    const request = input();
    const second = snapshot();
    second.employee.id = "employee-2";
    second.wps!.employeeId = "915012345663";
    request.items.push(second);
    expect(() => exportUaeBankFile(request)).toThrow(/appears more than once/);
    request.items.pop();
    request.items[0].wps!.account = "AE000331234567890123456";
    expect(() => exportUaeBankFile(request)).toThrow(/checksum/);
    request.items[0].wps!.account = snapshot().wps!.account;
    request.items[0].wps!.fixedIncome = 800000;
    expect(() => exportUaeBankFile(request)).toThrow(/equal net pay/);
  });

  it("excludes documented exemptions from count and amount while retaining review metadata", () => {
    const request = input();
    const exempt = snapshot();
    exempt.employee.id = "exempt";
    exempt.wps = {
      ...exempt.wps!,
      scope: "exempt",
      exemptionReason: "Approved exemption",
      exemptionEvidence: "MOHRE-1",
      employeeId: undefined,
    };
    request.items.push(exempt);
    const file = exportUaeBankFile(request);
    expect(file.employeeCount).toBe(1);
    expect(file.totalPayment).toBe(900000);
    expect(file.excluded).toEqual([{ employeeId: "exempt", reason: "Approved exemption" }]);
    expect(file.warnings.join(" ")).toContain("1 employee(s) excluded");
  });

  it("keeps HSBC unavailable until a complete approved workbook schema exists", () => {
    expect(UAE_BANK_FORMATS.find((profile) => profile.id === "hsbc-xlsx")).toMatchObject({
      available: false,
      requirement: expect.stringContaining("44-column"),
    });
    expect(() => exportUaeBankFile(input({ bankFormat: "hsbc-xlsx" }))).toThrow(
      /complete field mapping/,
    );
  });
});
