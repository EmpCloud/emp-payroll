import { describe, expect, it, vi } from "vitest";
vi.mock("../../utils/logger", () => ({ logger: { error: vi.fn() } }));
import type { UaeEmployeeProfile, UaePeriodInput } from "@emp-payroll/shared";
import { calculateUaePayroll, validateUaeProfile } from "./uae-payroll";

const context = { year: 2026, month: 10, startDate: "2020-01-01" };
const profile = (changes: Partial<UaeEmployeeProfile> = {}): UaeEmployeeProfile => ({
  jurisdiction: "federal",
  effectiveFrom: "2020-01-01",
  nationality: "IN",
  basicSalary: 600_000,
  allowances: [{ name: "Housing", amount: 400_000 }],
  normalDailyHours: 8,
  probationEndsOn: "2020-06-30",
  iloe: { mode: "employee_paid" },
  healthInsuranceEmployer: 10_000,
  savings: { scheme: "gratuity" },
  wps: {
    employeeId: "12345678901234",
    routingCode: "123456789",
    accountNumber: "AE123456789012345678901",
  },
  ...changes,
});
const member = (
  scheme: NonNullable<UaeEmployeeProfile["pension"]>["scheme"],
  salary = 1_000_000,
): UaeEmployeeProfile =>
  profile({
    nationality: "AE",
    pension: {
      scheme,
      contributionSalary: salary,
      salaryYear: 2026,
      firstInsuredOn: scheme.endsWith("old") ? "2020-01-01" : "2024-01-01",
      authorityReference: "Confirmed authority registration",
    },
  });
const calculate = (p = profile(), input: UaePeriodInput = {}, dates = context) =>
  calculateUaePayroll(p, input, dates);

