import { describe, it, expect } from "vitest";
import { computePF, computeESI, computeProfessionalTax } from "./india-statutory.service";
import { getIndiaPFWageCeiling, getIndiaPFDueDate } from "@emp-payroll/shared";

// =============================================================================
// PROVIDENT FUND (PF)
// =============================================================================

describe("computePF", () => {
  const base = { employeeId: "emp-1", month: 3, year: 2026 };

  it("should cap PF wages at 15000 when basic > 15000", () => {
    const result = computePF({ ...base, basicSalary: 20000 });
    expect(result.pfWages).toBe(15000);
    expect(result.employeeEPF).toBe(1800); // 12% of 15000
  });

  it("should compute PF at 12% when basic <= 15000", () => {
    const result = computePF({ ...base, basicSalary: 10000 });
    expect(result.pfWages).toBe(10000);
    expect(result.employeeEPF).toBe(1200); // 12% of 10000
  });

  it("should compute PF at exactly ceiling boundary (basic = 15000)", () => {
    const result = computePF({ ...base, basicSalary: 15000 });
    expect(result.pfWages).toBe(15000);
    expect(result.employeeEPF).toBe(1800);
  });

  it("should include DA in PF wages calculation", () => {
    const result = computePF({ ...base, basicSalary: 10000, daAmount: 3000 });
    // basic + DA = 13000, below ceiling
    expect(result.pfWages).toBe(13000);
    expect(result.employeeEPF).toBe(1560); // 12% of 13000
  });

  it("should cap PF wages when basic + DA exceeds ceiling", () => {
    const result = computePF({ ...base, basicSalary: 12000, daAmount: 5000 });
    // basic + DA = 17000, capped at 15000
    expect(result.pfWages).toBe(15000);
    expect(result.employeeEPF).toBe(1800);
  });

  it("should compute employer EPF as the 12% total minus EPS, not a direct 3.67%", () => {
    const result = computePF({ ...base, basicSalary: 15000 });
    // EPFO method: 12% of 15000 = 1800, minus EPS 1250 = 550. A direct
    // 3.67% of 15000 would mis-round to 551.
    expect(result.employerEPF).toBe(550);
    expect(result.employerEPF + result.employerEPS).toBe(1800);
  });

  it("should compute employer EPS at 8.33% of EPS wages", () => {
    const result = computePF({ ...base, basicSalary: 15000 });
    expect(result.employerEPS).toBe(Math.round((15000 * 8.33) / 100)); // 1250
  });

  it("should compute admin charges at 0.5%", () => {
    const result = computePF({ ...base, basicSalary: 15000 });
    expect(result.adminCharges).toBe(Math.round((15000 * 0.5) / 100)); // 75
  });

  it("should compute EDLI charges at 0.5%", () => {
    const result = computePF({ ...base, basicSalary: 15000 });
    expect(result.edliCharges).toBe(Math.round((15000 * 0.5) / 100)); // 75
  });

  it("should sum totalEmployer = employerEPF + employerEPS + admin + edli", () => {
    const result = computePF({ ...base, basicSalary: 15000 });
    expect(result.totalEmployer).toBe(
      result.employerEPF + result.employerEPS + result.adminCharges + result.edliCharges,
    );
  });

  it("should sum totalEmployee = employeeEPF + VPF", () => {
    const result = computePF({ ...base, basicSalary: 15000 });
    expect(result.totalEmployee).toBe(result.employeeEPF + result.employeeVPF);
  });

  it("should compute VPF when isVoluntaryPF is true", () => {
    const result = computePF({ ...base, basicSalary: 20000, isVoluntaryPF: true, vpfRate: 5 });
    // VPF is 5% of full basic (not capped), basic + DA = 20000
    expect(result.employeeVPF).toBe(Math.round((20000 * 5) / 100)); // 1000
    expect(result.totalEmployee).toBe(result.employeeEPF + 1000);
  });

  it("should set VPF to 0 when isVoluntaryPF is false", () => {
    const result = computePF({ ...base, basicSalary: 20000, isVoluntaryPF: false, vpfRate: 5 });
    expect(result.employeeVPF).toBe(0);
  });

  it("should allow custom contribution rate", () => {
    const result = computePF({ ...base, basicSalary: 10000, contributionRate: 6 });
    expect(result.employeeEPF).toBe(600); // 6% of 10000
  });

  it("should handle zero basic salary", () => {
    const result = computePF({ ...base, basicSalary: 0 });
    expect(result.pfWages).toBe(0);
    expect(result.employeeEPF).toBe(0);
    expect(result.totalEmployer).toBe(0);
    expect(result.totalEmployee).toBe(0);
  });

  it("should pass through employeeId, month, year", () => {
    const result = computePF({ employeeId: "xyz", month: 7, year: 2025, basicSalary: 10000 });
    expect(result.employeeId).toBe("xyz");
    expect(result.month).toBe(7);
    expect(result.year).toBe(2025);
  });
});

