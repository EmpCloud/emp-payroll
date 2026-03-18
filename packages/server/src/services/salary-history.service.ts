import { getDB } from "../db/adapters";

export class SalaryHistoryService {
  private db = getDB();

  async getHistory(employeeId: string) {
    const result = await this.db.findMany<any>("employee_salaries", {
      filters: { employee_id: employeeId },
      sort: { field: "effective_from", order: "desc" },
      limit: 50,
    });

    // Enrich with structure names
    const structureIds = [...new Set(result.data.map((s: any) => s.structure_id))];
    const structures: Record<string, string> = {};
    for (const sid of structureIds) {
      const s = await this.db.findById<any>("salary_structures", sid as string);
      if (s) structures[sid as string] = s.name;
    }

    return result.data.map((s: any) => ({
      ...s,
      structure_name: structures[s.structure_id] || "Unknown",
      components: typeof s.components === "string" ? JSON.parse(s.components) : s.components,
    }));
  }
}