describe("UAE salary and input validation", () => {
  it("pays expat wages without invented pension, income tax or individual ILOE deductions", () => {
    const result = calculate();
    expect(result.grossSalary).toBe(1_000_000);
    expect(result.netSalary).toBe(1_000_000);
    expect(result.pensionEmployee).toBe(0);
    expect(result.totalEmployerCost).toBe(1_010_000);
    expect(result.paymentDueDate).toBe("2026-11-01");
    expect(result.earnings.reduce((sum, line) => sum + line.amount, 0)).toBe(result.grossSalary);
  });
  it("rejects fractional money, invalid dates and profiles not effective throughout the period", () => {
    expect(() => calculate(profile({ basicSalary: 1.1 }))).toThrow("integer in fils");
    expect(() => calculate(profile({ effectiveFrom: "2026-02-30" }))).toThrow("valid date");
    expect(() => calculate(profile({ effectiveFrom: "2026-10-16" }))).toThrow("salary history");
  });
  it("requires pension history for nationals and a documented WPS exemption", () => {
    expect(() => validateUaeProfile(profile({ nationality: "AE" }))).toThrow("confirmed pension");
    expect(() => validateUaeProfile(profile({ nationality: "SA" }))).toThrow("confirmed pension");
    expect(() => validateUaeProfile(profile({ wps: {} }))).toThrow("WPS employee");
    expect(() =>
      validateUaeProfile(
        profile({ wps: { exemption: { reason: "DIFC", reference: "Employer authority record" } } }),
      ),
    ).not.toThrow();
  });
  it("enforces the Emirati minimum against full contracted pay, not earned partial-month pay", () => {
    expect(() =>
      calculate(member("gpssa_old"), {}, { ...context, startDate: "2026-10-28" }),
    ).not.toThrow();
    expect(() =>
      calculate({ ...member("gpssa_old"), basicSalary: 300_000, allowances: [] }),
    ).toThrow("AED 6,000");
  });
  it("does not apply private-sector rules to domestic, part-time or government employment", () => {
    expect(() => calculate(profile({ workPattern: "domestic" }))).toThrow(
      "separately approved regime",
    );
    const p = member("gpssa_old");
    p.pension.sector = "government";
    expect(() => calculate(p)).toThrow("Government employment");
  });
  it("uses documented salary for part-time work and requires its own benefit review", () => {
    const p = profile({ workPattern: "part_time" });
    expect(() => calculate(p)).toThrow("Non-full-time");
    const input: UaePeriodInput = {
      approvedAdjustments: {
        regularSalary: { amount: 500_000, reference: "Reviewed part-time contract" },
      },
    };
    expect(calculate(p, input).grossSalary).toBe(500_000);
    expect(() =>
      calculateUaePayroll(
        p,
        {
          ...input,
          finalSettlement: {
            terminationDate: "2026-10-31",
            unpaidServiceDays: 0,
          },
        },
        { ...context, endDate: "2026-10-31" },
      ),
    ).toThrow("Non-full-time gratuity");
  });
  it("does not require MoHRE identifiers outside the MoHRE jurisdiction", () => {
    expect(() => validateUaeProfile(profile({ jurisdiction: "adgm", wps: {} }))).not.toThrow();
    expect(() => validateUaeProfile(profile({ jurisdiction: "difc", wps: {} }))).not.toThrow();
  });
  it("does not permit a contract to extend the current statutory wage due date", () => {
    expect(() => calculate(profile({ salaryPaymentDay: 2 }))).toThrow("statutory payment deadline");
  });
  it("preserves reviewed WPS variable-income categories and excludes reimbursements", () => {
    const result = calculate(profile(), {
      variableEarnings: [{ name: "Variable transport", amount: 10_000, wpsCategory: "conveyance" }],
    });
    expect(result.earnings.find((entry) => entry.code === "VARIABLE_1")?.wpsCategory).toBe(
      "conveyance",
    );
    expect(() =>
      calculate(profile(), {
        variableEarnings: [
          {
            name: "Travel reimbursement",
            amount: 10_000,
            kind: "reimbursement",
            wpsCategory: "conveyance",
          },
        ],
      }),
    ).toThrow("not reimbursements");
  });
  it("allocates integer rounding across several allowances without a negative component", () => {
    const p = profile({
      workPattern: "part_time",
      basicSalary: 1,
      allowances: [1, 2, 3, 4].map((n) => ({ name: `Allowance ${n}`, amount: 1 })),
    });
    const result = calculate(p, {
      approvedAdjustments: { regularSalary: { amount: 3, reference: "Reviewed earned salary" } },
    });
    expect(result.grossSalary).toBe(3);
    expect(result.earnings.every((entry) => entry.amount >= 0)).toBe(true);
  });
});

