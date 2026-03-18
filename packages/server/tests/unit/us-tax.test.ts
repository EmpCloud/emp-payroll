import { describe, it, expect } from "vitest";
import { computeUSPayroll, type USPayrollInput } from "../../src/services/tax/us-tax.service";

const baseInput: USPayrollInput = {
  employeeId: "us-1",
  grossPay: 8333.33, // $100K/year monthly
  payFrequency: "monthly",
  w4: {
    filingStatus: "single",
    otherIncome: 0,
    deductions: 0,
    dependentCredit: 0,
    extraWithholding: 0,
  },
  stateCode: "CA",
  ytdGross: 0,
  ytdSocialSecurity: 0,
  pretaxDeductions: 0,
};

describe("US Payroll Tax Engine", () => {
  it("computes federal tax for single filer at $100K", () => {
    const result = computeUSPayroll(baseInput);
    expect(result.federalTax).toBeGreaterThan(0);
    expect(result.netPay).toBeGreaterThan(0);
    expect(result.netPay).toBeLessThan(result.grossPay);
  });

  it("computes Social Security (6.2% up to wage base)", () => {
    const result = computeUSPayroll(baseInput);
    const expectedSS = Math.round(8333.33 * 6.2 / 100 * 100) / 100;
    expect(result.socialSecurity).toBe(expectedSS);
    expect(result.employerSocialSecurity).toBe(expectedSS);
  });

  it("computes Medicare (1.45%)", () => {
    const result = computeUSPayroll(baseInput);
    const expectedMedicare = Math.round(8333.33 * 1.45 / 100 * 100) / 100;
    expect(result.medicare).toBe(expectedMedicare);
  });

  it("caps Social Security at wage base", () => {
    const result = computeUSPayroll({
      ...baseInput,
      ytdGross: 176100, // At SS wage base
      grossPay: 10000,
    });
    expect(result.socialSecurity).toBe(0);
    expect(result.employerSocialSecurity).toBe(0);
  });

  it("applies additional Medicare for high earners", () => {
    const result = computeUSPayroll({
      ...baseInput,
      ytdGross: 200000,
      grossPay: 10000,
    });
    expect(result.additionalMedicare).toBeGreaterThan(0);
  });

  it("computes state tax for CA", () => {
    const result = computeUSPayroll(baseInput);
    expect(result.stateTax).toBeGreaterThan(0);
  });

  it("returns 0 state tax for no-income-tax states", () => {
    const result = computeUSPayroll({ ...baseInput, stateCode: "TX" });
    expect(result.stateTax).toBe(0);
  });

  it("reduces federal tax with dependent credits", () => {
    const noCredits = computeUSPayroll(baseInput);
    const withCredits = computeUSPayroll({
      ...baseInput,
      w4: { ...baseInput.w4, dependentCredit: 4000 },
    });
    expect(withCredits.federalTax).toBeLessThan(noCredits.federalTax);
  });

  it("computes FUTA employer tax", () => {
    const result = computeUSPayroll(baseInput);
    expect(result.employerFuta).toBeGreaterThan(0);
    expect(result.totalEmployerTaxes).toBeGreaterThan(0);
  });

  it("net pay + deductions = gross pay", () => {
    const result = computeUSPayroll(baseInput);
    const sum = result.netPay + result.totalEmployeeDeductions;
    expect(Math.abs(sum - result.grossPay)).toBeLessThan(0.02); // rounding tolerance
  });
});
