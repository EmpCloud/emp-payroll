import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IDBAdapter } from "../db/adapters/interface";

vi.mock("../db/empcloud", () => ({
  findUserById: vi.fn(),
  findEmployeeProfileByUserId: vi.fn(),
}));

import { findEmployeeProfileByUserId, findUserById } from "../db/empcloud";
import { generatePFECRFile } from "./pf-ecr.service";

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    employeeId: "101",
    month: 9,
    year: 2026,
    pfWages: 17333.333333333332,
    epsWages: 17333.333333333332,
    edliWages: 17333.333333333332,
    employeeEPF: 2080,
    employeeVPF: 0,
    totalEmployee: 2080,
    employerEPF: 636,
    employerEPS: 1444,
    adminCharges: 87,
    edliCharges: 87,
    totalEmployer: 2254,
    isCovered: true,
    isEpsMember: true,
    wageCeiling: 25000,
    periods: [],
    ...overrides,
  };
}

describe("PF ECR from recorded payroll", () => {
  let db: IDBAdapter;
  let findOne: ReturnType<typeof vi.fn>;
  let findMany: ReturnType<typeof vi.fn>;
  let run: Record<string, any>;
  let payslip: Record<string, any>;
  let profile: Record<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();
    run = { id: "run-1", empcloud_org_id: 1, org_id: "legacy-org", month: 9, year: 2026 };
    payslip = {
      employee_id: "random-legacy-uuid",
      empcloud_user_id: 101,
      month: 9,
      year: 2026,
      gross_earnings: 30000,
      paid_days: 30,
      total_days: 30,
      lop_days: 0,
      pf_contribution: snapshot(),
    };
    profile = { tax_info: { uan: "100123456789" }, pf_details: {} };
    findOne = vi.fn(async (table: string) => {
      if (table === "payroll_runs") return run;
      if (table === "employee_payroll_profiles") return profile;
      return null;
    });
    findMany = vi.fn(async () => ({ data: [payslip] }));
    db = { findOne, findMany } as unknown as IDBAdapter;
    vi.mocked(findUserById).mockResolvedValue({
      id: 101,
      organization_id: 1,
      first_name: "Rahul",
      last_name: "Kumar",
    } as any);
    vi.mocked(findEmployeeProfileByUserId).mockResolvedValue(null);
  });

  it("exports September as one 11-column row using stored wages and amounts", async () => {
    payslip.pf_contribution = JSON.stringify(payslip.pf_contribution);
    const file = await generatePFECRFile(db, "run-1", "1");
    expect(file.content).toBe(
      "100123456789#~#RAHUL KUMAR#~#30000#~#17333#~#17333#~#17333#~#2080#~#1444#~#636#~#0#~#0",
    );
    expect(file.content.split("\n")).toHaveLength(1);
    expect(file.filename).toBe("PF-ECR-SEP-2026.txt");
    expect(file.dueDate).toBe("2026-10-31");
    expect(file.summary).toEqual({
      employeeCount: 1,
      employeeContributions: 2080,
      employerEPF: 636,
      employerEPS: 1444,
      adminCharges: 87,
      adminChargesDue: 500,
      edliCharges: 87,
    });
    expect(findOne).toHaveBeenCalledWith("payroll_runs", { id: "run-1", empcloud_org_id: 1 });
    expect(findOne).toHaveBeenCalledWith("employee_payroll_profiles", {
      empcloud_user_id: 101,
      empcloud_org_id: 1,
    });
    expect(findOne.mock.calls.some(([table]) => table === "employee_salaries")).toBe(false);
  });

  it("does not recalculate a historical paid payroll from the employee's current settings", async () => {
    run.month = 8;
    run.status = "paid";
    payslip.month = 8;
    payslip.pf_contribution = snapshot({
      month: 8,
      pfWages: 15000,
      epsWages: 15000,
      edliWages: 15000,
      employeeEPF: 1800,
      totalEmployee: 1800,
      employerEPS: 1250,
      employerEPF: 550,
    });
    profile.pf_details = { isOptedOut: true, contributionRate: 10 };
    const file = await generatePFECRFile(db, "run-1", "1");
    expect(file.content.split("#~#").slice(3, 9)).toEqual([
      "15000",
      "15000",
      "15000",
      "1800",
      "1250",
      "550",
    ]);
    expect(file.dueDate).toBe("2026-09-15");
  });

  it("applies administration minimums once per establishment while honoring exemption", async () => {
    payslip.pf_contribution = snapshot({ adminChargesEnabled: true, adminCharges: 900 });
    expect((await generatePFECRFile(db, "run-1", "1")).summary.adminChargesDue).toBe(900);
    payslip.pf_contribution = snapshot({ adminChargesEnabled: false, adminCharges: 0 });
    expect((await generatePFECRFile(db, "run-1", "1")).summary.adminChargesDue).toBe(0);
    payslip.pf_contribution = snapshot({
      isCovered: false,
      adminChargesEnabled: true,
      adminCharges: 0,
    });
    expect((await generatePFECRFile(db, "run-1", "1")).summary.adminChargesDue).toBe(75);
  });

  it("keeps uncapped EPF, capped EDLI and zero EPS distinct, and includes VPF", async () => {
    payslip.pf_contribution = snapshot({
      pfWages: 40000,
      epsWages: 0,
      edliWages: 25000,
      employeeEPF: 4800,
      employeeVPF: 800,
      totalEmployee: 5600,
      employerEPS: 0,
      employerEPF: 4800,
      isEpsMember: false,
    });
    payslip.lop_days = 3;
    const file = await generatePFECRFile(db, "run-1", "1");
    expect(file.content.split("#~#").slice(3)).toEqual([
      "40000",
      "0",
      "25000",
      "5600",
      "0",
      "4800",
      "3",
      "0",
    ]);
  });

  it("uses recorded covered-period NCP days for newly enrolled employees", async () => {
    payslip.lop_days = 5;
    payslip.pf_contribution = snapshot({ ncpDays: 1 });
    const file = await generatePFECRFile(db, "run-1", "1");
    expect(file.content.split("#~#")[9]).toBe("1");
  });

  it("requires review of fractional NCP days instead of silently rounding", async () => {
    payslip.lop_days = 0.5;
    await expect(generatePFECRFile(db, "run-1", "1")).rejects.toMatchObject({
      code: "PF_NCP_DAYS_INVALID",
      message: expect.stringContaining("EPFO ECR requires whole non-contributing days"),
    });
  });

  it("uses captured ECR gross wages without expense reimbursements", async () => {
    payslip.gross_earnings = 30250;
    payslip.earnings = [
      { code: "BASIC", amount: 30000 },
      { code: "REIMB", amount: 250 },
    ];
    payslip.pf_contribution = snapshot({ grossWages: 30000 });
    const file = await generatePFECRFile(db, "run-1", "1");
    expect(file.content.split("#~#")[2]).toBe("30000");
  });

  it("skips recorded excluded employees without reading their current identity", async () => {
    payslip.pf_contribution = snapshot({ isCovered: false });
    expect((await generatePFECRFile(db, "run-1", "1")).content).toBe("");
    expect(findUserById).not.toHaveBeenCalled();
  });

  it("finds UAN in PF details and then EmpCloud statutory details", async () => {
    profile = { tax_info: {}, pf_details: JSON.stringify({ uan: "100123456789" }) };
    expect((await generatePFECRFile(db, "run-1", "1")).content).toMatch(/^100123456789/);
    profile.pf_details = {};
    vi.mocked(findEmployeeProfileByUserId).mockResolvedValue({ uan_number: "100987654321" } as any);
    expect((await generatePFECRFile(db, "run-1", "1")).content).toMatch(/^100987654321/);
  });

  it("rejects missing and malformed UAN instead of silently dropping a contribution", async () => {
    profile.tax_info = {};
    await expect(generatePFECRFile(db, "run-1", "1")).rejects.toMatchObject({
      code: "PF_UAN_INVALID",
    });
    profile.tax_info = { uan: "123" };
    await expect(generatePFECRFile(db, "run-1", "1")).rejects.toMatchObject({
      code: "PF_UAN_INVALID",
    });
  });

  it("does not produce two rows against the same UAN", async () => {
    findMany.mockResolvedValue({ data: [payslip, payslip] });
    await expect(generatePFECRFile(db, "run-1", "1")).rejects.toMatchObject({
      code: "PF_UAN_DUPLICATE",
    });
  });

  it("requires a snapshot for historical payroll and never guesses from gross", async () => {
    payslip.pf_contribution = null;
    await expect(generatePFECRFile(db, "run-1", "1")).rejects.toMatchObject({
      code: "PF_SNAPSHOT_MISSING",
    });
    expect(findUserById).not.toHaveBeenCalled();
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it.each([
    { employeeId: "other" },
    { month: 8 },
    { totalEmployee: 1 },
    { pfWages: -1 },
    { employerEPS: "1444" },
  ])("rejects corrupt snapshot data: %j", async (change) => {
    payslip.pf_contribution = snapshot(change);
    await expect(generatePFECRFile(db, "run-1", "1")).rejects.toMatchObject({
      code: "PF_SNAPSHOT_INVALID",
    });
  });

  it("does not disclose an employee from another organization", async () => {
    vi.mocked(findUserById).mockResolvedValue({ id: 101, organization_id: 2 } as any);
    await expect(generatePFECRFile(db, "run-1", "1")).rejects.toMatchObject({
      code: "PF_EMPLOYEE_MISSING",
    });
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it("supports historical legacy identities only within the run's organization", async () => {
    delete payslip.empcloud_user_id;
    payslip.employee_id = "legacy-employee";
    payslip.pf_contribution = snapshot({ employeeId: "legacy-employee" });
    findOne.mockImplementation(async (table: string) =>
      table === "payroll_runs"
        ? run
        : { first_name: "Legacy", last_name: "Employee", tax_info: { uan: "100123456789" } },
    );
    expect((await generatePFECRFile(db, "run-1", "1")).content).toContain("LEGACY EMPLOYEE");
    expect(findOne).toHaveBeenCalledWith("employees", {
      id: "legacy-employee",
      org_id: "legacy-org",
    });
    expect(findUserById).not.toHaveBeenCalled();
  });

  it("returns 404 for a run outside the requested organization", async () => {
    findOne.mockResolvedValue(null);
    await expect(generatePFECRFile(db, "run-1", "2")).rejects.toMatchObject({ statusCode: 404 });
    expect(findMany).not.toHaveBeenCalled();
  });
});