describe("authority-specific pension", () => {
  it("retains GPSSA old membership through a new employer and keeps subsidy out of employer cost", () => {
    const result = calculate(member("gpssa_old"), {}, { ...context, startDate: "2026-10-01" });
    expect(result.pensionEmployee).toBe(50_000);
    expect(result.pensionEmployer).toBe(125_000);
    expect(result.pensionGovernment).toBe(25_000);
    expect(result.totalEmployerCost).toBe(1_135_000);
    expect(result.pensionDueDate).toBe("2026-11-15");
  });
  it("uses the strict AED20,000 GPSSA subsidy boundary", () => {
    const low = calculate(member("gpssa_new", 1_999_900));
    const boundary = calculate(member("gpssa_new", 2_000_000));
    expect(low.schemeMetadata.pensionEmployerRate).toBe(12.5);
    expect(low.schemeMetadata.pensionGovernmentRate).toBe(2.5);
    expect(boundary.pensionEmployee).toBe(220_000);
    expect(boundary.pensionEmployer).toBe(300_000);
    expect(boundary.pensionGovernment).toBe(0);
  });
  it("rejects stale January salary, invalid regime dates and out-of-range registered bases", () => {
    const stale = member("gpssa_old");
    stale.pension.salaryYear = 2025;
    expect(() => calculate(stale)).toThrow("payroll year");
    const wrong = member("gpssa_new");
    wrong.pension.firstInsuredOn = "2020-01-01";
    expect(() => calculate(wrong)).toThrow("membership history");
    expect(() => calculate(member("gpssa_old", 5_000_100))).toThrow("permitted limits");
  });
  it("uses ADPF's separate old/new rates, ceilings and20th-day due date", () => {
    const p = member("adpf_old", 15_000_000);
    p.basicSalary = 15_000_000;
    p.allowances = [];
    const old = calculate(p);
    expect(old.pensionEmployee).toBe(750_000);
    expect(old.pensionGovernment).toBe(900_000);
    expect(old.pensionDueDate).toBe("2026-11-20");
    expect(calculate(member("adpf_new")).pensionEmployee).toBe(110_000);
    expect(() => calculate(member("adpf_new", 10_000_100))).toThrow("permitted limits");
  });
  it("charges a full GPSSA joining month and distinguishes old/new partial exits", () => {
    expect(
      calculate(member("gpssa_new"), {}, { ...context, startDate: "2026-10-20" }).pensionEmployee,
    ).toBe(110_000);
    const exitContext = { ...context, endDate: "2026-10-20" };
    expect(calculateUaePayroll(member("gpssa_old"), {}, exitContext).pensionEmployee).toBe(0);
    expect(calculateUaePayroll(member("gpssa_new"), {}, exitContext).pensionEmployee).toBe(110_000);
  });
  it("applies ADPF and SSSF private-sector full joining and no partial exit contributions", () => {
    for (const scheme of ["adpf_old", "adpf_new", "sssf"] as const) {
      const p = member(scheme);
      expect(
        calculate(p, {}, { ...context, startDate: "2026-10-20" }).pensionEmployee,
      ).toBeGreaterThan(0);
      expect(
        calculateUaePayroll(p, {}, { ...context, endDate: "2026-10-20" }).pensionEmployee,
      ).toBe(0);
      expect(
        calculateUaePayroll(p, {}, { ...context, endDate: "2026-10-31" }).pensionEmployee,
      ).toBeGreaterThan(0);
    }
  });
  it("does not prorate pension for LOP without authority-specific approval", () => {
    const p = member("gpssa_new");
    expect(() => calculate(p, { unpaidDays: 2 })).toThrow("authority-approved amounts");
    p.pension.approvedPeriodAmounts = {
      month: 10,
      year: 2026,
      employee: 110_000,
      employer: 125_000,
      government: 25_000,
      reference: "Authority unpaid-leave assessment",
    };
    expect(calculate(p, { unpaidDays: 2 }).pensionEmployee).toBe(110_000);
  });
  it("requires effective approved home-country rates for GCC extension", () => {
    const p = profile({
      nationality: "OM",
      pension: {
        scheme: "gcc",
        firstInsuredOn: "2020-01-01",
        contributionSalary: 1_000_000,
        salaryYear: 2026,
        authorityReference: "Oman extension registration",
        gcc: {
          employeeRate: 7.5,
          employerRate: 11,
          minimumSalary: 0,
          maximumSalary: 5_000_000,
          effectiveFrom: "2026-01-01",
          effectiveTo: "2026-12-31",
          reference: "Approved home authority schedule",
        },
      },
    });
    expect(calculate(p).pensionEmployee).toBe(75_000);
    expect(calculate(p).pensionEmployer).toBe(110_000);
    p.pension.gcc.effectiveTo = "2026-09-30";
    expect(() => calculate(p)).toThrow("complete payroll month");
  });
});