// =============================================================================
// EMPLOYEE STATE INSURANCE (ESI)
// =============================================================================

describe("September 2026 PF revision", () => {
  const base = { employeeId: "emp-1", year: 2026, month: 9, basicSalary: 20000 };

  it("keeps historical ceilings and uses the publication date", () => {
    expect(getIndiaPFWageCeiling("2026-09-16")).toBe(15000);
    expect(getIndiaPFWageCeiling("2026-09-17")).toBe(25000);
    expect(computePF({ ...base, month: 8 }).employeeEPF).toBe(1800);
    expect(computePF({ ...base, month: 10 }).employeeEPF).toBe(2400);
  });

  it("splits September at the two calendar ceilings and rounds EPS before residual EPF", () => {
    const pf = computePF(base);
    expect(pf.pfWages).toBe(17333.33);
    expect(pf.employeeEPF).toBe(2080);
    expect(pf.employerEPS).toBe(1444);
    expect(pf.employerEPF).toBe(636);
    expect(pf.periods.map((p) => p.wageCeiling)).toEqual([15000, 25000]);
    expect(pf.periods.map((p) => p.startDate)).toEqual(["2026-09-01", "2026-09-17"]);
  });

  it("enrolls a confirmed wage-ceiling exclusion only from September 17", () => {
    const pf = computePF({
      ...base,
      pfDetails: { isOptedOut: true, exclusionReason: "wage_ceiling", membershipWages: 20000 },
    });
    expect(pf.pfWages).toBe(9333.33);
    expect(pf.epsWages).toBe(9333.33);
    expect(pf.employeeEPF).toBe(1120);
    expect(pf.employerEPS).toBe(777);
    expect(pf.isCovered).toBe(true);
    expect(pf.periods[0].isCovered).toBe(false);
    expect(pf.warnings).toEqual([]);
    expect(
      computePF({
        ...base,
        month: 8,
        pfDetails: { isOptedOut: true, exclusionReason: "wage_ceiling", membershipWages: 20000 },
      }).employeeEPF,
    ).toBe(0);
  });

  it("treats a recorded wage-ceiling exclusion as historical even without the legacy optout flag", () => {
    expect(
      computePF({ ...base, pfDetails: { exclusionReason: "wage_ceiling", membershipWages: 20000 } })
        .employeeEPF,
    ).toBe(1120);
    expect(
      computePF({
        ...base,
        month: 8,
        pfDetails: { exclusionReason: "wage_ceiling", membershipWages: 20000 },
      }).employeeEPF,
    ).toBe(0);
    expect(
      computePF({
        ...base,
        pfDetails: {
          isEpsMember: true,
          epsExclusionReason: "wage_ceiling",
          membershipWages: 20000,
        },
      }).employerEPS,
    ).toBe(777);
  });

  it("requires EPS membership history for above-ceiling new hires without changing existing members", () => {
    const joiner = { ...base, month: 10, basicSalary: 35000, dateOfJoining: "2026-10-01" };
    expect(computePF(joiner).warnings[0]).toContain("Review EPS history");
    expect(computePF({ ...joiner, dateOfJoining: "2026-01-01" }).warnings).toEqual([]);
    expect(computePF({ ...joiner, pfDetails: { isEpsMember: true } }).warnings).toEqual([]);
    expect(
      computePF({
        ...joiner,
        pfDetails: {
          isEpsMember: false,
          epsExclusionReason: "wage_ceiling",
          membershipWages: 35000,
        },
      }).employerEPS,
    ).toBe(0);
  });

  it("keeps statutory exemptions and flags unknown exclusion reasons for review", () => {
    expect(
      computePF({ ...base, pfDetails: { isOptedOut: true, exclusionReason: "exempt" } }).isCovered,
    ).toBe(false);
    const unknown = computePF({ ...base, pfDetails: { isOptedOut: true } });
    expect(unknown.employeeEPF).toBe(0);
    expect(unknown.warnings[0]).toContain("Review PF exclusion");
    expect(computePF({ ...base, pfDetails: { isEnrolled: false } }).employeeEPF).toBe(2080);
    expect(
      computePF({ ...base, basicSalary: 40000, pfDetails: { isOptedOut: true } }).warnings[0],
    ).toContain("Review PF exclusion");
    expect(
      computePF({ ...base, basicSalary: 40000, pfDetails: { isEpsMember: false } }).warnings[0],
    ).toContain("Review EPS exclusion");
  });

  it("requires fixed eligibility wages for ceiling exclusions and retains membership after pay rises", () => {
    const unknown = computePF({ ...base, pfDetails: { exclusionReason: "wage_ceiling" } });
    expect(unknown.warnings[0]).toContain("record statutory monthly wages");
    expect(unknown.isCovered).toBe(false);
    expect(
      computePF({ ...base, pfDetails: { isEpsMember: false, epsExclusionReason: "wage_ceiling" } })
        .warnings[0],
    ).toContain("record statutory monthly wages");
    const pfDetails = {
      exclusionReason: "wage_ceiling" as const,
      epsExclusionReason: "wage_ceiling" as const,
      membershipWages: 20000,
    };
    expect(computePF({ ...base, month: 8, pfDetails }).isCovered).toBe(false);
    const increased = computePF({ ...base, month: 10, basicSalary: 30000, pfDetails });
    expect(increased.isCovered).toBe(true);
    expect(increased.isEpsMember).toBe(true);
    expect(increased.employeeEPF).toBe(3000);
    expect(increased.employerEPS).toBe(2083);
    expect(increased.warnings).toEqual([]);
    expect(
      computePF({ ...base, pfDetails: { ...pfDetails, membershipWages: 15000 } }).warnings[0],
    ).toContain("do not establish an exclusion");
  });

  it("keeps a genuine above-ceiling excluded employee out even when earned wages fall below the ceiling", () => {
    const pf = computePF({
      ...base,
      month: 10,
      basicSalary: 12000,
      monthlyWages: 40000,
      pfDetails: { isOptedOut: true, exclusionReason: "wage_ceiling", membershipWages: 40000 },
    });
    expect(pf.employeeEPF).toBe(0);
    expect(pf.isCovered).toBe(false);
  });

  it("adds EPS from the effective date without reducing existing higher EPF contributions", () => {
    const pf = computePF({
      ...base,
      orgOverrides: { pfApplyFullBasic: true },
      pfDetails: { isEpsMember: false, epsExclusionReason: "wage_ceiling", membershipWages: 20000 },
    });
    expect(pf.employeeEPF).toBe(2400);
    expect(pf.epsWages).toBe(9333.33);
    expect(pf.employerEPS).toBe(777);
    expect(pf.employerEPF).toBe(1623);
    expect(pf.edliWages).toBe(17333.33);
    expect(pf.edliCharges).toBe(87);
    expect(pf.adminCharges).toBe(100);
  });

  it("preserves existing EPS membership above the new ceiling", () => {
    const pf = computePF({
      ...base,
      month: 10,
      basicSalary: 40000,
      pfDetails: { isEpsMember: true },
    });
    expect(pf.employerEPS).toBe(2083);
    expect(pf.employerEPF).toBe(917);
  });

  it("does not turn age or other EPS ineligibility into pension enrollment", () => {
    const pf = computePF({
      ...base,
      pfDetails: { isEpsMember: false, epsExclusionReason: "ineligible" },
    });
    expect(pf.employerEPS).toBe(0);
    expect(pf.employerEPF).toBe(2080);
    expect(pf.warnings).toEqual([]);
    expect(computePF({ ...base, pfDetails: { isEpsMember: false } }).warnings[0]).toContain(
      "Review EPS exclusion",
    );
  });

  it("protects the revised statutory minimum from a saved 1800 employee cap", () => {
    const orgOverrides = { pfMaxEmployeeContribution: 1800 };
    expect(computePF({ ...base, basicSalary: 40000, orgOverrides }).employeeEPF).toBe(2360);
    expect(computePF({ ...base, month: 10, basicSalary: 40000, orgOverrides }).employeeEPF).toBe(
      3000,
    );
    expect(computePF({ ...base, month: 8, basicSalary: 40000, orgOverrides }).employeeEPF).toBe(
      1800,
    );
  });

  it("uses dated earned wages for LOP without additionally shrinking the ceiling", () => {
    const pf = computePF({
      ...base,
      monthlyWages: 40000,
      wagePeriods: [
        { startDate: "2026-09-01", endDate: "2026-09-16", wages: 5000 },
        { startDate: "2026-09-17", endDate: "2026-09-30", wages: 18000 },
      ],
    });
    expect(pf.pfWages).toBe(16666.67);
    expect(pf.employeeEPF).toBe(2000);
    expect(
      computePF({ ...base, month: 10, basicSalary: 16000, monthlyWages: 40000 }).employeeEPF,
    ).toBe(1920);
  });

  it("does not prorate already-earned joiner wages a second time", () => {
    const pf = computePF({
      ...base,
      basicSalary: 6000,
      monthlyWages: 18000,
      dateOfJoining: "2026-09-21",
      pfDetails: { pfMembershipDate: "2026-09-21", epsMembershipDate: "2026-09-21" },
      wagePeriods: [{ startDate: "2026-09-21", endDate: "2026-09-30", wages: 6000 }],
    });
    expect(pf.pfWages).toBe(6000);
    expect(pf.employeeEPF).toBe(720);
    expect(pf.employerEPS).toBe(500);
  });

  it("honors membership and exit dates without charging uncovered periods", () => {
    const pf = computePF({
      ...base,
      basicSalary: 10000,
      monthlyWages: 20000,
      dateOfExit: "2026-09-15",
      pfDetails: { isOptedOut: true, exclusionReason: "wage_ceiling", membershipWages: 20000 },
    });
    expect(pf.employeeEPF).toBe(0);
    expect(pf.isCovered).toBe(false);
  });

  it("supports notified 10% establishments and rejects silently underfunded rates", () => {
    const pf = computePF({
      ...base,
      month: 10,
      basicSalary: 25000,
      contributionRate: 10,
      employerContributionRate: 10,
    });
    expect(pf.employeeEPF).toBe(2500);
    expect(pf.employerEPS).toBe(2083);
    expect(pf.employerEPF).toBe(417);
    expect(pf.warnings).toEqual([]);
    const invalid = computePF({ ...base, month: 10, contributionRate: 6 });
    expect(invalid.employeeEPF).toBe(2400);
    expect(invalid.warnings[0]).toContain("Review PF contribution rates");
  });

  it("includes retaining allowance and keeps employer contributions separate from VPF", () => {
    const pf = computePF({
      ...base,
      month: 10,
      basicSalary: 15000,
      daAmount: 3000,
      retainingAllowance: 2000,
      isVoluntaryPF: true,
      vpfRate: 5,
    });
    expect(pf.pfWages).toBe(20000);
    expect(pf.employeeVPF).toBe(1000);
    expect(pf.employerEPF + pf.employerEPS).toBe(2400);
  });

  it("retains independent charge toggles and half-rupee rounding", () => {
    const pf = computePF({
      ...base,
      month: 10,
      basicSalary: 15000,
      orgOverrides: { pfEdliEnabled: false, pfAdminEnabled: false },
    });
    expect(pf.employerEPS).toBe(1250);
    expect(pf.edliCharges).toBe(0);
    expect(pf.adminCharges).toBe(0);
    expect(pf.adminChargesEnabled).toBe(false);
  });

  it("extends only September's ECR and payment deadline", () => {
    expect(getIndiaPFDueDate(2026, 9)).toBe("2026-10-31");
    expect(getIndiaPFDueDate(2026, 10)).toBe("2026-11-15");
    expect(getIndiaPFDueDate(2026, 12)).toBe("2027-01-15");
  });

  it("rejects invalid periods and nonfinite money before calculating", () => {
    expect(() => computePF({ ...base, basicSalary: NaN })).toThrow("nonnegative");
    expect(() => computePF({ ...base, pfDetails: { pfMembershipDate: "2026-02-30" } })).toThrow(
      "Invalid PF date",
    );
    expect(() =>
      computePF({
        ...base,
        wagePeriods: [
          { startDate: "2026-09-01", endDate: "2026-09-17", wages: 10000 },
          { startDate: "2026-09-17", endDate: "2026-09-30", wages: 10000 },
        ],
      }),
    ).toThrow("must not overlap");
  });
});

