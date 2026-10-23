import { describe, expect, it, vi } from "vitest";
vi.mock("../../utils/logger", () => ({ logger: { error: vi.fn() } }));
import { computePayrollPF, monthlyPFWages } from "./payroll-pf";

const component = (code: string, monthlyAmount: number, type = "earning") => ({
  code,
  monthlyAmount,
  type,
});
const base = {
  employeeId: "emp-1",
  month: 9,
  year: 2026,
  components: [component("BASIC", 20000)],
  earnings: [{ code: "BASIC", amount: 20000 }],
  pfDetails: {},
  orgOverrides: {},
  hasDatedAttendance: false,
  lopByDate: new Map<string, number>(),
  unpaidDays: 0,
};

describe("payroll PF wages and existing arrangements", () => {
  it("includes basic, DA and retaining allowance aliases once", () => {
    expect(
      monthlyPFWages([
        component("BASIC", 12000),
        component("DEARNESS_ALLOWANCE", 4000),
        component("RETAINING_ALLOWANCE", 3000),
        component("HRA", 10000),
        component("PF_EE", 1800, "deduction"),
      ]),
    ).toBe(19000);
  });

  it("requires dated LOP at the September change rather than inventing a split", () => {
    expect(() => computePayrollPF({ ...base, unpaidDays: 2 })).toThrow("dated attendance");
    const old = computePayrollPF({
      ...base,
      month: 8,
      unpaidDays: 2,
      earnings: [{ code: "BASIC", amount: 12000 }],
    });
    expect(old.employeeEPF).toBe(1440);
  });

  it("allocates LOP by date and applies each calendar window ceiling only once", () => {
    const before = computePayrollPF({
      ...base,
      hasDatedAttendance: true,
      unpaidDays: 2,
      lopByDate: new Map([
        ["2026-09-01", 1],
        ["2026-09-02", 1],
      ]),
    });
    const after = computePayrollPF({
      ...base,
      hasDatedAttendance: true,
      unpaidDays: 2,
      lopByDate: new Map([
        ["2026-09-29", 1],
        ["2026-09-30", 1],
      ]),
    });
    expect(before.employeeEPF).toBe(2080);
    expect(after.employeeEPF).toBe(1920);
    expect(before.ncpDays).toBe(2);
  });

  it("excludes pre-membership absence from contributions and ECR NCP", () => {
    const pf = computePayrollPF({
      ...base,
      pfDetails: { isOptedOut: true, exclusionReason: "wage_ceiling", membershipWages: 20000 },
      hasDatedAttendance: true,
      unpaidDays: 2,
      lopByDate: new Map([
        ["2026-09-02", 1],
        ["2026-09-20", 1],
      ]),
    });
    expect(pf.employeeEPF).toBe(1040);
    expect(pf.ncpDays).toBe(1);
  });

  it("blocks an unreviewed ceiling exclusion and keeps reviewed membership after a salary rise", () => {
    expect(() =>
      computePayrollPF({ ...base, pfDetails: { exclusionReason: "wage_ceiling" } }),
    ).toThrow("record statutory monthly wages");
    const pf = computePayrollPF({
      ...base,
      month: 10,
      components: [component("BASIC", 30000)],
      earnings: [{ code: "BASIC", amount: 30000 }],
      pfDetails: { exclusionReason: "wage_ceiling", membershipWages: 20000 },
    });
    expect(pf.employeeEPF).toBe(3000);
    expect(pf.isEpsMember).toBe(true);
  });

  it("normalizes timestamp join dates and uses already-earned wages exactly once", () => {
    const pf = computePayrollPF({
      ...base,
      dateOfJoining: "2026-09-21T00:00:00.000Z",
      earnings: [{ code: "BASIC", amount: 6666.67 }],
    });
    expect(pf.employeeEPF).toBe(800);
    expect(pf.periods[0].pfWages).toBe(0);
  });

  it("uses dated membership start within a full wage month", () => {
    const pf = computePayrollPF({
      ...base,
      month: 10,
      pfDetails: { pfMembershipDate: "2026-10-17" },
    });
    expect(pf.pfWages).toBe(9677.42);
    expect(pf.employeeEPF).toBe(1161);
    expect(() =>
      computePayrollPF({
        ...base,
        month: 10,
        unpaidDays: 1,
        pfDetails: { pfMembershipDate: "2026-10-17" },
      }),
    ).toThrow("dated attendance");
  });

  it("preserves a template VPF deduction when the legacy profile did not store a rate", () => {
    const pf = computePayrollPF({
      ...base,
      month: 10,
      components: [...base.components, component("VPF", 1000, "deduction")],
      pfDetails: { isVoluntaryPF: false },
    });
    expect(pf.employeeVPF).toBe(1000);
    expect(pf.totalEmployee).toBe(3400);
  });

  it("gives an explicit VPF rate, including zero, priority over a template", () => {
    const input = {
      ...base,
      month: 10,
      components: [...base.components, component("VPF", 1000, "deduction")],
    };
    expect(computePayrollPF({ ...input, pfDetails: { vpfRate: 2 } }).employeeVPF).toBe(400);
    expect(computePayrollPF({ ...input, pfDetails: { vpfRate: 0 } }).employeeVPF).toBe(0);
  });

  it("requires review rather than silently reducing a higher PF template deduction", () => {
    const input = {
      ...base,
      month: 10,
      components: [component("BASIC", 40000), component("PF_EE", 4800, "deduction")],
      earnings: [{ code: "BASIC", amount: 40000 }],
    };
    expect(() => computePayrollPF(input)).toThrow("higher PF deduction");
    expect(
      computePayrollPF({ ...input, orgOverrides: { pfApplyFullBasic: true } }).employeeEPF,
    ).toBe(4800);
  });

  it("uses supplied earned deduction amounts when checking an existing template", () => {
    expect(() =>
      computePayrollPF({
        ...base,
        month: 10,
        templateDeductions: [{ code: "PF_EE", amount: 3000 }],
      }),
    ).toThrow("higher PF deduction");
  });

  it("does not mistake an old statutory cap or an excluded employee template for a higher-wage agreement", () => {
    const components = [...base.components, component("PF_EE", 1800, "deduction")];
    expect(computePayrollPF({ ...base, month: 10, components }).employeeEPF).toBe(2400);
    expect(
      computePayrollPF({
        ...base,
        components,
        pfDetails: { isOptedOut: true, exclusionReason: "wage_ceiling", membershipWages: 20000 },
      }).employeeEPF,
    ).toBe(1120);
  });

  it("keeps fractional NCP for explicit export review and rejects impossible attendance", () => {
    const pf = computePayrollPF({
      ...base,
      hasDatedAttendance: true,
      unpaidDays: 0.5,
      lopByDate: new Map([["2026-09-20", 0.5]]),
    });
    expect(pf.ncpDays).toBe(0.5);
    expect(() =>
      computePayrollPF({
        ...base,
        hasDatedAttendance: true,
        unpaidDays: 2,
        lopByDate: new Map([["2026-09-20", 2]]),
      }),
    ).toThrow("valid calendar-day fractions");
  });
});