describe("leave, overtime and legal deductions", () => {
  it("crosses the federal sick-leave full/half/unpaid thresholds", () => {
    const half = calculate(profile(), { leaves: [{ kind: "sick", days: 2, usedToDate: 14 }] });
    expect(half.grossSalary).toBe(983_333);
    expect(half.unpaidDays).toBe(0);
    const unpaid = calculate(profile(), { leaves: [{ kind: "sick", days: 2, usedToDate: 44 }] });
    expect(unpaid.grossSalary).toBe(950_000);
    expect(unpaid.unpaidDays).toBe(1);
    expect(() => calculate(profile(), { leaves: [{ kind: "sick", days: 1 }] })).toThrow(
      "already used",
    );
  });
  it("pays zero for an entirely unpaid February or a 31-day month", () => {
    for (const [month, days] of [
      [2, 28],
      [10, 31],
    ]) {
      const result = calculate(profile(), { unpaidDays: days }, { ...context, month });
      expect(result.grossSalary).toBe(0);
      expect(result.netSalary).toBe(0);
      expect(result.paidDays).toBe(0);
      expect(result.unpaidDays).toBe(days);
    }
  });
  it("uses prior leave consumption for event and annual entitlement limits", () => {
    expect(() =>
      calculate(profile(), {
        leaves: [{ kind: "parental", days: 1, entitlementReference: "Birth record" }],
      }),
    ).toThrow("already used");
    expect(() =>
      calculate(profile(), {
        leaves: [
          { kind: "parental", days: 2, usedToDate: 4, entitlementReference: "Birth record" },
        ],
      }),
    ).toThrow("entitlement");
    expect(
      calculate(profile(), {
        leaves: [
          { kind: "parental", days: 1, usedToDate: 4, entitlementReference: "Birth record" },
        ],
      }).grossSalary,
    ).toBe(1_000_000);
  });
  it("pays maternity days46–60 at half wage", () => {
    const result = calculate(profile(), {
      leaves: [{ kind: "maternity", days: 3, usedToDate: 44 }],
    });
    expect(result.grossSalary).toBe(966_667);
  });
  it("calculates ordinary/night OT on basic pay and excludes shift night premium", () => {
    const overtime = {
      ordinaryHours: 8,
      nightHours: 8,
      approvedScheduleReference: "Approved daily roster",
    };
    expect(calculate(profile(), { overtime }).grossSalary).toBe(1_055_000);
    expect(calculate(profile({ isShiftWorker: true }), { overtime }).grossSalary).toBe(1_050_000);
  });
  it("requires reviewed rest-day compensation or records compensatory leave", () => {
    const overtime = { restDays: 1, approvedScheduleReference: "Roster" };
    expect(() => calculate(profile(), { overtime })).toThrow("approved amount");
    expect(
      calculate(profile(), { overtime: { ...overtime, compensatedRestDays: 1 } }).grossSalary,
    ).toBe(1_000_000);
    expect(
      calculate(profile(), {
        overtime,
        approvedAdjustments: {
          overtimePay: { amount: 30_000, reference: "Reviewed rest-day calculation" },
        },
      }).grossSalary,
    ).toBe(1_030_000);
  });
  it("does not reuse federal sick-leave rules in ADGM", () => {
    const p = profile({ jurisdiction: "adgm" });
    const leaves: UaePeriodInput["leaves"] = [{ kind: "sick", days: 2, usedToDate: 14 }];
    expect(() => calculate(p, { leaves })).toThrow("Non-federal or non-full-time leave pay");
    expect(
      calculate(p, {
        leaves,
        approvedAdjustments: { leaveDeduction: { amount: 20_000, reference: "ADGM leave review" } },
      }).grossSalary,
    ).toBe(980_000);
  });
  it("aggregates overpayment caps across multiple lines", () => {
    const deductions: UaePeriodInput["deductions"] = [1, 2].map((n) => ({
      name: `Recovery${n}`,
      kind: "overpayment",
      amount: 110_000,
      reference: "Overpayment evidence",
    }));
    expect(() => calculate(profile(), { deductions })).toThrow("category ceiling");
  });
  it("requires consent/court evidence and never permits an override of federal50%", () => {
    expect(() =>
      calculate(profile(), {
        deductions: [{ name: "Loan", kind: "loan", amount: 1000, reference: "Agreement" }],
      }),
    ).toThrow("written consent");
    expect(() =>
      calculate(profile(), {
        deductions: [{ name: "Order", kind: "court", amount: 1000, reference: "Case" }],
      }),
    ).toThrow("court order");
    expect(() =>
      calculate(profile(), {
        deductions: [
          {
            name: "Loan",
            kind: "loan",
            amount: 500_001,
            consent: true,
            reference: "Interest-free agreement",
          },
        ],
        approvedAdjustments: {
          deductionLimit: { amount: 900_000, reference: "Cannot override federal law" },
        },
      }),
    ).toThrow("Combined deductions");
  });
});