describe("computeESI", () => {
  const base = { employeeId: "emp-1", month: 3, year: 2026 };

  it("should compute ESI when gross <= 21000", () => {
    const result = computeESI({ ...base, grossSalary: 20000 });
    expect(result).not.toBeNull();
    expect(result!.employeeContribution).toBe(150); // 0.75% of 20000
    expect(result!.employerContribution).toBe(650); // 3.25% of 20000
  });

  it("should return null when gross > 21000", () => {
    const result = computeESI({ ...base, grossSalary: 25000 });
    expect(result).toBeNull();
  });

  it("should return null at exactly 21001", () => {
    const result = computeESI({ ...base, grossSalary: 21001 });
    expect(result).toBeNull();
  });

  it("should compute ESI at exactly the ceiling (21000)", () => {
    const result = computeESI({ ...base, grossSalary: 21000 });
    expect(result).not.toBeNull();
    expect(result!.employeeContribution).toBe(Math.round((21000 * 0.75) / 100)); // 158
    expect(result!.employerContribution).toBe(Math.round((21000 * 3.25) / 100)); // 683
  });

  it("should compute total = employee + employer", () => {
    const result = computeESI({ ...base, grossSalary: 20000 });
    expect(result!.total).toBe(result!.employeeContribution + result!.employerContribution);
  });

  it("should set esiWages to grossSalary", () => {
    const result = computeESI({ ...base, grossSalary: 18000 });
    expect(result!.esiWages).toBe(18000);
  });

  it("should handle low gross salary", () => {
    const result = computeESI({ ...base, grossSalary: 5000 });
    expect(result).not.toBeNull();
    expect(result!.employeeContribution).toBe(Math.round((5000 * 0.75) / 100)); // 38
    expect(result!.employerContribution).toBe(Math.round((5000 * 3.25) / 100)); // 163
  });
});

