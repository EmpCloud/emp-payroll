import { describe, it, expect } from "vitest";
import {
  resolveSalaryComponents,
  applySalaryOverrides,
  validateOverrides,
  SalaryResolverError,
  type ResolverComponent,
} from "@emp-payroll/shared";

// Org structure: Basic 60 / HRA 24 / SA 11 / Conv 5 (% of gross, sum = 100).
const DEFS: ResolverComponent[] = [
  {
    code: "BASIC",
    name: "Basic",
    type: "earning",
    calculationType: "percentage",
    value: 60,
    percentageOf: "GROSS",
  },
  {
    code: "HRA",
    name: "HRA",
    type: "earning",
    calculationType: "percentage",
    value: 24,
    percentageOf: "GROSS",
  },
  {
    code: "SA",
    name: "Special Allowance",
    type: "earning",
    calculationType: "percentage",
    value: 11,
    percentageOf: "GROSS",
  },
  {
    code: "CONV",
    name: "Conveyance",
    type: "earning",
    calculationType: "percentage",
    value: 5,
    percentageOf: "GROSS",
  },
];
const CTC = 600000; // ₹50,000/month gross
const amt = (rows: any[], code: string) => rows.find((c) => c.code === code)!.monthlyAmount;
const sum = (rows: any[]) => rows.reduce((s, c) => s + c.monthlyAmount, 0);

describe("salary overrides — auto-proportional redistribution", () => {
  it("no override → standard % of gross", () => {
    const r = resolveSalaryComponents(DEFS, CTC);
    expect(amt(r, "BASIC")).toBe(30000);
    expect(amt(r, "HRA")).toBe(12000);
    expect(sum(r)).toBe(50000);
  });

  it("pin Basic ₹40,000 → HRA/SA/Conv split the remaining ₹10,000 by 24:11:5", () => {
    const r = resolveSalaryComponents(DEFS, CTC, { overrides: { BASIC: 40000 } });
    expect(amt(r, "BASIC")).toBe(40000);
    expect(amt(r, "HRA")).toBe(6000); // 24/40 × 10,000
    expect(amt(r, "SA")).toBe(2750); // 11/40 × 10,000
    expect(amt(r, "CONV")).toBe(1250); // 5/40 × 10,000
    expect(sum(r)).toBe(50000); // gross preserved exactly
  });

  it("pin two components → the rest absorb the balance, gross exact", () => {
    const r = resolveSalaryComponents(DEFS, CTC, { overrides: { BASIC: 40000, CONV: 2000 } });
    expect(amt(r, "BASIC")).toBe(40000);
    expect(amt(r, "CONV")).toBe(2000);
    // remaining 8,000 split between HRA(24) and SA(11) = 35 parts
    expect(amt(r, "HRA")).toBe(Math.round((8000 * 24) / 35)); // ~5,486
    expect(sum(r)).toBe(50000);
  });

  it("applySalaryOverrides is idempotent on an already-resolved snapshot", () => {
    const first = resolveSalaryComponents(DEFS, CTC, { overrides: { BASIC: 40000 } });
    const before = first.map((c) => c.monthlyAmount);
    applySalaryOverrides(first, 50000, { BASIC: 40000 });
    expect(first.map((c) => c.monthlyAmount)).toEqual(before);
  });

  it("validateOverrides rejects pins exceeding gross", () => {
    const base = resolveSalaryComponents(DEFS, CTC);
    expect(() => validateOverrides(base, 50000, { BASIC: 60000 })).toThrow(SalaryResolverError);
  });

  it("validateOverrides rejects an unknown component code", () => {
    const base = resolveSalaryComponents(DEFS, CTC);
    expect(() => validateOverrides(base, 50000, { BONUS: 5000 })).toThrow(/unknown component/i);
  });

  it("validateOverrides passes for the valid ₹40k Basic pin", () => {
    const base = resolveSalaryComponents(DEFS, CTC);
    expect(() => validateOverrides(base, 50000, { BASIC: 40000 })).not.toThrow();
  });
});

describe("salary overrides — non-% of-gross structures keep gross exact", () => {
  // Mirrors the reported bug: HRA is % of Basic, Special Allowance is balance.
  const MIXED: ResolverComponent[] = [
    {
      code: "BASIC",
      name: "Basic",
      type: "earning",
      calculationType: "percentage",
      value: 50,
      percentageOf: "GROSS",
    },
    {
      code: "HRA",
      name: "HRA",
      type: "earning",
      calculationType: "percentage",
      value: 35,
      percentageOf: "BASIC",
    },
    {
      code: "SA",
      name: "Special Allowance",
      type: "earning",
      calculationType: "balance",
      value: 0,
    },
  ];
  const C = 180000; // ₹15,000/month gross

  it("no pin → 7,500 / 2,625 / 4,875 (gross 15,000)", () => {
    const r = resolveSalaryComponents(MIXED, C);
    expect(amt(r, "BASIC")).toBe(7500);
    expect(amt(r, "HRA")).toBe(2625);
    expect(amt(r, "SA")).toBe(4875);
    expect(sum(r)).toBe(15000);
  });

  it("pin Basic 13,000 → HRA + SA shrink to keep gross 15,000 (bug: was 20,500)", () => {
    const r = resolveSalaryComponents(MIXED, C, { overrides: { BASIC: 13000 } });
    expect(amt(r, "BASIC")).toBe(13000);
    expect(sum(r)).toBe(15000); // <- the fix: gross stays exact
    expect(amt(r, "HRA")).toBeLessThan(2625);
    expect(amt(r, "SA")).toBeLessThan(4875);
    // remaining 2,000 split by original 2,625 : 4,875
    expect(amt(r, "HRA")).toBe(700);
    expect(amt(r, "SA")).toBe(1300);
  });
});