describe("ILOE and savings", () => {
  const collected = (basicSalary = 1_600_000) =>
    profile({
      basicSalary,
      iloe: {
        mode: "employer_collected",
        policyReference: "ILOE123",
        policyStartsOn: "2026-10-01",
        policyMonths: 12,
        paymentFrequency: "monthly",
      },
    });
  it("collects lower-tier premium at exactly16000 and full policy VAT in the first payment", () => {
    const input = {
      iloeCollection: {
        amount: 800,
        premium: 500,
        vat: 300,
        coverageMonths: 1,
        dueOn: "2026-10-01",
        reference: "Insurer invoice",
      },
    };
    expect(calculate(collected(), input).otherDeductions).toBe(800);
    expect(() => calculate(collected(1_600_100), input)).toThrow("tier premium");
    expect(() => calculate(profile(), input)).toThrow("employer-collected");
  });
  it("does not invent a collection when no policy instalment is supplied", () => {
    expect(calculate(collected()).otherDeductions).toBe(0);
  });
  it("does not charge VAT again on subsequent instalments", () => {
    const p = collected();
    p.iloe.policyStartsOn = "2026-09-01";
    const input = {
      iloeCollection: {
        amount: 500,
        premium: 500,
        vat: 0,
        coverageMonths: 1,
        dueOn: "2026-10-01",
        reference: "Second instalment",
      },
    };
    expect(calculate(p, input).otherDeductions).toBe(500);
  });
  it("rejects off-schedule collections that would evade first-installment VAT", () => {
    const input: UaePeriodInput = {
      iloeCollection: {
        amount: 500,
        premium: 500,
        vat: 0,
        coverageMonths: 1,
        dueOn: "2026-10-02",
        reference: "Invoice",
      },
    };
    expect(() => calculate(collected(), input)).toThrow("installment schedule");
    const quarterly = collected();
    quarterly.iloe.policyStartsOn = "2026-09-01";
    quarterly.iloe.paymentFrequency = "quarterly";
    input.iloeCollection = {
      ...input.iloeCollection,
      dueOn: "2026-10-01",
      amount: 1500,
      premium: 1500,
      coverageMonths: 3,
    };
    expect(() => calculate(quarterly, input)).toThrow("installment schedule");
  });
  it("does not invent a deadline for an approved alternative fund", () => {
    const p = profile({
      savings: {
        scheme: "alternative",
        enrolledOn: "2024-01-01",
        approvedMonthlyContribution: { amount: 30_000, reference: "Qualifying fund terms" },
      },
    });
    const result = calculate(p);
    expect(result.savingsDueDate).toBeNull();
    expect(result.warnings.join(" ")).toContain("fund's documented remittance deadline");
  });
  it("uses the DEWS50% basic floor and separate21st-day deadline", () => {
    const p = profile({
      jurisdiction: "difc",
      basicSalary: 200_000,
      allowances: [{ name: "Regular", amount: 800_000 }],
      savings: { scheme: "dews", enrolledOn: "2024-01-01" },
      wps: { exemption: { reason: "DIFC", reference: "Authority record" } },
    });
    const result = calculate(p, {}, { ...context, startDate: "2024-01-01" });
    expect(result.savingsEmployer).toBe(29_150);
    expect(result.savingsDueDate).toBe("2026-11-21");
    expect(result.paymentDueDate).toBe("2026-11-07");
  });
  it("uses continuous service for federal savings and requires review at a mid-month five-year threshold", () => {
    const p = profile({ savings: { scheme: "federal_savings", enrolledOn: "2024-01-01" } });
    expect(calculate(p).savingsEmployer).toBe(49_980);
    expect(() => calculate(p, {}, { ...context, startDate: "2021-10-15" })).toThrow(
      "rate transition",
    );
  });
  it("requires a documented DIFC national top-up assessment even with a pension and gratuity profile", () => {
    const p = { ...member("gpssa_old"), jurisdiction: "difc" as const };
    const input: UaePeriodInput = {
      approvedAdjustments: {
        deductionLimit: { amount: 500_000, reference: "DIFC authorised deduction review" },
      },
    };
    expect(() => calculate(p, input)).toThrow("top-up assessment");
    p.savings.approvedMonthlyContribution = {
      amount: 10_000,
      reference: "Qualifying scheme top-up assessment",
    };
    const result = calculate(p, input);
    expect(result.savingsEmployer).toBe(10_000);
    expect(result.totalEmployerCost).toBe(1_145_000);
  });
});

