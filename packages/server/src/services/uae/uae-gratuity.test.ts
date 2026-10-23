import { describe, expect, it, vi } from "vitest";
vi.mock("../../utils/logger", () => ({ logger: { error: vi.fn() } }));
import type { UaeEmployeeProfile, UaeGratuityLiabilityInput } from "@emp-payroll/shared";
import { computeUaeGratuityLiability } from "./uae-gratuity";
import { calculateUaePayroll } from "./uae-payroll";

const profile = (change: Partial<UaeEmployeeProfile> = {}): UaeEmployeeProfile => ({
  jurisdiction: "federal",
  effectiveFrom: "2020-01-01",
  nationality: "IN",
  basicSalary: 600_000,
  allowances: [{ name: "Housing", amount: 400_000 }],
  normalDailyHours: 8,
  iloe: { mode: "employee_paid" },
  healthInsuranceEmployer: 0,
  savings: { scheme: "gratuity" },
  wps: {
    employeeId: "12345678901234",
    routingCode: "123456789",
    accountNumber: "AE123456789012345678901",
  },
  ...change,
});
function input(change: Partial<UaeGratuityLiabilityInput> = {}): UaeGratuityLiabilityInput {
  return {
    year: 2026,
    month: 10,
    startDate: "2024-01-01",
    opening: {
      profile: profile(),
      cumulativeUnpaidServiceDays: 0,
      unpaidServiceReference: "Verified opening attendance history",
    },
    closing: {
      profile: profile(),
      cumulativeUnpaidServiceDays: 0,
      unpaidServiceReference: "Verified closing attendance history",
    },
    settlementsPaidBeforePeriod: 0,
    settlementsPaidDuringPeriod: 0,
    settlementHistoryReference: "Paid settlements ledger reconciled through October",
    ...change,
  };
}