// =============================================================================
// PROFESSIONAL TAX (PT)
// =============================================================================

describe("computeProfessionalTax", () => {
  const base = { employeeId: "emp-1", month: 3, year: 2026 };

  // Karnataka
  it("should return 0 for Karnataka when gross <= 15000", () => {
    const result = computeProfessionalTax({ ...base, state: "KA", grossSalary: 15000 });
    expect(result.taxAmount).toBe(0);
  });

  it("should return 200 for Karnataka when gross > 15000", () => {
    const result = computeProfessionalTax({ ...base, state: "KA", grossSalary: 50000 });
    expect(result.taxAmount).toBe(200);
  });

  // Maharashtra
  it("should return 0 for Maharashtra when gross <= 7500", () => {
    const result = computeProfessionalTax({ ...base, state: "MH", grossSalary: 7500 });
    expect(result.taxAmount).toBe(0);
  });

  it("should return 175 for Maharashtra when gross 7501-10000", () => {
    const result = computeProfessionalTax({ ...base, state: "MH", grossSalary: 9000 });
    expect(result.taxAmount).toBe(175);
  });

  it("should return 200 for Maharashtra when gross > 10000 (non-Feb)", () => {
    const result = computeProfessionalTax({ ...base, month: 6, state: "MH", grossSalary: 30000 });
    expect(result.taxAmount).toBe(200);
  });

  it("should return 300 for Maharashtra in February when gross > 10000", () => {
    const result = computeProfessionalTax({ ...base, month: 2, state: "MH", grossSalary: 30000 });
    expect(result.taxAmount).toBe(300);
  });

  // Tamil Nadu
  it("should return 0 for Tamil Nadu when gross <= 21000", () => {
    const result = computeProfessionalTax({ ...base, state: "TN", grossSalary: 21000 });
    expect(result.taxAmount).toBe(0);
  });

  it("should return 1095 for Tamil Nadu when gross > 75000", () => {
    const result = computeProfessionalTax({ ...base, state: "TN", grossSalary: 100000 });
    expect(result.taxAmount).toBe(1095);
  });

  // Delhi (no PT)
  it("should return 0 for Delhi (no PT)", () => {
    const result = computeProfessionalTax({ ...base, state: "DL", grossSalary: 100000 });
    expect(result.taxAmount).toBe(0);
  });

  // Unknown state
  it("should return 0 for unknown state", () => {
    const result = computeProfessionalTax({ ...base, state: "XX", grossSalary: 100000 });
    expect(result.taxAmount).toBe(0);
  });

  // Case insensitivity
  it("should handle lowercase state codes", () => {
    const result = computeProfessionalTax({ ...base, state: "ka", grossSalary: 50000 });
    expect(result.taxAmount).toBe(200);
  });

  it("should pass through employeeId, month, year, state, grossSalary", () => {
    const result = computeProfessionalTax({
      employeeId: "abc",
      month: 5,
      year: 2025,
      state: "KA",
      grossSalary: 30000,
    });
    expect(result.employeeId).toBe("abc");
    expect(result.month).toBe(5);
    expect(result.year).toBe(2025);
    expect(result.state).toBe("KA");
    expect(result.grossSalary).toBe(30000);
  });
});
