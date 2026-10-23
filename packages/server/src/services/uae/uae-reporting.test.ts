import { describe, expect, it } from "vitest";
import {
  computeUaePaymentSummary,
  generateUaeSif,
  renderUaePayslip,
  type UaePaymentEvidence,
  type UaeReportingSnapshot,
  type UaeSifInput,
} from "./uae-reporting";

function snapshot(overrides: Partial<UaeReportingSnapshot> = {}): UaeReportingSnapshot {
  return {
    approvalStatus: "approved",
    employer: { name: "Example UAE LLC", address: "Dubai", registrationNumber: "REG1" },
    employee: {
      id: "employee-1",
      name: "Aisha Example",
      employeeCode: "EMP1",
      jobTitle: "Engineer",
      bankAccount: "AE070331234567890123456",
    },
    month: 10,
    year: 2026,
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    dueDate: "2026-11-01",
    currency: "AED",
    grossPay: 1000000,
    totalDeductions: 100000,
    netPay: 900000,
    earnings: [
      { label: "Basic salary", amount: 800000 },
      { label: "Overtime", amount: 200000 },
    ],
    deductions: [{ label: "Approved loan repayment", amount: 100000 }],
    employerBenefits: [{ label: "Health insurance", amount: 10000 }],
    wps: {
      scope: "mohre",
      employeeId: "00915012345663",
      agentRoutingCode: "802420101",
      account: "AE070331234567890123456",
      fixedIncome: 700000,
      variableIncome: 200000,
      variableBreakdown: {
        housing: 0,
        conveyance: 0,
        medical: 0,
        annualPassage: 0,
        overtime: 200000,
        other: 0,
        leaveEncashment: 0,
      },
      unpaidLeaveDays: 0,
      wagesDue: 1000000,
    },
    ...overrides,
  };
}

function input(items: UaeReportingSnapshot[] = [snapshot()]): UaeSifInput {
  return {
    version: "dib-v1.1",
    employerId: "0000000123456",
    employerRoutingCode: "802420101",
    reference: "October payroll",
    createdAt: "2026-10-31T21:30:45Z",
    month: 10,
    year: 2026,
    items,
  };
}

function paid(amount: number, overrides: Partial<UaePaymentEvidence> = {}): UaePaymentEvidence {
  return {
    reference: "WPS-1",
    employeeId: "employee-1",
    amount,
    currency: "AED",
    status: "confirmed",
    paidOn: "2026-11-01",
    ...overrides,
  };
}

