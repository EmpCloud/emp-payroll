import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";
import { findUsersByOrgId } from "../db/empcloud";

export class CompensationBenchmarkService {
  private db = getDB();

  // ---------------------------------------------------------------------------
  // Benchmark CRUD
  // ---------------------------------------------------------------------------

  async listBenchmarks(orgId: string, filters?: { department?: string; jobTitle?: string }) {
    const where: Record<string, any> = { empcloud_org_id: Number(orgId) };
    if (filters?.department) where.department = filters.department;
    if (filters?.jobTitle) where.job_title = filters.jobTitle;
    return this.db.findMany<any>("compensation_benchmarks", {
      filters: where,
      sort: { field: "job_title", order: "asc" },
    });
  }

  async getBenchmark(id: string, orgId: string) {
    const benchmark = await this.db.findOne<any>("compensation_benchmarks", {
      id,
      empcloud_org_id: Number(orgId),
    });
    if (!benchmark) throw new AppError(404, "NOT_FOUND", "Benchmark not found");
    return benchmark;
  }

  async createBenchmark(orgId: string, data: any) {
    return this.db.create("compensation_benchmarks", {
      empcloud_org_id: Number(orgId),
      job_title: data.jobTitle,
      department: data.department || null,
      location: data.location || null,
      market_p25: data.marketP25,
      market_p50: data.marketP50,
      market_p75: data.marketP75,
      source: data.source || null,
      effective_date: data.effectiveDate,
    });
  }

  async updateBenchmark(id: string, orgId: string, data: any) {
    await this.getBenchmark(id, orgId);
    const updateData: Record<string, any> = {};
    if (data.jobTitle !== undefined) updateData.job_title = data.jobTitle;
    if (data.department !== undefined) updateData.department = data.department;
    if (data.location !== undefined) updateData.location = data.location;
    if (data.marketP25 !== undefined) updateData.market_p25 = data.marketP25;
    if (data.marketP50 !== undefined) updateData.market_p50 = data.marketP50;
    if (data.marketP75 !== undefined) updateData.market_p75 = data.marketP75;
    if (data.source !== undefined) updateData.source = data.source;
    if (data.effectiveDate !== undefined) updateData.effective_date = data.effectiveDate;
    return this.db.update("compensation_benchmarks", id, updateData);
  }

  async deleteBenchmark(id: string, orgId: string) {
    await this.getBenchmark(id, orgId);
    await this.db.delete("compensation_benchmarks", id);
    return { message: "Benchmark deleted" };
  }

  async importBenchmarks(orgId: string, benchmarks: any[]) {
    const results = [];
    for (const b of benchmarks) {
      const created = await this.db.create("compensation_benchmarks", {
        empcloud_org_id: Number(orgId),
        job_title: b.jobTitle,
        department: b.department || null,
        location: b.location || null,
        market_p25: b.marketP25,
        market_p50: b.marketP50,
        market_p75: b.marketP75,
        source: b.source || null,
        effective_date: b.effectiveDate,
      });
      results.push(created);
    }
    return { imported: results.length, data: results };
  }

  // ---------------------------------------------------------------------------
  // Compa-Ratio Analysis
  // ---------------------------------------------------------------------------

  async getCompaRatioReport(orgId: string) {
    const numOrgId = Number(orgId);

    // Get employees from EmpCloud
    const employees = await findUsersByOrgId(numOrgId, { limit: 10000 });

    // Get active salaries
    const salariesResult = await this.db.findMany<any>("employee_salaries", {
      filters: { is_active: true },
      limit: 10000,
    });
    const salaryMap: Record<number, any> = {};
    for (const sal of salariesResult.data) {
      if (sal.empcloud_user_id) {
        salaryMap[sal.empcloud_user_id] = sal;
      }
    }

    // Get all benchmarks for this org
    const benchmarksResult = await this.db.findMany<any>("compensation_benchmarks", {
      filters: { empcloud_org_id: numOrgId },
      limit: 1000,
    });

    // Build a lookup by job title (case-insensitive)
    const benchmarkMap: Record<string, any> = {};
    for (const b of benchmarksResult.data) {
      benchmarkMap[b.job_title.toLowerCase()] = b;
    }

    // Generate compa-ratio for each employee
    const ratios: any[] = [];
    let totalCompaRatio = 0;
    let matchedCount = 0;
    let belowMarket = 0;
    let atMarket = 0;
    let aboveMarket = 0;

    for (const emp of employees) {
      const salary = salaryMap[emp.id];
      if (!salary) continue;

      const designation = (emp.designation || "").toLowerCase();
      const benchmark = benchmarkMap[designation];

      const ctc = Number(salary.ctc);
      let compaRatio: number | null = null;
      let marketPosition: string = "no_benchmark";

      if (benchmark && Number(benchmark.market_p50) > 0) {
        compaRatio = Math.round((ctc / Number(benchmark.market_p50)) * 100) / 100;
        if (compaRatio < 0.9) {
          marketPosition = "below_market";
          belowMarket++;
        } else if (compaRatio > 1.1) {
          marketPosition = "above_market";
          aboveMarket++;
        } else {
          marketPosition = "at_market";
          atMarket++;
        }
        totalCompaRatio += compaRatio;
        matchedCount++;
      }

      ratios.push({
        employeeId: emp.id,
        firstName: emp.first_name,
        lastName: emp.last_name,
        designation: emp.designation,
        ctc,
        benchmarkP25: benchmark ? Number(benchmark.market_p25) : null,
        benchmarkP50: benchmark ? Number(benchmark.market_p50) : null,
        benchmarkP75: benchmark ? Number(benchmark.market_p75) : null,
        compaRatio,
        marketPosition,
      });
    }

    return {
      totalEmployees: ratios.length,
      matchedToBenchmark: matchedCount,
      unmatchedCount: ratios.length - matchedCount,
      averageCompaRatio:
        matchedCount > 0 ? Math.round((totalCompaRatio / matchedCount) * 100) / 100 : null,
      distribution: {
        belowMarket,
        atMarket,
        aboveMarket,
      },
      employees: ratios,
    };
  }
}
