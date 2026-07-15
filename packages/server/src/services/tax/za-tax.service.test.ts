import { describe, it, expect } from "vitest";
import {
  computeZAPayroll,
  computeAnnualTaxBeforeRebate,
  annualRebate,
  medicalTaxCredit,
  retirementDeduction,
  uifContribution,
  computeETI,
} from "./za-tax.service";

// SARS tax year 2025/26. All amounts in RAND.

describe("computeAnnualTaxBeforeRebate", () => {
  it("first bracket only (18%)", () => {
    expect(computeAnnualTaxBeforeRebate(84000)).toBeCloseTo(15120, 2); // 84000 * 18%
  });
  it("spans into the 26% bracket", () => {
    // 237100*18% + (360000-237100)*26% = 42678 + 31954 = 74632
    expect(computeAnnualTaxBeforeRebate(360000)).toBeCloseTo(74632, 2);
  });
  it("top bracket (45%)", () => {
    // Cumulative to R1,817,000 = 644489, then 45% above
    // 2,400,000: 644489 + (2400000-1817000)*45% = 644489 + 262350 = 906839
    expect(computeAnnualTaxBeforeRebate(2400000)).toBeCloseTo(906839, 2);
  });
});

describe("annualRebate", () => {
  it("primary only under 65", () => expect(annualRebate(30)).toBe(17235));
  it("primary + secondary at 65", () => expect(annualRebate(66)).toBe(17235 + 9444));
  it("primary + secondary + tertiary at 75", () =>
    expect(annualRebate(80)).toBe(17235 + 9444 + 3145));
});

describe("uifContribution (1% capped at R17,712)", () => {
  it("below the ceiling", () => expect(uifContribution(10000)).toBeCloseTo(100, 2));
  it("at/above the ceiling caps at R177.12", () => {
    expect(uifContribution(30000)).toBeCloseTo(177.12, 2);
    expect(uifContribution(17712)).toBeCloseTo(177.12, 2);
  });
});

describe("medicalTaxCredit", () => {
  it("no members = 0", () => expect(medicalTaxCredit(0)).toBe(0));
  it("main member only", () => expect(medicalTaxCredit(1)).toBe(364));
  it("main + first dependant", () => expect(medicalTaxCredit(2)).toBe(728));
  it("main + 2 dependants", () => expect(medicalTaxCredit(3)).toBe(364 + 364 + 246));
});

describe("retirementDeduction (min of contribution, 27.5%, annual cap/12)", () => {
  it("contribution under all caps is allowed in full", () => {
    expect(retirementDeduction(30000, 3000)).toBeCloseTo(3000, 2);
  });
  it("limited to 27.5% of gross", () => {
    expect(retirementDeduction(10000, 5000)).toBeCloseTo(2750, 2); // 27.5% of 10000
  });
});

describe("computeETI", () => {
  it("band 1 (<=R2,499.99): 60% of wage", () => {
    expect(computeETI(2000, 25, 0, true)).toBeCloseTo(1200, 2);
  });
  it("band 2 (R2,500–R5,499.99): flat R1,500", () => {
    expect(computeETI(4000, 25, 0, true)).toBeCloseTo(1500, 2);
  });
  it("band 3 taper", () => {
    // 1500 - 75% * (6000 - 5500) = 1500 - 375 = 1125
    expect(computeETI(6000, 25, 0, true)).toBeCloseTo(1125, 2);
  });
  it("halved in the second 12-month period", () => {
    expect(computeETI(4000, 25, 12, true)).toBeCloseTo(750, 2);
  });
  it("0 when out of age range / over ceiling / ineligible", () => {
    expect(computeETI(4000, 35, 0, true)).toBe(0);
    expect(computeETI(7000, 25, 0, true)).toBe(0);
    expect(computeETI(4000, 25, 0, false)).toBe(0);
  });
});

describe("computeZAPayroll", () => {
  it("earner below the tax threshold pays no PAYE", () => {
    // R7,000/mo -> R84,000/yr; tax 15,120 < primary rebate 17,235 -> 0
    const r = computeZAPayroll({ employeeId: "e1", grossMonthly: 7000 });
    expect(r.paye).toBe(0);
    expect(r.uifEmployee).toBeCloseTo(70, 2);
    expect(r.sdl).toBeCloseTo(70, 2);
  });

  it("mid-range earner — PAYE, capped UIF, SDL", () => {
    const r = computeZAPayroll({ employeeId: "e2", grossMonthly: 30000 });
    // annual tax 74,632 - rebate 17,235 = 57,397 /12 = 4,783.08
    expect(r.paye).toBeCloseTo(4783.08, 1);
    expect(r.uifEmployee).toBeCloseTo(177.12, 2); // capped
    expect(r.uifEmployer).toBeCloseTo(177.12, 2);
    expect(r.sdl).toBeCloseTo(300, 2);
    expect(r.netPay).toBeCloseTo(30000 - 4783.08 - 177.12, 1);
  });

  it("age 65 gets the secondary rebate (lower PAYE)", () => {
    const younger = computeZAPayroll({ employeeId: "e3", grossMonthly: 30000, age: 40 });
    const older = computeZAPayroll({ employeeId: "e3", grossMonthly: 30000, age: 66 });
    expect(older.paye).toBeLessThan(younger.paye);
    // difference ≈ secondary rebate / 12 = 9444/12 = 787
    expect(younger.paye - older.paye).toBeCloseTo(787, 0);
  });

  it("medical scheme credit reduces PAYE", () => {
    const base = computeZAPayroll({ employeeId: "e4", grossMonthly: 30000 });
    const withMed = computeZAPayroll({
      employeeId: "e4",
      grossMonthly: 30000,
      medicalAidBeneficiaries: 2,
    });
    expect(base.paye - withMed.paye).toBeCloseTo(728, 1); // 364 + 364
  });

  it("retirement contribution lowers taxable income and PAYE", () => {
    const base = computeZAPayroll({ employeeId: "e5", grossMonthly: 30000 });
    const withRa = computeZAPayroll({
      employeeId: "e5",
      grossMonthly: 30000,
      retirementContributionMonthly: 3000,
    });
    expect(withRa.taxableMonthly).toBeCloseTo(27000, 2);
    expect(withRa.paye).toBeLessThan(base.paye);
  });

  it("SDL can be switched off for small employers", () => {
    const r = computeZAPayroll({ employeeId: "e6", grossMonthly: 30000, sdlApplicable: false });
    expect(r.sdl).toBe(0);
  });
});
