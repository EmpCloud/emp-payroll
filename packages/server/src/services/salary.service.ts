import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";

export class SalaryService {
  private db = getDB();

  async listStructures(orgId: string) {
    return this.db.findMany<any>("salary_structures", {
      filters: { org_id: orgId, is_active: true },
    });
  }

  async getStructure(id: string, orgId: string) {
    const structure = await this.db.findOne<any>("salary_structures", { id, org_id: orgId });
    if (!structure) throw new AppError(404, "NOT_FOUND", "Salary structure not found");
    return structure;
  }

  async createStructure(orgId: string, data: any) {
    const structure = await this.db.create<any>("salary_structures", {
      org_id: orgId,
      name: data.name,
      description: data.description || null,
      is_default: data.isDefault || false,
      is_active: true,
    });

    // Create components
    if (data.components?.length) {
      for (let i = 0; i < data.components.length; i++) {
        const c = data.components[i];
        await this.db.create("salary_components", {
          structure_id: structure.id,
          name: c.name,
          code: c.code,
          type: c.type,
          calculation_type: c.calculationType,
          value: c.value || 0,
          percentage_of: c.percentageOf || null,
          formula: c.formula || null,
          is_taxable: c.isTaxable !== false,
          is_statutory: c.isStatutory || false,
          is_proratable: c.isProratable !== false,
          is_active: true,
          sort_order: c.sortOrder || i,
        });
      }
    }

    return structure;
  }

  async updateStructure(id: string, orgId: string, data: any) {
    await this.getStructure(id, orgId);
    return this.db.update("salary_structures", id, {
      name: data.name,
      description: data.description,
      is_default: data.isDefault,
    });
  }

  async deleteStructure(id: string, orgId: string) {
    await this.getStructure(id, orgId);
    await this.db.update("salary_structures", id, { is_active: false });
    return { message: "Salary structure deactivated" };
  }

  async getComponents(structureId: string) {
    return this.db.findMany<any>("salary_components", {
      filters: { structure_id: structureId, is_active: true },
      sort: { field: "sort_order", order: "asc" },
    });
  }

  async addComponent(structureId: string, data: any) {
    return this.db.create("salary_components", {
      structure_id: structureId,
      name: data.name,
      code: data.code,
      type: data.type,
      calculation_type: data.calculationType,
      value: data.value || 0,
      percentage_of: data.percentageOf || null,
      formula: data.formula || null,
      is_taxable: data.isTaxable !== false,
      is_statutory: data.isStatutory || false,
      is_proratable: data.isProratable !== false,
      is_active: true,
      sort_order: data.sortOrder || 0,
    });
  }

  async updateComponent(structureId: string, componentId: string, data: any) {
    const component = await this.db.findOne<any>("salary_components", {
      id: componentId,
      structure_id: structureId,
    });
    if (!component) throw new AppError(404, "NOT_FOUND", "Component not found");
    return this.db.update("salary_components", componentId, data);
  }

  async assignToEmployee(data: any) {
    // Deactivate current salary
    await this.db.updateMany("employee_salaries", {
      employee_id: data.employeeId,
      is_active: true,
    }, { is_active: false });

    const grossSalary = data.components.reduce(
      (sum: number, c: any) => sum + (c.monthlyAmount * 12),
      0
    );

    return this.db.create("employee_salaries", {
      employee_id: data.employeeId,
      structure_id: data.structureId,
      ctc: data.ctc,
      gross_salary: grossSalary,
      net_salary: grossSalary, // Will be computed properly during payroll
      components: JSON.stringify(data.components),
      effective_from: data.effectiveFrom,
      is_active: true,
    });
  }

  async getEmployeeSalary(employeeId: string) {
    const salary = await this.db.findOne<any>("employee_salaries", {
      employee_id: employeeId,
      is_active: true,
    });
    if (!salary) throw new AppError(404, "NOT_FOUND", "No active salary found for employee");
    return salary;
  }

  async salaryRevision(employeeId: string, data: any) {
    return this.assignToEmployee({ ...data, employeeId });
  }
}