describe("final settlement", () => {
  const finalContext = { ...context, startDate: "2025-11-01", endDate: "2026-10-31" };
  it("uses last basic for federal gratuity and leave, full wage for notice, with14-day deadline", () => {
    const result = calculateUaePayroll(
      profile(),
      {
        finalSettlement: {
          terminationDate: "2026-10-31",
          unpaidServiceDays: 0,
          unusedAnnualLeaveDays: 3,
          noticePayDays: 30,
          noticePayDirection: "employer_pays",
        },
      },
      finalContext,
    );
    expect(result.finalSettlement.gratuity).toBe(420_000);
    expect(result.finalSettlement.leaveEncashment).toBe(60_000);
    expect(result.finalSettlement.noticePay).toBe(1_000_000);
    expect(result.paymentDueDate).toBe("2026-11-01");
    expect(result.finalSettlement.paymentDueDate).toBe("2026-11-14");
    expect(result.finalSettlement.serviceYears).toBe(1);
  });
  it("excludes unpaid service and does not award gratuity below one eligible year", () => {
    const result = calculateUaePayroll(
      profile(),
      { finalSettlement: { terminationDate: "2026-10-31", unpaidServiceDays: 1 } },
      finalContext,
    );
    expect(result.finalSettlement.gratuity).toBe(0);
  });
  it("rejects approved gratuity below the known federal statutory minimum", () => {
    const input: UaePeriodInput = {
      finalSettlement: {
        terminationDate: "2026-10-31",
        unpaidServiceDays: 0,
        approvedGratuity: { amount: 0, reference: "Cannot waive entitlement" },
      },
    };
    expect(() => calculateUaePayroll(profile(), input, finalContext)).toThrow("cannot reduce");
    input.finalSettlement.approvedGratuity.amount = 450_000;
    expect(calculateUaePayroll(profile(), input, finalContext).finalSettlement.gratuity).toBe(
      450_000,
    );
  });
  it("uses ADGM annual-basic/365 and50%annual wage floor, without the federal divisor", () => {
    const p = profile({
      jurisdiction: "adgm",
      basicSalary: 200_000,
      allowances: [{ name: "Regular", amount: 800_000 }],
    });
    const result = calculateUaePayroll(
      p,
      {
        finalSettlement: {
          terminationDate: "2026-10-31",
          unpaidServiceDays: 0,
          annualWage: { amount: 12_000_000, reference: "Annual wage record" },
        },
      },
      finalContext,
    );
    expect(result.finalSettlement.gratuity).toBe(Math.round((6_000_000 / 365) * 21));
    expect(result.paymentDueDate).toBe("2026-11-14");
    expect(result.finalSettlement.paymentDueDate).toBe("2026-11-21");
  });
  it("does not award federal gratuity in addition to national pension", () => {
    const result = calculateUaePayroll(
      member("gpssa_old"),
      { finalSettlement: { terminationDate: "2026-10-31", unpaidServiceDays: 0 } },
      finalContext,
    );
    expect(result.finalSettlement.gratuity).toBe(0);
  });
  it("preserves reviewed pre-enrollment gratuity separately from the fund balance", () => {
    const p = profile({
      savings: {
        scheme: "federal_savings",
        enrolledOn: "2026-01-01",
        frozenGratuity: {
          amount: 100_000,
          asOf: "2025-12-31",
          reference: "Frozen enrollment calculation",
        },
      },
    });
    const result = calculateUaePayroll(
      p,
      { finalSettlement: { terminationDate: "2026-10-31", unpaidServiceDays: 0 } },
      finalContext,
    );
    expect(result.finalSettlement.gratuity).toBe(100_000);
  });
});
