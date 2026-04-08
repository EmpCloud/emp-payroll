import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";

/**
 * Government portal file format generators.
 * - EPFO: UAN-based ECR format for monthly PF filing
 * - TRACES: Form 24Q text file for quarterly TDS returns
 * - ESI: ESIC format for half-yearly returns
 */
export class GovtFormatsService {
  private db = getDB();

  /**
   * Generate EPFO ECR (Electronic Challan cum Return) file.
   * Format: UAN#Member Name#Gross Wages#EPF Wages#EPS Wages#EDLI Wages#EPF Contribution (EE)#EPS Contribution (ER)#EPF Difference (ER)#NCP Days#Refund of Advances
   */
  async generateEPFOFile(
    runId: string,
    orgId: string,
  ): Promise<{ filename: string; content: string }> {
    const { payslips, employees, org, run } = await this.getRunData(runId, orgId);

    const lines: string[] = [];
    for (const ps of payslips) {
      const emp = employees[ps.employee_id];
      if (!emp) continue;

      const taxInfo = this.parseJSON(emp.tax_info);
      const pfDetails = this.parseJSON(emp.pf_details);
      const uan = taxInfo.uan || "";
      if (!uan) continue;

      const grossWages = Number(ps.gross_earnings);
      const epfWages = Math.min(grossWages, 15000); // PF wage ceiling
      const epsWages = Math.min(epfWages, 15000);
      const edliWages = Math.min(epfWages, 15000);
      const epfEE = Math.round(epfWages * 0.12);
      const epsER = Math.round(Math.min(epsWages, 15000) * 0.0833);
      const epfDiffER = epfEE - epsER;

      lines.push(
        [
          uan,
          `${emp.first_name} ${emp.last_name}`.toUpperCase(),
          grossWages,
          epfWages,
          epsWages,
          edliWages,
          epfEE,
          epsER,
          epfDiffER,
          0, // NCP days
          0, // Refund
        ].join("#"),
      );
    }

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
    return {
      filename: `EPFO-ECR-${months[run.month]}-${run.year}.txt`,
      content: lines.join("\n"),
    };
  }

  /**
   * Generate TRACES Form 24Q text file for quarterly TDS returns.
   * Simplified format — actual TRACES requires specific column positions.
   */
  async generateForm24Q(
    orgId: string,
    params: { quarter: number; financialYear: string },
  ): Promise<{ filename: string; content: string }> {
    const org = await this.db.findById<any>("organizations", orgId);
    if (!org) throw new AppError(404, "NOT_FOUND", "Organization not found");

    const [fyStart] = params.financialYear.split("-").map(Number);
    const quarterMonths: Record<number, number[]> = {
      1: [4, 5, 6],
      2: [7, 8, 9],
      3: [10, 11, 12],
      4: [1, 2, 3],
    };
    const months = quarterMonths[params.quarter];

    // Header
    const lines: string[] = [
      `# Form 24Q - Quarterly TDS Return`,
      `# Deductor: ${org.name}`,
      `# TAN: ${org.tan}`,
      `# PAN: ${org.pan}`,
      `# Quarter: Q${params.quarter} of FY ${params.financialYear}`,
      `# Assessment Year: ${fyStart + 1}-${fyStart + 2}`,
      "",
      "Employee PAN,Employee Name,Amount Paid,TDS Deducted,Date of Payment,Section Code,Certificate No",
    ];

    // Get payroll runs for this quarter
    const runs = await this.db.findMany<any>("payroll_runs", {
      filters: { empcloud_org_id: Number(orgId), status: "paid" },
      limit: 100,
    });

    const year = params.quarter === 4 ? fyStart + 1 : fyStart;
    const quarterRuns = runs.data.filter((r: any) => months.includes(r.month) && r.year === year);

    for (const run of quarterRuns) {
      const payslips = await this.db.findMany<any>("payslips", {
        filters: { payroll_run_id: run.id },
        limit: 10000,
      });

      for (const ps of payslips.data) {
        const emp = await this.db.findById<any>("employees", ps.employee_id);
        if (!emp) continue;
        const taxInfo = this.parseJSON(emp.tax_info);
        const deds = this.parseJSON(ps.deductions);
        const tds =
          deds.find?.((d: any) => d.code === "TDS" || d.code === "INCOME_TAX")?.amount || 0;

        if (tds > 0) {
          lines.push(
            [
              taxInfo.pan || "N/A",
              `${emp.first_name} ${emp.last_name}`,
              Number(ps.gross_earnings).toFixed(2),
              tds.toFixed(2),
              `${run.year}-${String(run.month).padStart(2, "0")}-28`,
              "192",
              "",
            ].join(","),
          );
        }
      }
    }

    return {
      filename: `Form24Q-Q${params.quarter}-FY${params.financialYear}.csv`,
      content: lines.join("\n"),
    };
  }

  /**
   * Generate ESIC return file.
   */
  async generateESICReturn(
    runId: string,
    orgId: string,
  ): Promise<{ filename: string; content: string }> {
    const { payslips, employees, run } = await this.getRunData(runId, orgId);

    const lines: string[] = [
      "IP Number,IP Name,No of Days,Total Wages,Employee IP Contribution,Employer IP Contribution,Total Contribution",
    ];

    for (const ps of payslips) {
      const emp = employees[ps.employee_id];
      if (!emp) continue;

      const gross = Number(ps.gross_earnings);
      if (gross > 21000) continue; // ESI only for gross <= 21000

      const ee = Math.round((gross * 0.75) / 100);
      const er = Math.round((gross * 3.25) / 100);

      lines.push(
        [
          emp.employee_code,
          `${emp.first_name} ${emp.last_name}`,
          ps.paid_days || 30,
          gross.toFixed(2),
          ee.toFixed(2),
          er.toFixed(2),
          (ee + er).toFixed(2),
        ].join(","),
      );
    }

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
    return {
      filename: `ESIC-Return-${months[run.month]}-${run.year}.csv`,
      content: lines.join("\n"),
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
    const employees: Record<string, any> = {};
    for (const ps of payslipsResult.data) {
      if (!employees[ps.employee_id]) {
        employees[ps.employee_id] = await this.db.findById<any>("employees", ps.employee_id);
      }
    }
    const org = await this.db.findById<any>("organizations", orgId);
    return { run, payslips: payslipsResult.data, employees, org };
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
}
