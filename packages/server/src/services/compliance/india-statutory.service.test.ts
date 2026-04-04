import { describe, it, expect } from "vitest";
import { computePF, computeESI, computeProfessionalTax } from "./india-statutory.service";

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

  it("should compute employer EPF at 3.67%", () => {
    const result = computePF({ ...base, basicSalary: 15000 });
    expect(result.employerEPF).toBe(Math.round((15000 * 3.67) / 100)); // 551
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
