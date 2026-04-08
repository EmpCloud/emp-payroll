import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";
import { computePF, computeESI } from "./compliance/india-statutory.service";

export class ReportsService {
  private db = getDB();

  /** PF ECR (Electronic Challan cum Return) format */
  async generatePFECR(
    runId: string,
    orgId: string,
  ): Promise<{ filename: string; content: string }> {
    const { payslips, employees, org } = await this.getRunData(runId, orgId);

    const lines: string[] = [];
    // ECR Header
    lines.push(`#~#${org?.pf_establishment_code || ""}#~#TRRN#~#${org?.name || ""}#~#`);

    for (const ps of payslips) {
      const emp = employees[ps.employee_id];
      if (!emp) continue;
      const pfDetails = this.parseJSON(emp.pf_details);
      const components = this.parseJSON(
        (await this.db.findOne<any>("employee_salaries", { employee_id: emp.id, is_active: true }))
          ?.components,
      );
      const basicMonthly = components.find((c: any) => c.code === "BASIC")?.monthlyAmount || 0;

      const pf = computePF({
        employeeId: emp.id,
        month: ps.month,
        year: ps.year,
        basicSalary: basicMonthly,
      });

      // UAN, Name, Gross Wages, EPF Wages, EPS Wages, EDLI Wages, EPF Contribution, EPS Contribution, Diff
      lines.push(
        [
          this.parseJSON(emp.tax_info).uan || "",
          `${emp.first_name} ${emp.last_name}`,
          Math.round(Number(ps.gross_earnings)),
          pf.pfWages,
          pf.pfWages,
          pf.pfWages,
          pf.employeeEPF,
          pf.employerEPS,
          0,
          pfDetails.pfNumber || "",
        ].join("#~#"),
      );
    }

    return {
      filename: `PF-ECR-${ps_period(payslips[0])}.txt`,
      content: lines.join("\n"),
    };
  }

  /** ESI Monthly Return */
  async generateESIReturn(
    runId: string,
    orgId: string,
  ): Promise<{ filename: string; content: string }> {
    const { payslips, employees, org } = await this.getRunData(runId, orgId);

    const headers = [
      "IP Number",
      "IP Name",
      "No of Days",
      "Total Wages",
      "IP Contribution",
      "Employer Contribution",
      "Total",
    ];
    const rows: string[] = [headers.join(",")];

    for (const ps of payslips) {
      const emp = employees[ps.employee_id];
      if (!emp) continue;

      const esi = computeESI({
        employeeId: emp.id,
        month: ps.month,
        year: ps.year,
        grossSalary: Number(ps.gross_earnings),
      });

      if (!esi) continue;

      const esiDetails = this.parseJSON(emp.esi_details);
      rows.push(
        [
          `"${esiDetails?.esiNumber || ""}"`,
          `"${emp.first_name} ${emp.last_name}"`,
          ps.paid_days,
          ps.gross_earnings,
          esi.employeeContribution,
          esi.employerContribution,
          esi.total,
        ].join(","),
      );
    }

    return {
      filename: `ESI-Return-${ps_period(payslips[0])}.csv`,
      content: rows.join("\n"),
    };
  }

  /** TDS Summary (Form 24Q data) */
  async generateTDSSummary(runId: string, orgId: string): Promise<any[]> {
    const { payslips, employees } = await this.getRunData(runId, orgId);

    return payslips
      .map((ps: any) => {
        const emp = employees[ps.employee_id];
        if (!emp) return null;
        const taxInfo = this.parseJSON(emp.tax_info);
        const deductions = this.parseJSON(ps.deductions);
        const tds = deductions.find((d: any) => d.code === "TDS");

        return {
          employeeCode: emp.employee_code,
          name: `${emp.first_name} ${emp.last_name}`,
          pan: taxInfo.pan || "",
          grossSalary: Number(ps.gross_earnings),
          tdsDeducted: tds?.amount || 0,
          month: ps.month,
          year: ps.year,
        };
      })
      .filter(Boolean);
  }

  /** PT Return */
  async generatePTReturn(
    runId: string,
    orgId: string,
  ): Promise<{ filename: string; content: string }> {
    const { payslips, employees } = await this.getRunData(runId, orgId);

    const headers = ["Employee Code", "Name", "Gross Salary", "PT Amount"];
    const rows: string[] = [headers.join(",")];

    for (const ps of payslips) {
      const emp = employees[ps.employee_id];
      if (!emp) continue;
      const deductions = this.parseJSON(ps.deductions);
      const pt = deductions.find((d: any) => d.code === "PT");
      if (!pt || pt.amount <= 0) continue;

      rows.push(
        [
          `"${emp.employee_code}"`,
          `"${emp.first_name} ${emp.last_name}"`,
          ps.gross_earnings,
          pt.amount,
        ].join(","),
      );
    }

    return {
      filename: `PT-Return-${ps_period(payslips[0])}.csv`,
      content: rows.join("\n"),
    };
  }

