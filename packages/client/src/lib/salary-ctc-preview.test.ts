import { describe, expect, it } from "vitest";
import { allocateCtcPreview, previewESI } from "./salary-ctc-preview";
import { computePFPreview } from "./pf-preview";

const input = {
  employeeId: "1",
  month: 11,
  year: 2026,
  pfDetails: { isEnrolled: true, isEpsMember: true },
  orgOverrides: { pfEdliEnabled: false, pfAdminEnabled: false },
};
const components = [
  { code: "BASIC", type: "earning", calculationType: "percentage", monthlyAmount: 18000 },
  { code: "HRA", type: "earning", calculationType: "percentage", monthlyAmount: 7200 },
  { code: "SA", type: "earning", calculationType: "percentage", monthlyAmount: 3300 },
  { code: "CA", type: "earning", calculationType: "percentage", monthlyAmount: 1500 },
];

describe("CTC-inclusive salary preview", () => {
  it("shows 64250 gross and 61250 net for annual CTC of 810000", () => {
    const highSalary = components.map((c) => ({ ...c, monthlyAmount: c.monthlyAmount * 2.25 }));
    const context = { ...input, orgOverrides: { pfEdliEnabled: true, pfAdminEnabled: true } };
    const result = allocateCtcPreview(highSalary, 810000 / 12, context, false);
    const pf = computePFPreview({ ...context, components: result.components });
    expect(result.monthlyGross).toBe(64250);
    expect(pf.totalEmployer).toBe(3250);
    expect(result.monthlyGross - pf.totalEmployee).toBe(61250);
    expect((result.monthlyGross + pf.totalEmployer) * 12).toBe(810000);
  });

  it("splits 30,000 into gross and employer PF before calculating employee PF", () => {
    const result = allocateCtcPreview(components, 30000, input, false);
    const pf = computePFPreview({ ...input, components: result.components });
    expect(result.monthlyGross).toBe(27985);
    expect(pf.totalEmployer).toBe(2015);
    expect(result.monthlyGross - pf.totalEmployee).toBe(25970);
    expect(result.monthlyGross + pf.totalEmployer).toBe(30000);
  });

  it("includes eligible ESI in the allocation and net-pay estimate", () => {
    const lowSalary = components.map((c) => ({ ...c, monthlyAmount: c.monthlyAmount / 2 }));
    const result = allocateCtcPreview(lowSalary, 15000, input, true);
    const pf = computePFPreview({ ...input, components: result.components });
    const esi = previewESI(result.monthlyGross, true);
    expect(esi.employee).toBeGreaterThan(0);
    expect(esi.employer).toBeGreaterThan(0);
    expect(result.monthlyGross + pf.totalEmployer + esi.employer).toBe(15000);
  });
});
