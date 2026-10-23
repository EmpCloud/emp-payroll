import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/adapters", () => ({ getDB: vi.fn() }));
vi.mock("../db/empcloud", () => ({
  findUsersByOrgId: vi.fn(),
  findOrgById: vi.fn(),
  getEmpCloudDB: vi.fn(),
  findEmployeeProfileByUserId: vi.fn().mockResolvedValue(null),
}));
vi.mock("../db/empexit", () => ({
  findEffectiveExitsForUsers: vi.fn().mockResolvedValue(new Map()),
  isEmpExitEnabled: vi.fn(() => false),
}));
vi.mock("../config", () => ({ config: { cloudHrms: { enabled: false } } }));
vi.mock("./cloud-hrms.service", () => ({
  getMonthlyAttendance: vi.fn(),
  toLocalAttendanceFormat: vi.fn(),
}));

import { getDB } from "../db/adapters";
import { findUsersByOrgId, getEmpCloudDB } from "../db/empcloud";
import { PayrollService } from "./payroll.service";
import { makePayrollFixture } from "./test-utils/payroll-fixture";
import * as indiaTax from "./tax/india-tax.service";

describe("Payroll computation with the real effective-dated PF engine", () => {
  let fixture: ReturnType<typeof makePayrollFixture>;
  let service: PayrollService;
  let restoreTaxSpy: (() => void) | undefined;

  function setup(options: Parameters<typeof makePayrollFixture>[0] = {}) {
    fixture = makePayrollFixture(options);
    for (const profile of Object.values(fixture.profiles)) {
      profile.tax_info = { deductPT: false, deductTDS: false };
    }
    vi.mocked(getDB).mockReturnValue(fixture.db as any);
    vi.mocked(findUsersByOrgId).mockResolvedValue(fixture.employees as any);
    vi.mocked(getEmpCloudDB).mockReturnValue(fixture.empcloudDb);
    service = new PayrollService();
  }

  function payslips() {
    return fixture.db.create.mock.calls
      .filter(([table]) => table === "payslips")
      .map(([, data]) => data);
  }

  function expectNoWrites() {
    expect(fixture.db.create).not.toHaveBeenCalled();
    expect(fixture.db.update).not.toHaveBeenCalled();
    expect(fixture.db.updateMany).not.toHaveBeenCalled();
    expect(fixture.db.deleteMany).not.toHaveBeenCalled();
    expect(fixture.externalWrites).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
    setup();
  });
  afterEach(() => {
    vi.useRealTimers();
    restoreTaxSpy?.();
    restoreTaxSpy = undefined;
  });

  it("replaces a template's old 1800 PF with October 3000 and records the employer split", async () => {
    fixture.salaries[100].structure_id = "standard";
    fixture.templates.standard = [
      { code: "BASIC", type: "earning", calculation_type: "fixed", value: 25000 },
      { code: "HRA", type: "earning", calculation_type: "fixed", value: 12500 },
      { code: "SPECIAL", type: "earning", calculation_type: "fixed", value: 12500 },
      { code: "EEPF D", type: "deduction", calculation_type: "fixed", value: 1800 },
    ];
    await service.computePayroll("run-1", "1");
    const [payslip] = payslips();
    const deductions = JSON.parse(payslip.deductions);
    expect(deductions.filter((line: any) => line.code.includes("PF"))).toEqual([
      { code: "EEPF D", name: "Employee PF", amount: 3000 },
    ]);
    expect(JSON.parse(payslip.employer_contributions)).toEqual(
      expect.arrayContaining([
        { code: "EMP_EPS", name: "Employer EPS", amount: 2083 },
        { code: "EMP_EPF", name: "Employer EPF", amount: 917 },
      ]),
    );
    expect(JSON.parse(payslip.pf_contribution)).toMatchObject({
      employeeId: "100",
      month: 10,
      year: 2026,
      pfWages: 25000,
      epsWages: 25000,
      edliWages: 25000,
      employeeEPF: 3000,
      employerEPS: 2083,
      employerEPF: 917,
      totalEmployer: 3250,
      ncpDays: 0,
    });
    expect(payslip.total_deductions).toBe(3000);
    expect(payslip.net_pay).toBe(47000);
    expect(payslip.total_employer_cost).toBe(53250);
  });

  it("adds voluntary PF once and persists it in the snapshot and net pay", async () => {
    fixture.profiles[100].pf_details = {
      isEnrolled: true,
      isEpsMember: true,
      isVoluntaryPF: true,
      vpfRate: 2,
    };
    fixture.salaries[100].components.push({ code: "VPF", type: "deduction", monthlyAmount: 200 });
    await service.computePayroll("run-1", "1");
    const [payslip] = payslips();
    expect(JSON.parse(payslip.deductions).filter((line: any) => line.code === "VPF")).toEqual([
      { code: "VPF", name: "Voluntary PF", amount: 500 },
    ]);
    expect(JSON.parse(payslip.pf_contribution)).toMatchObject({
      employeeEPF: 3000,
      employeeVPF: 500,
      totalEmployee: 3500,
    });
    expect(payslip.total_deductions).toBe(3500);
    expect(payslip.net_pay).toBe(46500);
  });

  it.each([
    { vpfRate: 0, previousVpf: 0, expectedAnnualPf: 29360 },
    { vpfRate: 2, previousVpf: 400, expectedAnnualPf: 34860 },
  ])(
    "projects TDS from actual YTD plus effective-dated PF and VPF: %j",
    async ({ vpfRate, previousVpf, expectedAnnualPf }) => {
      setup({ month: 9 });
      const taxSpy = vi.spyOn(indiaTax, "computeIncomeTax");
      restoreTaxSpy = () => taxSpy.mockRestore();
      fixture.profiles[100].tax_info = { pan: "ABCDE1234F", regime: "old", deductPT: false };
      fixture.profiles[100].pf_details = {
        isEnrolled: true,
        isEpsMember: true,
        isVoluntaryPF: vpfRate > 0,
        vpfRate,
      };
      fixture.priorPayslips[100] = [4, 5, 6, 7, 8].map((month) => ({
        payroll_run_id: `prior-${month}`,
        year: 2026,
        month,
        gross_earnings: 50000,
        deductions: JSON.stringify([
          { code: "EEPF D", amount: 1800 },
          { code: "VPF", amount: previousVpf },
          { code: "TDS", amount: 100 },
        ]),
      }));
      fixture.priorPayslips[100].push({
        payroll_run_id: "future-run",
        year: 2026,
        month: 11,
        gross_earnings: 999999,
        deductions: [
          { code: "EPF", amount: 99999 },
          { code: "VPF", amount: 99999 },
          { code: "TDS", amount: 99999 },
        ],
      });
      await service.computePayroll("run-1", "1");
      expect(taxSpy).toHaveBeenCalledOnce();
      expect(taxSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          employeePfAnnual: expectedAnnualPf,
          annualGross: 600000,
          taxAlreadyPaid: 500,
        }),
      );
      const [payslip] = payslips();
      expect(JSON.parse(payslip.pf_contribution)).toMatchObject({
        employeeEPF: 2360,
        employeeVPF: vpfRate ? 500 : 0,
      });
      const tds = JSON.parse(payslip.deductions).find((line: any) => line.code === "TDS");
      expect(tds?.amount ?? 0).toBe(taxSpy.mock.results[0].value.monthlyTds);
    },
  );

  it("allocates September unpaid days to their dates and excludes pre-enrolment days from NCP", async () => {
    setup({ month: 9 });
    fixture.profiles[100].pf_details = {
      isOptedOut: true,
      exclusionReason: "wage_ceiling",
      membershipWages: 20000,
      isEpsMember: false,
      epsExclusionReason: "wage_ceiling",
    };
    fixture.salaries[100].gross_salary = 480000;
    fixture.salaries[100].components = [
      { code: "BASIC", type: "earning", monthlyAmount: 20000 },
      { code: "HRA", type: "earning", monthlyAmount: 10000 },
      { code: "SPECIAL", type: "earning", monthlyAmount: 10000 },
    ];
    for (const day of fixture.attendance[100]) {
      if (["2026-09-10", "2026-09-21"].includes(day.date)) day.status = "absent";
    }
    await service.computePayroll("run-1", "1");
    const [payslip] = payslips();
    const pf = JSON.parse(payslip.pf_contribution);
    expect(payslip.paid_days).toBe(28);
    expect(payslip.lop_days).toBe(2);
    expect(pf).toMatchObject({
      employeeEPF: 1040,
      pfWages: 8666.67,
      ncpDays: 1,
      isCovered: true,
      isEpsMember: true,
    });
    expect(pf.periods).toHaveLength(2);
    expect(pf.periods[0]).toMatchObject({
      startDate: "2026-09-01",
      endDate: "2026-09-16",
      pfWages: 0,
    });
    expect(pf.periods[1]).toMatchObject({
      startDate: "2026-09-17",
      endDate: "2026-09-30",
      pfWages: 8666.67,
    });
  });

  it("keeps a MySQL local-midnight September 17 joining date on September 17 in India", async () => {
    vi.stubEnv("TZ", "Asia/Kolkata");
    try {
      setup({ month: 9 });
      const joiningDate = new Date(2026, 8, 17);
      expect(joiningDate.toISOString()).toBe("2026-09-16T18:30:00.000Z");
      (fixture.employees[0] as any).date_of_joining = joiningDate;
      fixture.salaries[100].gross_salary = 240000;
      fixture.salaries[100].components = [{ code: "BASIC", type: "earning", monthlyAmount: 20000 }];
      await service.computePayroll("run-1", "1");
      const [payslip] = payslips();
      expect(payslip.paid_days).toBe(14);
      expect(JSON.parse(payslip.earnings)).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "BASIC", amount: 9333 })]),
      );
      const pf = JSON.parse(payslip.pf_contribution);
      expect(pf.employeeEPF).toBe(1120);
      expect(pf.periods[0]).toMatchObject({ pfWages: 0, isCovered: false });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    { regime: "new", contributionRate: 6, expectedEmployeePF: 900 },
    { regime: "old", contributionRate: 12, expectedEmployeePF: 1800 },
  ])(
    "keeps June $regime-regime payroll independent of future EPS review",
    async ({ regime, contributionRate, expectedEmployeePF }) => {
      setup({ month: 6 });
      const taxSpy = vi.spyOn(indiaTax, "computeIncomeTax");
      restoreTaxSpy = () => taxSpy.mockRestore();
      fixture.profiles[100].tax_info = { pan: "ABCDE1234F", regime, deductPT: false };
      fixture.profiles[100].pf_details = { isEnrolled: true, isEpsMember: false, contributionRate };
      await service.computePayroll("run-1", "1");
      const [payslip] = payslips();
      expect(JSON.parse(payslip.pf_contribution)).toMatchObject({
        employeeEPF: expectedEmployeePF,
        employerEPS: 0,
      });
      expect(fixture.run.status).toBe("computed");
      if (regime === "old") {
        expect(taxSpy).toHaveBeenCalledWith(expect.objectContaining({ employeePfAnnual: 25760 }));
      }
    },
  );

  it("keeps ineligible EPS membership out of pension contributions", async () => {
    fixture.profiles[100].pf_details = {
      isEnrolled: true,
      isEpsMember: false,
      epsExclusionReason: "ineligible",
    };
    await service.computePayroll("run-1", "1");
    const [payslip] = payslips();
    expect(JSON.parse(payslip.pf_contribution)).toMatchObject({
      epsWages: 0,
      employerEPS: 0,
      employerEPF: 3000,
      isEpsMember: false,
    });
    expect(
      JSON.parse(payslip.employer_contributions).some((line: any) => line.code === "EMP_EPS"),
    ).toBe(false);
  });

  it("keeps a full unpaid month in ECR without tax or loan deductions", async () => {
    const taxSpy = vi.spyOn(indiaTax, "computeIncomeTax");
    restoreTaxSpy = () => taxSpy.mockRestore();
    fixture.profiles[100].tax_info = { pan: "ABCDE1234F", regime: "old" };
    for (const day of fixture.attendance[100]) day.status = "absent";
    fixture.loans[100] = [
      {
        id: "loan-1",
        status: "active",
        emi_amount: 500,
        outstanding_amount: 1000,
        installments_paid: 0,
      },
    ];
    await service.computePayroll("run-1", "1");
    const [payslip] = payslips();
    expect(payslip).toMatchObject({ gross_earnings: 0, net_pay: 0, paid_days: 0, lop_days: 31 });
    expect(JSON.parse(payslip.pf_contribution)).toMatchObject({
      pfWages: 0,
      employeeEPF: 0,
      employerEPF: 0,
      employerEPS: 0,
      totalEmployer: 0,
      ncpDays: 31,
      isCovered: true,
      grossWages: 0,
    });
    expect(
      JSON.parse(payslip.deductions).some((line: any) => ["TDS", "PT", "LOAN"].includes(line.code)),
    ).toBe(false);
    expect(taxSpy).not.toHaveBeenCalled();
    expect(fixture.db.update.mock.calls.some(([table]) => table === "loans")).toBe(false);
  });

  it("records only 14 NCP days for a newly enrolled member's full unpaid September", async () => {
    setup({ month: 9 });
    fixture.profiles[100].pf_details = {
      isOptedOut: true,
      exclusionReason: "wage_ceiling",
      membershipWages: 25000,
      isEpsMember: false,
      epsExclusionReason: "wage_ceiling",
    };
    for (const day of fixture.attendance[100]) day.status = "absent";
    await service.computePayroll("run-1", "1");
    const [payslip] = payslips();
    expect(JSON.parse(payslip.pf_contribution)).toMatchObject({
      ncpDays: 14,
      employeeEPF: 0,
      employerEPS: 0,
      isCovered: true,
    });
    expect(payslip.net_pay).toBe(0);
  });

  it("stores ECR gross before reimbursement while paying the reimbursement in net salary", async () => {
    fixture.reimbursements[100] = [{ id: "reimb-1", status: "approved", amount: 250 }];
    await service.computePayroll("run-1", "1");
    const [payslip] = payslips();
    expect(payslip.gross_earnings).toBe(50250);
    expect(payslip.net_pay).toBe(47250);
    expect(JSON.parse(payslip.pf_contribution)).toMatchObject({
      grossWages: 50000,
      employeeEPF: 3000,
    });
  });

  it.each(["computed", "approved", "paid"])(
    "preserves finalized %s payroll without any writes",
    async (status) => {
      fixture.run.status = status;
      await expect(service.computePayroll("run-1", "1")).rejects.toMatchObject({
        code: "INVALID_STATUS",
      });
      expectNoWrites();
    },
  );

  it("does not change any payslip, loan or reimbursement when a later employee needs review", async () => {
    setup({ employeeCount: 2 });
    fixture.loans[100] = [
      {
        id: "loan-1",
        status: "active",
        emi_amount: 500,
        outstanding_amount: 1000,
        installments_paid: 0,
      },
    ];
    fixture.reimbursements[100] = [{ id: "reimb-1", status: "approved", amount: 250 }];
    fixture.profiles[101].pf_details = { isOptedOut: true };
    await expect(service.computePayroll("run-1", "1")).rejects.toMatchObject({
      code: "PF_REVIEW_REQUIRED",
    });
    expect(fixture.db.findMany).toHaveBeenCalledWith(
      "loans",
      expect.objectContaining({ filters: { employee_id: "100", status: "active" } }),
    );
    expectNoWrites();
    expect(fixture.run.status).toBe("draft");
  });

  it("requires dated September absence before touching existing payroll", async () => {
    setup({ month: 9 });
    fixture.attendance[100] = [];
    fixture.summaries[100] = { present_days: 28, absent_days: 2, unpaid_leave: 0 };
    await expect(service.computePayroll("run-1", "1")).rejects.toMatchObject({
      code: "PF_DATED_ATTENDANCE_REQUIRED",
    });
    expectNoWrites();
  });
});
