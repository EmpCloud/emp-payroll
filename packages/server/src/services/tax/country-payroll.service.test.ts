import { describe, it, expect } from "vitest";
import {
  computeCountryPayroll,
  computeIncomeTaxMonthly,
  marginalTax,
  deductionsFromConfig,
  type CountryPayrollConfig,
} from "./country-payroll.service";

// A synthetic country to exercise the kernel deterministically.
const SYNTH: CountryPayrollConfig = {
  code: "XX",
  name: "Testland",
  currency: "XXX",
  subunitDivisor: 100,
  taxYear: "calendar",
  incomeTax: {
    system: "progressive",
    annualBands: [
      { min: 0, max: 12000, rate: 0 },
      { min: 12000, max: 60000, rate: 20 },
      { min: 60000, max: Infinity, rate: 40 },
    ],
    annualAllowance: 0,
    annualRebate: 0,
    flatRate: null as unknown as number,
  },
  funds: [
    // 10% each side, capped at a monthly base of 4,000
    { name: "Social", purpose: "pension", employeeRate: 10, employerRate: 10, monthlyCap: 4000 },
    // uncapped 2%/3% health
    { name: "Health", purpose: "health", employeeRate: 2, employerRate: 3 },
  ],
  levies: [{ name: "Training", rate: 1, paidBy: "employer", base: "gross" }],
};

describe("marginalTax", () => {
  it("bands compute cumulatively", () => {
    // 30,000: 0 on first 12k, 20% on 18k = 3,600
    expect(marginalTax(30000, SYNTH.incomeTax.annualBands)).toBeCloseTo(3600, 2);
    // 100,000: 0 + 20%*48k (9,600) + 40%*40k (16,000) = 25,600
    expect(marginalTax(100000, SYNTH.incomeTax.annualBands)).toBeCloseTo(25600, 2);
  });
});

describe("computeIncomeTaxMonthly", () => {
  it("annualises, taxes, de-annualises", () => {
    // gross 5,000/mo -> 60,000/yr -> tax 9,600/yr -> 800/mo
    expect(computeIncomeTaxMonthly(SYNTH, 5000)).toBeCloseTo(800, 2);
  });
  it("flat system applies flatRate above the monthly allowance", () => {
    const flat: CountryPayrollConfig = {
      ...SYNTH,
      incomeTax: {
        system: "flat",
        annualBands: [],
        annualAllowance: 12000,
        annualRebate: 0,
        flatRate: 13,
      },
    };
    // 5,000 - 1,000 monthly allowance = 4,000 * 13% = 520
    expect(computeIncomeTaxMonthly(flat, 5000)).toBeCloseTo(520, 2);
  });
  it("system 'none' yields zero", () => {
    const none: CountryPayrollConfig = {
      ...SYNTH,
      incomeTax: {
        system: "none",
        annualBands: [],
        annualAllowance: 0,
        annualRebate: 0,
        flatRate: null as unknown as number,
      },
    };
    expect(computeIncomeTaxMonthly(none, 99999)).toBe(0);
  });
});

describe("computeCountryPayroll", () => {
  it("funds respect the contribution-base cap", () => {
    const r = computeCountryPayroll(SYNTH, 5000);
    // Social capped at 4,000 base: ee 400 / er 400. Health uncapped on 5,000: ee 100 / er 150.
    const social = r.fundBreakdown.find((f) => f.name === "Social")!;
    const health = r.fundBreakdown.find((f) => f.name === "Health")!;
    expect(social.employee).toBeCloseTo(400, 2);
    expect(health.employee).toBeCloseTo(100, 2);
    expect(r.employeeContribMonthly).toBeCloseTo(500, 2);
    expect(r.employerContribMonthly).toBeCloseTo(550, 2);
  });

  it("employer levy adds to employer cost, not employee net", () => {
    const r = computeCountryPayroll(SYNTH, 5000);
    expect(r.leviesEmployerMonthly).toBeCloseTo(50, 2); // 1% of 5,000
    // income tax 800 + ee contrib 500 = 1,300 employee deductions
    expect(r.totalEmployeeDeductions).toBeCloseTo(1300, 2);
    expect(r.netPay).toBeCloseTo(3700, 2);
    // employer cost = gross + employer contrib 550 + levy 50
    expect(r.totalEmployerCost).toBeCloseTo(5600, 2);
  });
});

describe("deductionsFromConfig (cents adapter)", () => {
  it("converts minor units -> major -> back, mapping to the deduction shape", () => {
    // 500,000 cents = 5,000 major. tax 800 -> 80,000 cents; ee contrib 500 -> 50,000 cents.
    const d = deductionsFromConfig(SYNTH, 500000);
    expect(d.tax_amount).toBe(80000);
    expect(d.social_security_employee).toBe(50000);
    // employer contrib 550 + levy 50 = 600 -> 60,000 cents
    expect(d.social_security_employer).toBe(60000);
  });

  it("subunitDivisor=1 (JPY-style) leaves major units unscaled", () => {
    const jpy: CountryPayrollConfig = { ...SYNTH, subunitDivisor: 1 };
    const d = deductionsFromConfig(jpy, 5000); // already major units
    expect(d.tax_amount).toBe(800);
    expect(d.social_security_employee).toBe(500);
  });
});
