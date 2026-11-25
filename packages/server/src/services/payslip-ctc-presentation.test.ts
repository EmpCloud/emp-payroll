import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ payslip: {} as any, setting: false }));
vi.mock("../db/adapters", () => ({
  getDB: () => ({
    findById: vi.fn(async (table: string) => (table === "payslips" ? fixture.payslip : null)),
    findOne: vi.fn(async (table: string) =>
      table === "organization_payroll_settings"
        ? { name: "Test Company", employer_pf_in_ctc: fixture.setting }
        : { bank_details: {} },
    ),
  }),
}));
vi.mock("../db/empcloud", () => ({
  findUserById: vi.fn(async () => ({
    first_name: "Test",
    last_name: "Employee",
    organization_id: 1,
  })),
  findOrgById: vi.fn(async () => ({ name: "Test Company" })),
  getUserDepartmentName: vi.fn(async () => "Engineering"),
}));
import { PayslipPDFService } from "./payslip-pdf.service";

beforeEach(() => {
  fixture.setting = false;
  fixture.payslip = {
    empcloud_user_id: 1,
    month: 11,
    year: 2026,
    paid_days: 30,
    total_days: 30,
    lop_days: 0,
    gross_earnings: 27985,
    total_deductions: 2015,
    net_pay: 25970,
    total_employer_cost: 30000,
    earnings: [{ code: "BASIC", name: "Basic Salary", amount: 27985 }],
    deductions: [{ code: "EPF", name: "Employee PF", amount: 2015 }],
    employer_contributions: [{ code: "EMP_EPF", name: "Employer EPF", amount: 2015 }],
  };
});

describe("CTC-inclusive payslip presentation", () => {
  it("reconciles the frozen employer cost and labels contributions using the calculation snapshot", async () => {
    fixture.payslip.pf_contribution = JSON.stringify({
      employer_ctc: { included: true, monthlyCtc: 30000 },
    });
    const html = await new PayslipPDFService().generateHTML("payslip-1");
    expect(html).toContain("Included in CTC");
    expect(html).toContain('Company Cost for This Period</td><td class="amt">\u20b930,000');
    expect(html).toContain('Agreed Monthly CTC</td><td class="amt">\u20b930,000');
    expect(html).toContain("\u20b925,970");
  });

  it("does not reinterpret old payslips using the current organization setting", async () => {
    fixture.setting = true;
    const html = await new PayslipPDFService().generateHTML("payslip-1");
    expect(html).not.toContain("Included in CTC");
    expect(html).not.toContain("Agreed Monthly CTC");
  });
});