describe("approved UAE payslip HTML", () => {
  it("escapes every identity/line field and masks account details without executable resources", () => {
    const item = snapshot();
    item.employer.name = '<img src=x onerror="alert(1)">';
    item.employee.name = "<script>alert('employee')</script>";
    item.employee.jobTitle = 'Engineer <svg onload="x">';
    item.earnings[0].label = '<a href="javascript:alert(1)">Basic</a>';
    const html = renderUaePayslip({ snapshot: item, paymentStatus: "uploaded" });
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;script&gt;alert(&#39;employee&#39;)&lt;/script&gt;");
    expect(html).not.toMatch(/<script|<img|<svg|<a\s|<iframe/i);
    expect(html).toContain("•••• 3456");
    expect(html).not.toContain(item.employee.bankAccount);
    expect(html).toContain("File uploaded — payment not confirmed");
    expect(html).toContain("Gross pay: AED 10000.00");
    expect(html).toContain("Net pay: AED 9000.00");
    expect(html).toContain("Employer benefits — not deducted from net pay");
    expect(html).toContain("2026-11-01");
    expect(html).toContain("@media print");
    expect(html).toContain('onclick="window.print()"');
    expect(html).toContain(".print-action{display:none}");
    expect(renderUaePayslip({ snapshot: item, paymentStatus: "uploaded" })).toBe(html);
  });

  it("displays settlement detail once without adding it to the frozen total", () => {
    const html = renderUaePayslip({
      snapshot: snapshot({ finalSettlement: [{ label: "Gratuity", amount: 50000 }] }),
    });
    expect(html).toContain("Final settlement breakdown");
    expect(html).toContain("Settlement amounts are already included");
    expect(html).toContain("Net pay: AED 9000.00");
    expect(html).toContain("Payment not confirmed");
  });

  it("requires an approved, internally reconciled snapshot", () => {
    const draft = { ...snapshot(), approvalStatus: "draft" };
    // Persisted JSON is untrusted at the service boundary, regardless of compile-time types.
    expect(() => renderUaePayslip({ snapshot: draft as UaeReportingSnapshot })).toThrow(/Approve/);
    expect(() => renderUaePayslip({ snapshot: snapshot({ netPay: 1000000 }) })).toThrow(
      /reconcile/,
    );
    expect(() => renderUaePayslip({ snapshot: snapshot({ currency: "USD" }) })).toThrow(/AED/);
  });
});

describe("DIB v1.1 WPS salary file", () => {
  it("exports NET fixed/variable values, EVP order and one final reconciled SCR in UAE time", () => {
    const second = snapshot({
      employee: { id: "employee-2", name: "Omar" },
      grossPay: 100001,
      totalDeductions: 0,
      netPay: 100001,
      earnings: [{ label: "Salary", amount: 100001 }],
      deductions: [],
    });
    second.wps = {
      ...second.wps!,
      employeeId: "00915012345664",
      fixedIncome: 100001,
      variableIncome: 0,
      variableBreakdown: undefined,
    };
    const file = generateUaeSif(input([snapshot(), second]));
    const lines = file.content.trimEnd().split("\r\n");
    expect(lines.map((line) => line.split(",")[0])).toEqual(["EDR", "EVP", "EDR", "SCR"]);
    expect(lines[0]).toBe(
      "EDR,00915012345663,802420101,AE070331234567890123456,2026-10-01,2026-10-31,31,7000.00,2000.00,0",
    );
    expect(lines[1]).toBe("EVP,00915012345663,802420101,0.00,0.00,0.00,0.00,2000.00,0.00,0.00");
    expect(lines[3]).toBe(
      "SCR,0000000123456,802420101,2026-11-01,0130,102026,2,10000.01,AED,October payroll",
    );
    expect(lines.every((line) => line.split(",").length === 10)).toBe(true);
    expect(file.filename).toBe("0000000123456261101013045.SIF");
    expect(file.totalPayment).toBe(1000001);
    expect(file.paymentStatus).toBe("not_confirmed");
  });

  it.each(["=PAY", "bad,reference", "good\nEDR", "good\r", "good\u0000", 'bad"quote'])(
    "rejects CSV/control injection in reference %j",
    (reference) => {
      expect(() => generateUaeSif({ ...input(), reference })).toThrow(/reference/);
    },
  );

  it.each([
    ["employeeId", "123"],
    ["employeeId", "00915012345663\n"],
    ["agentRoutingCode", "80242010"],
    ["agentRoutingCode", "802420101\n"],
    ["account", "AE070331234567890123457"],
    ["account", "GB070331234567890123456"],
  ])("rejects invalid %s=%j", (field, value) => {
    const item = snapshot();
    item.wps = { ...item.wps!, [field]: value };
    expect(() => generateUaeSif(input([item]))).toThrow(/invalid/);
  });

  it("rejects gross double payment and a mismatched or missing EVP breakdown", () => {
    const item = snapshot();
    item.wps!.fixedIncome = 800000;
    expect(() => generateUaeSif(input([item]))).toThrow(/equal net pay/);
    item.wps!.fixedIncome = 700000;
    item.wps!.variableBreakdown!.other = 1;
    expect(() => generateUaeSif(input([item]))).toThrow(/EVP components/);
    item.wps!.variableBreakdown = undefined;
    expect(() => generateUaeSif(input([item]))).toThrow(/breakdown/);
  });

  it("excludes only documented exemptions or explicitly outside-MoHRE records", () => {
    const exempt = snapshot({ employee: { id: "exempt", name: "Exempt Employee" } });
    exempt.wps = {
      ...exempt.wps!,
      scope: "exempt",
      exemptionReason: "Approved unpaid leave",
      exemptionEvidence: "MOHRE-123",
    };
    const outside = snapshot({ employee: { id: "difc", name: "DIFC Employee" } });
    outside.wps = { ...outside.wps!, scope: "outside_mohre", exemptionReason: "DIFC jurisdiction" };
    const result = generateUaeSif(input([snapshot(), exempt, outside]));
    expect(result.employeeCount).toBe(1);
    expect(result.excluded).toEqual([
      { employeeId: "exempt", reason: "Approved unpaid leave" },
      { employeeId: "difc", reason: "DIFC jurisdiction" },
    ]);
    exempt.wps.exemptionEvidence = undefined;
    expect(() => generateUaeSif(input([snapshot(), exempt]))).toThrow(/evidence/);
    expect(() => generateUaeSif(input([outside]))).toThrow(/no eligible/);
  });

  it("rejects unsupported period, ambiguous leave, currency and final settlement exports", () => {
    expect(() => generateUaeSif(input([snapshot({ periodEnd: "2026-11-01" })]))).toThrow(/period/);
    expect(() => generateUaeSif(input([snapshot({ periodStart: "2026-10-31" })]))).toThrow(
      /one-day/,
    );
    expect(() => generateUaeSif(input([snapshot({ currency: "USD" })]))).toThrow(/AED/);
    expect(() => generateUaeSif(input([snapshot({ finalSettlement: [] })]))).toThrow(
      /Final settlements/,
    );
    const item = snapshot();
    item.wps!.unpaidLeaveDays = 0.5;
    expect(() => generateUaeSif(input([item]))).toThrow(/whole days/);
  });

  it("rejects unsafe money, duplicate workers, implicit formats and timezone-free dates", () => {
    expect(() => generateUaeSif(input([snapshot(), snapshot()]))).toThrow(/more than once/);
    expect(() => generateUaeSif({ ...input(), version: undefined })).toThrow(/explicitly/);
    expect(() => generateUaeSif({ ...input(), createdAt: "2026-10-31T13:00:00" })).toThrow(
      /timezone/,
    );
    for (const invalid of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const item = snapshot();
      item.wps!.fixedIncome = invalid;
      expect(() => generateUaeSif(input([item]))).toThrow(/integer/);
    }
  });
});

describe("confirmed UAE wage payment summary", () => {
  it("distinguishes 85% on-time wages from full net payment and ignores uploads", () => {
    const result = computeUaePaymentSummary({
      items: [snapshot()],
      month: 10,
      year: 2026,
      evidence: [paid(850000), paid(50000, { reference: "UPLOAD-1", status: "uploaded" })],
    });
    expect(result).toMatchObject({
      thresholdReached: true,
      fullyPaid: false,
      outstandingNetPay: 50000,
      unpaidEmployeeCount: 1,
      confirmedPaid: 850000,
      onTimeWagesPaid: 850000,
    });
    const lateBalance = computeUaePaymentSummary({
      items: [snapshot()],
      month: 10,
      year: 2026,
      evidence: [paid(800000), paid(100000, { reference: "WPS-2", paidOn: "2026-11-02" })],
    });
    expect(lateBalance).toMatchObject({
      fullyPaid: true,
      thresholdReached: false,
      onTimeWagesPaid: 800000,
    });
  });

  it("does not let another employee's overpayment settle an unpaid worker", () => {
    const second = snapshot({ employee: { id: "employee-2", name: "Omar" } });
    const result = computeUaePaymentSummary({
      items: [snapshot(), second],
      month: 10,
      year: 2026,
      evidence: [paid(2000000)],
    });
    expect(result).toMatchObject({
      fullyPaid: false,
      thresholdReached: false,
      onTimeWagesPaid: 1000000,
      outstandingNetPay: 900000,
    });
  });

  it("requires wage entitlement and unique confirmed evidence, with an indeterminate empty indicator", () => {
    const item = snapshot();
    item.wps!.wagesDue = undefined;
    expect(() =>
      computeUaePaymentSummary({ items: [item], evidence: [], month: 10, year: 2026 }),
    ).toThrow(/wage entitlement/);
    expect(() =>
      computeUaePaymentSummary({
        items: [snapshot()],
        evidence: [paid(1), paid(1)],
        month: 10,
        year: 2026,
      }),
    ).toThrow(/unique/);
    expect(
      computeUaePaymentSummary({ items: [], evidence: [], month: 10, year: 2026 }),
    ).toMatchObject({ fullyPaid: false, thresholdReached: null });
  });
});
