import { getDB } from "../db/adapters";
import { findUsersByOrgId } from "../db/empcloud";

export class PayEquityService {
  private db = getDB();

  /**
   * Analyze pay equity across different dimensions (gender, department, role).
   * Queries existing salary data — no new tables needed.
   */
  async analyzePayEquity(orgId: string, params?: { dimension?: string }) {
    const numOrgId = Number(orgId);
    const dimension = params?.dimension || "all";

    // Get all employees from EmpCloud with their data
    const employees = await findUsersByOrgId(numOrgId, { limit: 10000 });

    // Get all active salaries from payroll DB
    const salariesResult = await this.db.findMany<any>("employee_salaries", {
      filters: { is_active: true },
      limit: 10000,
    });

    // Map salaries by empcloud_user_id
    const salaryMap: Record<number, any> = {};
    for (const sal of salariesResult.data) {
      if (sal.empcloud_user_id) {
        salaryMap[sal.empcloud_user_id] = sal;
      }
    }

    // Build enriched dataset
    const dataset: any[] = [];
    for (const emp of employees) {
      const salary = salaryMap[emp.id];
      if (!salary) continue;

      dataset.push({
        employeeId: emp.id,
        firstName: emp.first_name,
        lastName: emp.last_name,
        gender: emp.gender || "unknown",
        department: emp.department_id ? String(emp.department_id) : "Unknown",
        designation: emp.designation || "Unknown",
        ctc: Number(salary.ctc),
        grossSalary: Number(salary.gross_salary),
      });
    }

    const result: any = {
      totalEmployees: dataset.length,
      overallStats: this.computeStats(dataset.map((d) => d.ctc)),
    };

    // Gender analysis
    if (dimension === "all" || dimension === "gender") {
      result.genderAnalysis = this.analyzeByGroup(dataset, "gender");
    }

    // Department analysis
    if (dimension === "all" || dimension === "department") {
      result.departmentAnalysis = this.analyzeByGroup(dataset, "department");
    }

    // Role/designation analysis
    if (dimension === "all" || dimension === "role") {
      result.roleAnalysis = this.analyzeByGroup(dataset, "designation");
    }

    // Pay gap calculations
    if (dimension === "all" || dimension === "gender") {
      result.payGap = this.computePayGap(dataset);
    }

    return result;
  }

  /**
   * Generate a compliance report for pay equity.
   */
  async generateComplianceReport(orgId: string) {
    const analysis = await this.analyzePayEquity(orgId);

    const report: any = {
      generatedAt: new Date().toISOString(),
      organizationId: orgId,
      summary: {
        totalEmployeesAnalyzed: analysis.totalEmployees,
        overallMedianSalary: analysis.overallStats.median,
        overallAverageSalary: analysis.overallStats.mean,
      },
      genderPayGap: analysis.payGap || null,
      findings: [] as string[],
      recommendations: [] as string[],
    };

    // Generate findings
    if (analysis.payGap) {
      const gap = analysis.payGap;
      if (Math.abs(gap.meanGapPercentage) > 5) {
        report.findings.push(
          `Significant mean pay gap detected: ${gap.meanGapPercentage.toFixed(1)}% (${gap.meanGapPercentage > 0 ? "men paid more" : "women paid more"})`,
        );
        report.recommendations.push(
          "Conduct detailed review of compensation for roles where significant gaps exist",
        );
      }
      if (Math.abs(gap.medianGapPercentage) > 5) {
        report.findings.push(
          `Significant median pay gap detected: ${gap.medianGapPercentage.toFixed(1)}%`,
        );
      }
      if (Math.abs(gap.meanGapPercentage) <= 5) {
        report.findings.push("Pay gap is within acceptable range (within 5%)");
      }
    }

    // Department-level analysis
    if (analysis.departmentAnalysis) {
      const depts = Object.entries(analysis.departmentAnalysis);
      for (const [dept, stats] of depts) {
        const s = stats as any;
        if (s.count < 2) continue;
        const cv = s.stdDev / s.mean;
        if (cv > 0.5) {
          report.findings.push(
            `High salary variance in department "${dept}" (CV: ${(cv * 100).toFixed(1)}%)`,
          );
          report.recommendations.push(
            `Review salary bands for department "${dept}" to ensure internal equity`,
          );
        }
      }
    }

    if (report.findings.length === 0) {
      report.findings.push("No significant pay equity concerns detected");
    }
    if (report.recommendations.length === 0) {
      report.recommendations.push("Continue monitoring pay equity on a quarterly basis");
    }

    return report;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private analyzeByGroup(dataset: any[], groupKey: string): Record<string, any> {
    const groups: Record<string, number[]> = {};
    for (const d of dataset) {
      const key = d[groupKey] || "Unknown";
      if (!groups[key]) groups[key] = [];
      groups[key].push(d.ctc);
    }

    const result: Record<string, any> = {};
    for (const [key, salaries] of Object.entries(groups)) {
      result[key] = {
        count: salaries.length,
        ...this.computeStats(salaries),
      };
    }
    return result;
  }

  private computeStats(values: number[]) {
    if (values.length === 0) {
      return { mean: 0, median: 0, min: 0, max: 0, p25: 0, p75: 0, stdDev: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);
    const mean = sum / n;

    const median =
      n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];

    const p25 = sorted[Math.floor(n * 0.25)];
    const p75 = sorted[Math.floor(n * 0.75)];

    const variance = sorted.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    return {
      mean: Math.round(mean),
      median: Math.round(median),
      min: sorted[0],
      max: sorted[n - 1],
      p25: Math.round(p25),
      p75: Math.round(p75),
      stdDev: Math.round(stdDev),
    };
  }

  private computePayGap(dataset: any[]) {
    const male = dataset.filter((d) => d.gender === "male").map((d) => d.ctc);
    const female = dataset.filter((d) => d.gender === "female").map((d) => d.ctc);

    if (male.length === 0 || female.length === 0) {
      return {
        maleCount: male.length,
        femaleCount: female.length,
        maleMean: 0,
        femaleMean: 0,
        meanGapPercentage: 0,
        medianGapPercentage: 0,
        message: "Insufficient data — need both male and female employees",
      };
    }

    const maleStats = this.computeStats(male);
    const femaleStats = this.computeStats(female);

    // Gap = (male - female) / male * 100
    const meanGap =
      maleStats.mean > 0 ? ((maleStats.mean - femaleStats.mean) / maleStats.mean) * 100 : 0;
    const medianGap =
      maleStats.median > 0 ? ((maleStats.median - femaleStats.median) / maleStats.median) * 100 : 0;

    return {
      maleCount: male.length,
      femaleCount: female.length,
      maleMean: maleStats.mean,
      femaleMean: femaleStats.mean,
      maleMedian: maleStats.median,
      femaleMedian: femaleStats.median,
      meanGapPercentage: Math.round(meanGap * 10) / 10,
      medianGapPercentage: Math.round(medianGap * 10) / 10,
      meanGapAbsolute: maleStats.mean - femaleStats.mean,
      medianGapAbsolute: maleStats.median - femaleStats.median,
    };
  }
}
