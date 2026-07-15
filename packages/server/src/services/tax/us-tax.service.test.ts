import { describe, it, expect } from "vitest";
import { computeUSPayroll, type USPayrollInput } from "./us-tax.service";

function makeInput(overrides: Partial<USPayrollInput> = {}): USPayrollInput {
  return {
    employeeId: "e1",
    grossPay: 10000,
    payFrequency: "monthly",
    w4: {
      filingStatus: "single",
      otherIncome: 0,
      deductions: 0,
      dependentCredit: 0,
      extraWithholding: 0,
    },
    stateCode: "TX",
    ytdGross: 0,
    ytdSocialSecurity: 0,
    pretaxDeductions: 0,
    ...overrides,
  };
}

describe("computeUSPayroll — FICA / Medicare / FUTA (deterministic)", () => {
  it("Social Security = 6.2% below the wage base", () => {
    const r = computeUSPayroll(makeInput({ grossPay: 10000 }));
    expect(r.socialSecurity).toBeCloseTo(620, 2);
    expect(r.employerSocialSecurity).toBeCloseTo(620, 2);
  });

  it("Social Security stops once YTD hits the wage base", () => {
    // ytdGross already at/above the wage base -> no further SS this period
    const r = computeUSPayroll(makeInput({ grossPay: 10000, ytdGross: 200000 }));
    expect(r.socialSecurity).toBe(0);
  });

  it("Medicare = 1.45%, no additional Medicare below threshold", () => {
    const r = computeUSPayroll(makeInput({ grossPay: 10000 }));
    expect(r.medicare).toBeCloseTo(145, 2);
    expect(r.additionalMedicare).toBe(0);
  });

  it("additional Medicare (0.9%) kicks in above the threshold", () => {
    // Single threshold $200k; this period crosses it entirely
    const r = computeUSPayroll(makeInput({ grossPay: 50000, ytdGross: 200000 }));
    expect(r.additionalMedicare).toBeCloseTo(50000 * 0.009, 2);
  });

  it("FUTA applies only to the first $7,000 of wages", () => {
    const r = computeUSPayroll(makeInput({ grossPay: 10000, ytdGross: 0 }));
    expect(r.employerFuta).toBeCloseTo(7000 * 0.006, 2); // 0.6% effective on $7k = 42
    const capped = computeUSPayroll(makeInput({ grossPay: 10000, ytdGross: 7000 }));
    expect(capped.employerFuta).toBe(0);
  });
});

describe("computeUSPayroll — state income tax", () => {
  it("no-income-tax state pays $0 state tax", () => {
    const r = computeUSPayroll(makeInput({ stateCode: "TX", grossPay: 10000 }));
    expect(r.stateTax).toBe(0);
  });

  it("California uses REAL progressive brackets (not the old 70%-of-top-rate hack)", () => {
    // $120k/yr. Old hack: 12.3% top * 0.7 = 8.61% flat on ~$114,460 => ~$821/mo.
    // Real progressive CA tax is materially lower.
    const r = computeUSPayroll(makeInput({ stateCode: "CA", grossPay: 10000 }));
    expect(r.stateTax).toBeGreaterThan(0);
    expect(r.stateTax).toBeLessThan(700); // real progressive < old flat-top-rate hack (~821)
    expect(r.stateTax).toBeGreaterThan(550); // but non-trivial
  });

  it("net pay = gross minus all employee deductions", () => {
    const r = computeUSPayroll(makeInput({ grossPay: 10000, stateCode: "CA" }));
    const sum = r.federalTax + r.socialSecurity + r.medicare + r.additionalMedicare + r.stateTax;
    expect(r.netPay).toBeCloseTo(10000 - sum, 2);
  });
});