describe("monthly UAE gratuity liability", () => {
  it("reconciles retained opening, monthly accrual and closing balances in integer fils", () => {
    const result = computeUaeGratuityLiability(input());
    expect(result.status).toBe("calculated");
    expect(result.openingDate).toBe("2026-09-30");
    expect(result.closingDate).toBe("2026-10-31");
    expect(result.salaryRevaluation).toBe(0);
    expect(result.serviceAccrual).toBe(
      Math.round(420_000 * (2 + 304 / 365)) - Math.round(420_000 * (2 + 273 / 365)),
    );
    expect(result.openingAccruedLiability! + result.accrualExpense! - result.settlementsPaid).toBe(
      result.closingAccruedLiability,
    );
    expect(result.netMovement).toBe(result.accrualExpense);
    expect(result.closingVestedAmount).toBe(result.closingAccruedLiability);
    expect(result.employerSavingsContributions).toBe(0);
  });
  it("separates a first-year provision from a legally vested zero entitlement", () => {
    const result = computeUaeGratuityLiability(input({ startDate: "2026-07-01" }));
    expect(result.status).toBe("calculated");
    expect(result.closingAccruedLiability).toBeGreaterThan(0);
    expect(result.closingVestedAmount).toBe(0);
    expect(result.closingServiceYears).toBeLessThan(1);
  });
  it("starts opening at zero for a new employee without fabricating earlier history", () => {
    const result = computeUaeGratuityLiability(input({ startDate: "2026-10-15", opening: {} }));
    expect(result.status).toBe("calculated");
    expect(result.openingAccruedLiability).toBe(0);
    expect(result.salaryRevaluation).toBe(0);
    expect(result.serviceAccrual).toBe(result.closingAccruedLiability);
  });
  it("shows salary revaluation separately from service accrual", () => {
    const data = input();
    data.closing.profile = profile({ basicSalary: 900_000, effectiveFrom: "2026-10-01" });
    const result = computeUaeGratuityLiability(data);
    expect(result.status).toBe("calculated");
    const openingRepriced = Math.round(630_000 * (2 + 273 / 365));
    expect(result.salaryRevaluation).toBe(openingRepriced - result.openingAccruedLiability!);
    expect(result.serviceAccrual! + result.salaryRevaluation!).toBe(result.accrualExpense);
  });
  it("excludes recorded unpaid service and rejects a drifting cumulative baseline", () => {
    const data = input();
    data.opening.cumulativeUnpaidServiceDays = 5;
    data.closing.cumulativeUnpaidServiceDays = 15;
    const adjusted = computeUaeGratuityLiability(data);
    expect(adjusted.status).toBe("calculated");
    expect(adjusted.serviceAccrual).toBeLessThan(
      computeUaeGratuityLiability(input()).serviceAccrual!,
    );
    data.closing.cumulativeUnpaidServiceDays = 4;
    const invalid = computeUaeGratuityLiability(data);
    expect(invalid.status).toBe("needs_review");
    expect(invalid.warnings.join(" ")).toContain("reconcile");
  });
  it("returns review rather than treating missing unpaid history as zero", () => {
    const data = input();
    delete data.opening.cumulativeUnpaidServiceDays;
    delete data.closing.unpaidServiceReference;
    const result = computeUaeGratuityLiability(data);
    expect(result.status).toBe("needs_review");
    expect(result.openingAccruedLiability).toBeNull();
    expect(result.closingAccruedLiability).toBeNull();
    expect(result.warnings.join(" ")).toContain("missing history is not zero");
  });
  it("does not value old service with a profile effective only in the future", () => {
    const data = input();
    data.opening.profile = profile({ effectiveFrom: "2026-10-01" });
    const result = computeUaeGratuityLiability(data);
    expect(result.status).toBe("needs_review");
    expect(result.openingAccruedLiability).toBeNull();
    expect(result.closingAccruedLiability).not.toBeNull();
  });
  it("crosses the fifth service anniversary using the 21/30-day tiers", () => {
    const data = input({ startDate: "2021-10-15" });
    const result = computeUaeGratuityLiability(data);
    expect(result.status).toBe("calculated");
    expect(result.openingServiceYears).toBeLessThan(5);
    expect(result.closingServiceYears).toBeGreaterThan(5);
    expect(result.closingAccruedLiability).toBe(Math.round(20_000 * (105 + (30 * 17) / 365)));
  });
  it("caps federal liability at two years of wages", () => {
    const result = computeUaeGratuityLiability(input({ startDate: "1970-01-01" }));
    expect(result.status).toBe("calculated");
    expect(result.closingAccruedLiability).toBe(24_000_000);
    expect(result.serviceAccrual).toBe(0);
  });
  it("uses ADGM annual basic/365 and the reviewed 50% annual-wage floor", () => {
    const p = profile({
      jurisdiction: "adgm",
      basicSalary: 200_000,
      allowances: [{ name: "Housing", amount: 800_000 }],
    });
    const data = input();
    data.opening.profile = p;
    data.closing.profile = p;
    data.opening.annualWage = data.closing.annualWage = {
      amount: 12_000_000,
      reference: "Reviewed annual benefit wage",
    };
    const result = computeUaeGratuityLiability(data);
    expect(result.status).toBe("calculated");
    expect(result.closingAccruedLiability).toBe(
      Math.round((6_000_000 / 365) * 21 * (2 + 304 / 365)),
    );
    delete data.closing.annualWage;
    expect(computeUaeGratuityLiability(data).status).toBe("needs_review");
  });
  it("preserves frozen historical gratuity separately from employer fund contributions", () => {
    const p = profile({
      jurisdiction: "difc",
      savings: {
        scheme: "dews",
        enrolledOn: "2024-07-01",
        frozenGratuity: {
          amount: 250_000,
          asOf: "2024-06-30",
          reference: "Verified frozen entitlement",
        },
      },
    });
    const data = input();
    data.opening.profile = p;
    data.closing.profile = { ...p, basicSalary: 900_000 };
    data.savingsContributionsDuringPeriod = {
      amount: 52_470,
      reference: "October employer fund contribution",
    };
    const result = computeUaeGratuityLiability(data);
    expect(result.status).toBe("calculated");
    expect(result.openingAccruedLiability).toBe(250_000);
    expect(result.closingAccruedLiability).toBe(250_000);
    expect(result.accrualExpense).toBe(0);
    expect(result.employerSavingsContributions).toBe(52_470);
  });
  it("requires a preserved opening entitlement for an employee switched to savings", () => {
    const p = profile({ savings: { scheme: "federal_savings", enrolledOn: "2026-01-01" } });
    const data = input();
    data.opening.profile = data.closing.profile = p;
    const result = computeUaeGratuityLiability(data);
    expect(result.status).toBe("needs_review");
    expect(result.closingAccruedLiability).toBeNull();
    expect(result.warnings.join(" ")).toContain("pre-enrollment");
  });
  it("uses reviewed valuations for special work patterns and DIFC exempt arrangements", () => {
    const data = input();
    data.opening.profile = data.closing.profile = profile({
      jurisdiction: "difc",
      savings: { scheme: "gratuity", exemptionReference: "Reviewed exemption" },
    });
    expect(computeUaeGratuityLiability(data).status).toBe("needs_review");
    data.opening.approvedValuation = {
      accruedLiability: 120_000,
      vestedAmount: 120_000,
      reference: "Opening reviewed entitlement",
    };
    data.closing.approvedValuation = {
      accruedLiability: 130_000,
      vestedAmount: 130_000,
      reference: "Closing reviewed entitlement",
    };
    const result = computeUaeGratuityLiability(data);
    expect(result.status).toBe("calculated");
    expect(result.accrualExpense).toBe(10_000);
  });
  it("deducts only paid settlements from liability, without changing the service expense", () => {
    const original = computeUaeGratuityLiability(input());
    const paid = computeUaeGratuityLiability(
      input({ settlementsPaidBeforePeriod: 100_000, settlementsPaidDuringPeriod: 50_000 }),
    );
    expect(paid.status).toBe("calculated");
    expect(paid.openingAccruedLiability).toBe(original.openingAccruedLiability! - 100_000);
    expect(paid.closingAccruedLiability).toBe(original.closingAccruedLiability! - 150_000);
    expect(paid.accrualExpense).toBe(original.accrualExpense);
    expect(paid.netMovement).toBe(original.netMovement! - 50_000);
  });
  it("restores liability for a verified cash refund without changing service accrual", () => {
    const original = computeUaeGratuityLiability(input());
    const refunded = computeUaeGratuityLiability(
      input({ settlementsPaidBeforePeriod: 100_000, settlementsPaidDuringPeriod: -50_000 }),
    );
    expect(refunded.status).toBe("calculated");
    expect(refunded.settlementsPaid).toBe(-50_000);
    expect(refunded.closingAccruedLiability).toBe(original.closingAccruedLiability! - 50_000);
    expect(refunded.netMovement).toBe(original.netMovement! + 50_000);
    expect(refunded.accrualExpense).toBe(original.accrualExpense);
    const excessive = computeUaeGratuityLiability(
      input({ settlementsPaidBeforePeriod: 0, settlementsPaidDuringPeriod: -50_000 }),
    );
    expect(excessive.status).toBe("needs_review");
    expect(excessive.settlementsPaid).toBeNull();
  });
  it("leaves cash reconciliation unknown when paid settlement history is not verified", () => {
    const result = computeUaeGratuityLiability(input({ settlementHistoryReference: "" }));
    expect(result.status).toBe("needs_review");
    expect(result.closingAccruedLiability).toBeNull();
    expect(result.settlementsPaid).toBeNull();
    expect(result.warnings.join(" ")).toContain("approved or unpaid");
  });
  it("releases an unvested provision at termination rather than carrying a payable", () => {
    const result = computeUaeGratuityLiability(
      input({ startDate: "2026-07-01", endDate: "2026-10-15" }),
    );
    expect(result.status).toBe("calculated");
    expect(result.openingAccruedLiability).toBeGreaterThan(0);
    expect(result.closingAccruedLiability).toBe(0);
    expect(result.closingVestedAmount).toBe(0);
    expect(result.accrualExpense).toBe(-result.openingAccruedLiability!);
  });
  it("matches the final-settlement entitlement and clears the liability only when paid", () => {
    const data = input({ endDate: "2026-10-31" });
    const settlement = calculateUaePayroll(
      profile(),
      { finalSettlement: { terminationDate: data.endDate!, unpaidServiceDays: 0 } },
      { year: data.year, month: data.month, startDate: data.startDate, endDate: data.endDate },
    );
    const unpaid = computeUaeGratuityLiability(data);
    expect(unpaid.closingVestedAmount).toBe(settlement.finalSettlement!.gratuity);
    data.settlementsPaidDuringPeriod = settlement.finalSettlement!.gratuity;
    const paid = computeUaeGratuityLiability(data);
    expect(paid.status).toBe("calculated");
    expect(paid.closingAccruedLiability).toBe(0);
    expect(paid.closingVestedAmount).toBe(0);
  });
  it("does not double accrue gratuity for confirmed national pension membership", () => {
    const p = profile({
      nationality: "AE",
      pension: { scheme: "gpssa_old", authorityReference: "Authority registration" },
    });
    const data = input();
    data.opening = data.closing = { profile: p };
    const result = computeUaeGratuityLiability(data);
    expect(result.status).toBe("calculated");
    expect(result.closingAccruedLiability).toBe(0);
    expect(result.accrualExpense).toBe(0);
  });
});
