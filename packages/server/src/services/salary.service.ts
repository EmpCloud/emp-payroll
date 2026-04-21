import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";

export class SalaryService {
  private db = getDB();

  async listStructures(orgId: string) {
    return this.db.findMany<any>("salary_structures", {
      filters: { empcloud_org_id: Number(orgId), is_active: true },
    });
  }

  async getStructure(id: string, orgId: string) {
    const structure = await this.db.findOne<any>("salary_structures", {
      id,
      empcloud_org_id: Number(orgId),
    });
    if (!structure) throw new AppError(404, "NOT_FOUND", "Salary structure not found");
    return structure;
  }

  async createStructure(orgId: string, data: any) {
    const structure = await this.db.create<any>("salary_structures", {
      org_id: "00000000-0000-0000-0000-000000000000",
      empcloud_org_id: Number(orgId),
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

  async duplicateStructure(id: string, orgId: string, nameOverride?: string) {
    const original = await this.getStructure(id, orgId);
    const { data: components } = await this.getComponents(id);

    const newName = (nameOverride && nameOverride.trim()) || `${original.name} (Copy)`;

    const copy = await this.db.create<any>("salary_structures", {
      org_id: original.org_id || "00000000-0000-0000-0000-000000000000",
      empcloud_org_id: Number(orgId),
      name: newName,
      description: original.description || null,
      is_default: false,
      is_active: true,
    });

    for (let i = 0; i < components.length; i++) {
      const c: any = components[i];
      await this.db.create("salary_components", {
        structure_id: copy.id,
        name: c.name,
        code: c.code,
        type: c.type,
        calculation_type: c.calculation_type,
        value: c.value != null ? Number(c.value) : 0,
        percentage_of: c.percentage_of || null,
        formula: c.formula || null,
        is_taxable: c.is_taxable !== false,
        is_statutory: c.is_statutory === true,
        is_proratable: c.is_proratable !== false,
        is_active: true,
        sort_order: c.sort_order ?? i,
      });
    }

    return copy;
  }

  async updateStructure(id: string, orgId: string, data: any) {
    await this.getStructure(id, orgId);

    const updated = await this.db.update("salary_structures", id, {
      name: data.name,
      description: data.description,
      is_default: data.isDefault,
    });

    // Reconcile components when the caller supplies the `components` array.
    // The UI always posts the full current list, so the simplest correct
    // behaviour is replace-all.
    //
    // We MUST hard-delete (not soft-delete). The table has a unique key on
    // (structure_id, code) that ignores is_active, so a soft-delete followed
    // by re-insert of the same code collides with the zombie row and MySQL
    // returns ER_DUP_ENTRY. employee_salaries stores a JSON snapshot of
    // components (not an FK to this row), so deleting is safe for history.
    if (Array.isArray(data.components)) {
      await this.db.deleteMany("salary_components", { structure_id: id });
      for (let i = 0; i < data.components.length; i++) {
        const c = data.components[i];
        await this.db.create("salary_components", {
          structure_id: id,
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
          sort_order: c.sortOrder ?? i,
        });
      }
    }

    return updated;
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
    await this.db.updateMany(
      "employee_salaries",
      {
        empcloud_user_id: Number(data.employeeId),
        is_active: true,
      },
      { is_active: false },
    );

    const grossSalary = data.components.reduce(
      (sum: number, c: any) => sum + c.monthlyAmount * 12,
      0,
    );

    return this.db.create("employee_salaries", {
      employee_id: "00000000-0000-0000-0000-000000000000",
      empcloud_user_id: Number(data.employeeId),
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
      empcloud_user_id: Number(employeeId),
      is_active: true,
    });
    if (!salary) throw new AppError(404, "NOT_FOUND", "No active salary found for employee");
    return salary;
  }

  async salaryRevision(employeeId: string, data: any) {
    return this.assignToEmployee({ ...data, employeeId });
  }

  async bulkAssignSalary(
    assignments: {
      employeeId: string;
      ctc: number;
      bankDetails?: { accountNumber: string; ifscCode: string; bankName: string };
    }[],
    sharedData: { structureId: string; effectiveFrom: string },
  ) {
    const results: { employeeId: string; success: boolean; error?: string }[] = [];
    const employeeService = new (require("./employee.service").default)();

    for (const { employeeId, ctc, bankDetails } of assignments) {
      try {
        // Update bank details if provided
        if (
          bankDetails &&
          (bankDetails.accountNumber || bankDetails.ifscCode || bankDetails.bankName)
        ) {
          try {
            await employeeService.updateBankDetails(Number(employeeId), undefined, {
              accountNumber: bankDetails.accountNumber,
              ifscCode: bankDetails.ifscCode,
              bankName: bankDetails.bankName,
            });
          } catch (bankErr: any) {
            console.warn(`Bank details update failed for employee ${employeeId}:`, bankErr.message);
            // Continue with salary assignment even if bank details update fails
          }
        }

        const monthly = ctc / 12;
        const basic = Math.round(monthly * 0.4);
        const hra = Math.round(basic * 0.5);
        const sa = Math.round(monthly - basic - hra);
        const components = [
          { code: "BASIC", name: "Basic Salary", monthlyAmount: basic, annualAmount: basic * 12 },
          {
            code: "HRA",
            name: "House Rent Allowance",
            monthlyAmount: hra,
            annualAmount: hra * 12,
          },
          { code: "SA", name: "Special Allowance", monthlyAmount: sa, annualAmount: sa * 12 },
        ];
        await this.assignToEmployee({ employeeId, ctc, components, ...sharedData });
        results.push({ employeeId, success: true });
      } catch (err: any) {
        results.push({ employeeId, success: false, error: err.message });
      }
    }
    const failed = results.filter((r) => !r.success).length;
    return { updated: results.length - failed, failed, results };
  }

  async computeArrears(
    employeeId: string,
    orgId: string,
    params: {
      oldMonthlyCTC: number;
      newMonthlyCTC: number;
      effectiveFrom: string;
    },
  ) {
    const { oldMonthlyCTC, newMonthlyCTC, effectiveFrom } = params;
    const monthlyDiff = Math.round(newMonthlyCTC - oldMonthlyCTC);
    if (monthlyDiff <= 0) return { arrears: [], totalArrears: 0, monthlyDiff: 0 };

    const fromDate = new Date(effectiveFrom);
    const now = new Date();
    const arrears: { month: number; year: number; amount: number }[] = [];

    let year = fromDate.getFullYear();
    let month = fromDate.getMonth() + 1;

    while (
      year < now.getFullYear() ||
      (year === now.getFullYear() && month <= now.getMonth() + 1)
    ) {
      const existingPayslip = await this.db.raw<any>(
        `SELECT id FROM payslips WHERE empcloud_user_id = ? AND month = ? AND year = ? AND status IN ('paid', 'computed', 'approved') LIMIT 1`,
        [Number(employeeId), month, year],
      );
      const rows = Array.isArray(existingPayslip)
        ? Array.isArray(existingPayslip[0])
          ? existingPayslip[0]
          : existingPayslip
        : existingPayslip.rows || [];

      if (rows.length > 0) {
        arrears.push({ month, year, amount: monthlyDiff });
      }

      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    }

    const totalArrears = arrears.reduce((s, a) => s + a.amount, 0);
    return { arrears, totalArrears, monthlyDiff };
  }
}