  private async getRunData(runId: string, orgId: string) {
    const run = await this.db.findOne<any>("payroll_runs", {
      id: runId,
      empcloud_org_id: Number(orgId),
    });
    if (!run) throw new AppError(404, "NOT_FOUND", "Payroll run not found");

    const payslipsResult = await this.db.findMany<any>("payslips", {
      filters: { payroll_run_id: runId },
      limit: 10000,
    });
    const payslips = payslipsResult.data;

    const empIds = [...new Set(payslips.map((p: any) => p.employee_id))];
    const employees: Record<string, any> = {};
    for (const empId of empIds) {
      const emp = await this.db.findById<any>("employees", empId as string);
      if (emp) employees[empId as string] = emp;
    }

    const org = await this.db.findById<any>("organizations", orgId);
    return { run, payslips, employees, org };
  }

  private parseJSON(val: any): any {
    if (!val) return {};
    if (typeof val === "string")
      try {
        return JSON.parse(val);
      } catch {
        return {};
      }
    return val;
  }

  /**
   * Generate TDS Challan data (Form 26Q-equivalent).
   * Returns structured data for quarterly TDS filing.
   */
  async generateTDSChallan(
    orgId: string,
    params: {
      quarter: 1 | 2 | 3 | 4;
      financialYear: string; // "2025-2026"
    },
  ) {
    const org = await this.db.findById<any>("organizations", orgId);
    if (!org) throw new AppError(404, "NOT_FOUND", "Organization not found");

    const [fyStart] = params.financialYear.split("-").map(Number);
    const quarterMonths: Record<number, number[]> = {
      1: [4, 5, 6], // Apr-Jun
      2: [7, 8, 9], // Jul-Sep
      3: [10, 11, 12], // Oct-Dec
      4: [1, 2, 3], // Jan-Mar
    };
    const months = quarterMonths[params.quarter];
    const year = params.quarter === 4 ? fyStart + 1 : fyStart;

    // Get all payroll runs for this quarter
    const runs = await this.db.findMany<any>("payroll_runs", {
      filters: { empcloud_org_id: Number(orgId), status: "paid" },
      limit: 100,
    });

    const quarterRuns = runs.data.filter(
      (r: any) =>
        months.includes(r.month) &&
        (params.quarter === 4 ? r.year === fyStart + 1 : r.year === fyStart),
    );

    // Collect deductee-wise TDS data
    const deductees: Record<
      string,
      {
        employeeId: string;
        name: string;
        pan: string;
        totalPaid: number;
        totalTDS: number;
        months: { month: number; paid: number; tds: number }[];
      }
    > = {};

    for (const run of quarterRuns) {
      const payslips = await this.db.findMany<any>("payslips", {
        filters: { payroll_run_id: run.id },
        limit: 10000,
      });

      for (const ps of payslips.data) {
        const emp = await this.db.findById<any>("employees", ps.employee_id);
        if (!emp) continue;

        const taxInfo = this.parseJSON(emp.tax_info);
        const deductions = this.parseJSON(ps.deductions);
        const tds =
          deductions.find?.((d: any) => d.code === "TDS" || d.code === "INCOME_TAX")?.amount || 0;

        if (!deductees[emp.id]) {
          deductees[emp.id] = {
            employeeId: emp.id,
            name: `${emp.first_name} ${emp.last_name}`,
            pan: taxInfo.pan || "N/A",
            totalPaid: 0,
            totalTDS: 0,
            months: [],
          };
        }

        deductees[emp.id].totalPaid += Number(ps.gross_earnings);
        deductees[emp.id].totalTDS += tds;
        deductees[emp.id].months.push({
          month: ps.month,
          paid: Number(ps.gross_earnings),
          tds,
        });
      }
    }

    const deducteeList = Object.values(deductees);
    const totalTDS = deducteeList.reduce((s, d) => s + d.totalTDS, 0);
    const totalPaid = deducteeList.reduce((s, d) => s + d.totalPaid, 0);

    const quarterLabel = `Q${params.quarter} (${months.map((m) => ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m]).join("-")})`;

    return {
      form: "26Q",
      quarter: params.quarter,
      quarterLabel,
      financialYear: params.financialYear,
      assessmentYear: `${fyStart + 1}-${fyStart + 2}`,
      deductor: {
        name: org.name,
        tan: org.tan,
        pan: org.pan,
        address: this.parseJSON(org.registered_address),
      },
      summary: {
        totalDeductees: deducteeList.length,
        totalAmountPaid: totalPaid,
        totalTDSDeducted: totalTDS,
        totalTDSDeposited: totalTDS, // Assume deposited = deducted
      },
      deductees: deducteeList,
      challanDetails: {
        bsrCode: "", // To be filled by user
        challanSerial: "",
        depositDate: "",
        amount: totalTDS,
      },
    };
  }
}

function ps_period(ps: any): string {
  const months = [
    "",
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];
  return `${months[ps?.month || 1]}-${ps?.year || 2026}`;
}
