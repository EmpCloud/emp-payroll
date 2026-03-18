import { describe, it, expect } from "vitest";
import { computeUKPayroll, type UKPayrollInput } from "../../src/services/tax/uk-tax.service";

const baseInput: UKPayrollInput = {
  employeeId: "uk-1",
  grossPay: 4167, // ~£50K/year monthly
  payFrequency: "monthly",
  taxCode: "1257L",
  region: "england",
  nicCategory: "A",
  studentLoanPlans: [],
  pensionMethod: "qualifying_earnings",
  pensionEmployeeRate: 5,
  pensionEmployerRate: 3,
  periodNumber: 1,
  ytdGross: 0,
  ytdTaxPaid: 0,
  ytdNicPaid: 0,
};

describe("UK Payroll Tax Engine", () => {
  it("computes PAYE income tax for standard tax code", () => {
    const result = computeUKPayroll(baseInput);
    expect(result.incomeTax).toBeGreaterThan(0);
    expect(result.netPay).toBeGreaterThan(0);
    expect(result.netPay).toBeLessThan(result.grossPay);
  });

  it("returns zero tax for NT (no tax) code", () => {
    const result = computeUKPayroll({ ...baseInput, taxCode: "NT" });
    expect(result.incomeTax).toBe(0);
  });

  it("applies basic rate for BR code", () => {
    const result = computeUKPayroll({ ...baseInput, taxCode: "BR" });
    expect(result.incomeTax).toBe(Math.round(4167 * 20 / 100 * 100) / 100);
  });

  it("applies higher rate for D0 code", () => {
    const result = computeUKPayroll({ ...baseInput, taxCode: "D0" });
    expect(result.incomeTax).toBe(Math.round(4167 * 40 / 100 * 100) / 100);
  });

  it("computes employee NIC for category A", () => {
    const result = computeUKPayroll(baseInput);
    expect(result.employeeNIC).toBeGreaterThan(0);
  });

  it("computes employer NIC", () => {
    const result = computeUKPayroll(baseInput);
    expect(result.employerNIC).toBeGreaterThan(0);
  });

  it("returns 0 employee NIC for category C (over pension age)", () => {
    const result = computeUKPayroll({ ...baseInput, nicCategory: "C" });
    expect(result.employeeNIC).toBe(0);
    expect(result.employerNIC).toBeGreaterThan(0); // employer still pays
  });

  it("computes student loan deduction for Plan 1", () => {
    const result = computeUKPayroll({ ...baseInput, studentLoanPlans: ["plan1"] });
    expect(result.totalStudentLoan).toBeGreaterThan(0);
    expect(result.studentLoanDeductions.length).toBe(1);
  });

  it("computes auto-enrollment pension", () => {
    const result = computeUKPayroll(baseInput);
    expect(result.employeePension).toBeGreaterThan(0);
    expect(result.employerPension).toBeGreaterThan(0);
    expect(result.pensionablePay).toBeGreaterThan(0);
  });

  it("total deductions add up correctly", () => {
    const result = computeUKPayroll(baseInput);
    const expected = result.incomeTax + result.employeeNIC + result.totalStudentLoan + result.employeePension;
    expect(Math.abs(result.totalDeductions - expected)).toBeLessThan(0.02);
  });

  it("net pay + deductions = gross pay", () => {
    const result = computeUKPayroll(baseInput);
    const sum = result.netPay + result.totalDeductions;
    expect(Math.abs(sum - result.grossPay)).toBeLessThan(0.02);
  });

  it("employer cost > gross pay (includes employer NIC + pension)", () => {
    const result = computeUKPayroll(baseInput);
    expect(result.totalEmployerCost).toBeGreaterThan(result.grossPay);
  });
});
