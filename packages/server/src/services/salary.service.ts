import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";
import { EmployeeService } from "./employee.service";
import { findUserByEmpCode, findUserById } from "../db/empcloud";
import {
  resolveSalaryComponents,
  SalaryResolverError,
  type ResolverComponent,
} from "@emp-payroll/shared";

export class SalaryService {
  private db = getDB();

  /**
   * Load a structure's components and resolve them against an annual CTC,
   * returning monthly amounts ready to persist on `employee_salaries`.
   * Honors `balance` calc type — exactly one earning may absorb the remainder
   * of monthly gross after fixed/percentage rows are computed.
   */
  private async resolveComponentsForCTC(structureId: string, ctcAnnual: number) {
    const rows = await this.db.findMany<any>("salary_components", {
      filters: { structure_id: structureId, is_active: true },
      sort: { field: "sort_order", order: "asc" },
    });
    const list = (rows as any).data ?? rows ?? [];
    const definitions: ResolverComponent[] = list.map((c: any) => ({
      code: c.code,
      name: c.name,
      type: c.type,
      calculationType: c.calculation_type,
      value: Number(c.value) || 0,
      percentageOf: c.percentage_of || undefined,
    }));
    try {
      return resolveSalaryComponents(definitions, ctcAnnual);
    } catch (err) {
      if (err instanceof SalaryResolverError) {
        throw new AppError(400, err.code, err.message);
      }
      throw err;
    }
  }

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
    // If caller didn't pre-compute components, derive them from the structure.
    // This is the path that supports `balance` calculation: the structure is
    // the source of truth, the resolver does the math from CTC.
    let components = data.components;
    if (!components || components.length === 0) {
      if (!data.structureId) {
        throw new AppError(
          400,
          "MISSING_COMPONENTS",
          "Either components[] or structureId is required.",
        );
      }
      components = await this.resolveComponentsForCTC(data.structureId, Number(data.ctc));
    }

    // Deactivate current salary
    await this.db.updateMany(
      "employee_salaries",
      {
        empcloud_user_id: Number(data.employeeId),
        is_active: true,
      },
      { is_active: false },
    );

    const grossSalary = components.reduce((sum: number, c: any) => sum + c.monthlyAmount * 12, 0);

    return this.db.create("employee_salaries", {
      employee_id: "00000000-0000-0000-0000-000000000000",
      empcloud_user_id: Number(data.employeeId),
      structure_id: data.structureId,
      ctc: data.ctc,
      gross_salary: grossSalary,
      net_salary: grossSalary, // Will be computed properly during payroll
      components: JSON.stringify(components),
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
      bankDetails?: { accountNumber?: string; ifscCode?: string; bankName?: string };
      pan?: string;
      pfDetails?: { pfNumber?: string; uan?: string };
    }[],
    sharedData: { structureId: string; effectiveFrom: string; orgId: number },
  ) {
    const results: { employeeId: string; success: boolean; error?: string }[] = [];
    const employeeService = new EmployeeService();

    for (const { employeeId, ctc, bankDetails, pan, pfDetails } of assignments) {
      try {
        // The CSV "Employee ID" column carries either the numeric
        // empcloud user id (rare — only when HR exported the directory
        // with the technical id) or the human-readable emp_code like
        // "EMP/BHI/2025/23" (the common case). `Number("EMP/...")` is
        // NaN, which used to crash the SQL with "Unknown column 'NaN'
        // in 'where clause'". Resolve to the numeric id once per row;
        // try numeric first (cheap), then fall back to emp_code lookup.
        let numericUserId: number | null = null;
        const asNum = Number(employeeId);
        if (Number.isFinite(asNum) && asNum > 0) {
          const u = await findUserById(asNum);
          if (u && u.organization_id === sharedData.orgId) numericUserId = u.id;
        }
        if (numericUserId == null) {
          const u = await findUserByEmpCode(String(employeeId), sharedData.orgId);
          if (u) numericUserId = u.id;
        }
        if (numericUserId == null) {
          results.push({
            employeeId,
            success: false,
            error: `No active employee found for "${employeeId}" (looked up by id and emp_code)`,
          });
          continue;
        }

        // Bank details (optional). Pass the resolved numeric id, never
        // the raw CSV cell.
        if (
          bankDetails &&
          (bankDetails.accountNumber || bankDetails.ifscCode || bankDetails.bankName)
        ) {
          try {
            // updateBankDetails signature is (empcloudUserId, empcloudOrgId,
            // details) — getByEmpCloudId() inside throws "Employee not
            // found" if orgId !== ecUser.organization_id, and undefined
            // never matches. We already have orgId on sharedData; thread
            // it through.
            await employeeService.updateBankDetails(numericUserId, sharedData.orgId, {
              accountNumber: bankDetails.accountNumber,
              ifscCode: bankDetails.ifscCode,
              bankName: bankDetails.bankName,
            });
          } catch (bankErr: any) {
            console.warn(`Bank details update failed for employee ${employeeId}:`, bankErr.message);
            // Continue with salary assignment even if bank details update fails
          }
        }

        // PAN — update tax_info if the CSV had a PAN column. Read-merge-write
        // so we don't clobber other taxInfo fields (aadhar, deductions, etc).
        if (pan && pan.trim()) {
          try {
            const existing =
              (await employeeService.getTaxInfo(numericUserId, sharedData.orgId)) || {};
            await employeeService.updateTaxInfo(numericUserId, sharedData.orgId, {
              ...existing,
              pan: pan.trim().toUpperCase(),
            });
          } catch (taxErr: any) {
            console.warn(`PAN update failed for employee ${employeeId}:`, taxErr.message);
          }
        }

        // PF Number / UAN — update pf_details. Same read-merge-write.
        if (pfDetails && (pfDetails.pfNumber || pfDetails.uan)) {
          try {
            const existing =
              (await employeeService.getPfDetails(numericUserId, sharedData.orgId)) || {};
            await employeeService.updatePfDetails(numericUserId, sharedData.orgId, {
              ...existing,
              ...(pfDetails.pfNumber ? { pfNumber: pfDetails.pfNumber.trim() } : {}),
              ...(pfDetails.uan ? { uan: pfDetails.uan.trim() } : {}),
            });
          } catch (pfErr: any) {
            console.warn(`PF details update failed for employee ${employeeId}:`, pfErr.message);
          }
        }

        // Resolve components from the chosen structure (supports `balance`
        // calc type, percentage chains, etc). Falls back per-row to whatever
        // the structure defines — no more hardcoded Basic/HRA/SA math here.
        const components = await this.resolveComponentsForCTC(sharedData.structureId, ctc);
        await this.assignToEmployee({
          employeeId: String(numericUserId),
          ctc,
          components,
          structureId: sharedData.structureId,
          effectiveFrom: sharedData.effectiveFrom,
        });
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
