import { describe, expect, it } from "vitest";
import { computePFPreview } from "./pf-preview";

const input = {
  employeeId: "12",
  year: 2026,
  month: 9,
  components: [{ code: "BASIC", type: "earning", monthlyAmount: 20000 }],
};

describe("PF salary preview", () => {
  it("uses the September split and preserves the monthly daily rate for a new joiner", () => {
    expect(computePFPreview(input).employeeEPF).toBe(2080);
    expect(
      computePFPreview({ ...input, dateOfJoining: "2026-09-17", pfDetails: { isEpsMember: true } })
        .employeeEPF,
    ).toBe(1120);
  });

  it("includes DA, retaining allowance and template VPF once", () => {
    const result = computePFPreview({
      ...input,
      month: 10,
      components: [
        ...input.components,
        { code: "Dearness_Allowance", type: "earning", monthlyAmount: 2000 },
        { code: "RA", type: "earning", monthlyAmount: 1000 },
        { code: "VPF", type: "deduction", monthlyAmount: 2300 },
      ],
    });
    expect(result.employeeEPF).toBe(2760);
    expect(result.employeeVPF).toBe(2300);
    expect(result.totalEmployee).toBe(5060);
  });

  it("uses an explicit profile VPF rate over the salary template", () => {
    const result = computePFPreview({
      ...input,
      month: 10,
      pfDetails: { vpfRate: 5 },
      components: [...input.components, { code: "VPF", type: "deduction", monthlyAmount: 2000 }],
    });
    expect(result.employeeVPF).toBe(1000);
  });

  it("warns when a template would reduce an existing higher PF contribution", () => {
    const result = computePFPreview({
      ...input,
      month: 10,
      components: [...input.components, { code: "EPF", type: "deduction", monthlyAmount: 3000 }],
    });
    expect(result.warnings.join(" ")).toContain("higher PF deduction");
  });

  it("retains PF and EPS coverage after wages exceed the ceiling following enrollment", () => {
    const result = computePFPreview({
      ...input,
      month: 10,
      components: [{ code: "BASIC", type: "earning", monthlyAmount: 30000 }],
      pfDetails: {
        isOptedOut: true,
        exclusionReason: "wage_ceiling",
        isEpsMember: false,
        epsExclusionReason: "wage_ceiling",
        membershipWages: 20000,
      },
    });
    expect(result.isCovered).toBe(true);
    expect(result.isEpsMember).toBe(true);
    expect(result.employeeEPF).toBe(3000);
    expect(result.employerEPS).toBe(2083);
    expect(result.warnings).toEqual([]);
  });

  it("warns when a wage-ceiling exclusion has no fixed review wages", () => {
    const result = computePFPreview({
      ...input,
      month: 10,
      pfDetails: { isOptedOut: true, exclusionReason: "wage_ceiling" },
    });
    expect(result.warnings.join(" ")).toContain("membership wages");
  });
});
