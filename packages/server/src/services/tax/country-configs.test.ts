import { describe, it, expect } from "vitest";
import { COUNTRY_CONFIGS } from "./country-configs";
import { computeCountryPayroll } from "./country-payroll.service";

// Representative mid-market monthly gross per currency (major units).
const REP_GROSS: Record<string, number> = {
  CN: 20000,
  JP: 400000,
  DE: 5000,
  FR: 4000,
  IT: 3000,
  BR: 8000,
  CA: 7000,
  RU: 120000,
  MX: 30000,
  AU: 8000,
  KR: 4000000,
  ES: 3000,
  ID: 15000000,
  SA: 15000,
  TR: 60000,
  CH: 9000,
  NL: 5000,
  // Countries added in the config-driven expansion (representative mid-market monthly gross).
  SG: 6000,
  AE: 20000,
  SE: 45000,
  IE: 4500,
  PL: 10000,
  PH: 50000,
  MY: 6000,
  TH: 50000,
  VN: 30000000,
  NG: 800000,
  KE: 150000,
  EG: 20000,
};

const EXPECTED_COUNTRIES = [
  "CN",
  "JP",
  "DE",
  "FR",
  "IT",
  "BR",
  "CA",
  "RU",
  "MX",
  "AU",
  "KR",
  "ES",
  "ID",
  "SA",
  "TR",
  "CH",
  "NL",
  "SG",
  "AE",
  "SE",
  "IE",
  "PL",
  "PH",
  "MY",
  "TH",
  "VN",
  "NG",
  "KE",
  "EG",
];

describe("COUNTRY_CONFIGS coverage", () => {
  it("has all 29 config-driven countries", () => {
    expect(Object.keys(COUNTRY_CONFIGS).sort()).toEqual([...EXPECTED_COUNTRIES].sort());
  });

  it("does NOT include the dedicated-engine countries (IN/US/GB/ZA)", () => {
    for (const c of ["IN", "US", "GB", "ZA"]) {
      expect(COUNTRY_CONFIGS[c]).toBeUndefined();
    }
  });
});

describe("every config computes sane payroll", () => {
  for (const code of EXPECTED_COUNTRIES) {
    it(`${code}: net pay positive, below gross, finite; deductions non-negative`, () => {
      const cfg = COUNTRY_CONFIGS[code];
      expect(cfg).toBeDefined();
      const gross = REP_GROSS[code];
      const r = computeCountryPayroll(cfg, gross);

      expect(Number.isFinite(r.netPay)).toBe(true);
      expect(r.netPay).toBeGreaterThan(0);
      expect(r.netPay).toBeLessThanOrEqual(gross);
      expect(r.totalEmployeeDeductions).toBeGreaterThanOrEqual(0);
      expect(r.incomeTaxMonthly).toBeGreaterThanOrEqual(0);
      expect(r.employerContribMonthly).toBeGreaterThanOrEqual(0);
      expect(r.totalEmployerCost).toBeGreaterThanOrEqual(gross);
      // every fund line is non-negative and finite
      for (const f of r.fundBreakdown) {
        expect(Number.isFinite(f.employee) && Number.isFinite(f.employer)).toBe(true);
        expect(f.employee).toBeGreaterThanOrEqual(0);
        expect(f.employer).toBeGreaterThanOrEqual(0);
      }
    });
  }
});

describe("known statutory facts", () => {
  it("Saudi Arabia has no personal income tax", () => {
    expect(COUNTRY_CONFIGS.SA.incomeTax.system).toBe("none");
    const r = computeCountryPayroll(COUNTRY_CONFIGS.SA, 15000);
    expect(r.incomeTaxMonthly).toBe(0);
  });

  it("Russia income tax is flat (13% entry rate)", () => {
    // RU uses a low-rate progressive/flat structure — entry band 13%
    const r = computeCountryPayroll(COUNTRY_CONFIGS.RU, 120000);
    // ~13% effective at this level
    expect(r.incomeTaxMonthly / 120000).toBeGreaterThan(0.12);
    expect(r.incomeTaxMonthly / 120000).toBeLessThan(0.16);
  });

  it("China pension employee contribution is 8% of the capped base", () => {
    const pf = COUNTRY_CONFIGS.CN.funds.find((f) => f.purpose === "pension")!;
    expect(pf.employeeRate).toBe(8);
    // below cap: 8% of gross
    const r = computeCountryPayroll(COUNTRY_CONFIGS.CN, 20000);
    const line = r.fundBreakdown.find((f) => f.name === pf.name)!;
    expect(line.employee).toBeCloseTo(20000 * 0.08, 2);
  });

  it("Australia superannuation is employer-only (12%), no employee share", () => {
    const superFund = COUNTRY_CONFIGS.AU.funds.find((f) => f.purpose === "pension")!;
    expect(superFund.employeeRate).toBe(0);
    expect(superFund.employerRate).toBeGreaterThanOrEqual(11);
  });

  it("Singapore CPF employee rate is 20%, capped at the S$8,000/month Ordinary Wage ceiling", () => {
    const cpf = COUNTRY_CONFIGS.SG.funds.find((f) => f.name.includes("CPF"))!;
    expect(cpf.employeeRate).toBe(20);
    expect(cpf.employerRate).toBe(17);
    expect(cpf.monthlyCap).toBe(8000);
  });

  it("UAE has no personal income tax", () => {
    expect(COUNTRY_CONFIGS.AE.incomeTax.system).toBe("none");
    const r = computeCountryPayroll(COUNTRY_CONFIGS.AE, 20000);
    expect(r.incomeTaxMonthly).toBe(0);
  });

  it("Vietnam uses subunitDivisor 1 (the dong has no minor unit, like JPY/KRW)", () => {
    expect(COUNTRY_CONFIGS.VN.subunitDivisor).toBe(1);
  });
});
