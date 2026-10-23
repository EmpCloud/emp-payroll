import type { UaeEmployeeProfile, UaePayrollResult, UaePeriodInput } from "@emp-payroll/shared";
import { getDB } from "../../db/adapters";
import type { IDBAdapter } from "../../db/adapters/interface";
import { findUserById } from "../../db/empcloud";
import { AppError } from "../../api/middleware/error.middleware";
import { uaeExitSchema } from "../../api/validators/uae-payroll";
import { calculateUaePayroll } from "./uae-payroll";
import { readUaeJson, selectUaeProfile, UaePayrollService } from "./uae-payroll.service";

type Row = Record<string, any>;
export interface UaeExitPreparation {
  globalEmployeeId: string;
  countryId: string;
  month: number;
  year: number;
  uaeInput: UaePeriodInput;
  uaeProfile: UaeEmployeeProfile;
  calculation: UaePayrollResult;
  preparedAt: string;
  preparedBy: string;
  runId?: string;
}
function isoDate(value: unknown): string {
  return value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
    : String(value || "").slice(0, 10);
}
function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

/** Links exit preparation to immutable approved payroll and actual disbursement evidence. */
export class UaeExitService {
  constructor(private db: IDBAdapter = getDB()) {}

  private async all(table: string, filters: Row): Promise<Row[]> {
    const rows: Row[] = [];
    for (let page = 1; ; page++) {
      const result = await this.db.findMany<Row>(table, { filters, page, limit: 1000 });
      rows.push(...result.data);
      if (rows.length >= result.total || result.data.length < 1000) return rows;
    }
  }

  private async exit(orgId: string, exitId: string): Promise<Row> {
    const exit = await this.db.findOne<Row>("employee_exits", {
      id: exitId,
      org_id: Number(orgId),
    });
    if (!exit) throw new AppError(404, "NOT_FOUND", "Exit record not found");
    return exit;
  }

  private async periodRun(
    orgId: string,
    countryId: string,
    month: number,
    year: number,
  ): Promise<Row | null> {
    const runs = await this.all("global_payroll_runs", {
      empcloud_org_id: Number(orgId),
      country_id: countryId,
      period_month: month,
      period_year: year,
    });
    const active = runs.filter((run) => run.status !== "cancelled");
    if (active.length > 1)
      throw new AppError(
        409,
        "DUPLICATE_UAE_RUN",
        "Reconcile duplicate payroll runs before preparing this settlement",
      );
    return active[0] ?? null;
  }

  async context(orgId: string, exitId: string) {
    const exit = await this.exit(orgId, exitId);
    const lastWorkingDate = exit.last_working_date ? isoDate(exit.last_working_date) : null;
    const candidates = await this.all("global_employees", {
      empcloud_org_id: Number(orgId),
      empcloud_user_id: Number(exit.employee_id),
    });
    const warnings: string[] = [];
    const employees: Row[] = [];
    for (const employee of candidates) {
      const country = await this.db.findById<Row>("countries", employee.country_id);
      if (country?.code !== "AE") continue;
      let profile: UaeEmployeeProfile | null = null;
      let runDetails: Row | null = null;
      if (lastWorkingDate && validDate(lastWorkingDate)) {
        const year = Number(lastWorkingDate.slice(0, 4)),
          month = Number(lastWorkingDate.slice(5, 7));
        try {
          profile = selectUaeProfile(employee, month, year);
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : "Review the UAE profile history.");
        }
        const run = await this.periodRun(orgId, employee.country_id, month, year);
        if (run) {
          const item = await this.db.findOne<Row>("global_payroll_items", {
            payroll_run_id: run.id,
            empcloud_org_id: Number(orgId),
            global_employee_id: employee.id,
          });
          const calculation = readUaeJson<UaePayrollResult | null>(item?.uae_calculation, null);
          const periodInput = readUaeJson<UaePeriodInput | null>(item?.uae_input, null);
          const payment = readUaeJson<Row | null>(item?.uae_payment, null);
          const frozenEmployee = readUaeJson<Row | null>(item?.uae_employee, null);
          const isApprovedSettlement =
            ["approved", "paid"].includes(run.status) &&
            Number(frozenEmployee?.empcloudUserId) === Number(exit.employee_id) &&
            !!calculation?.finalSettlement &&
            calculation.currency === "AED" &&
            calculation.month === month &&
            calculation.year === year &&
            periodInput?.finalSettlement?.terminationDate === lastWorkingDate;
          const fnfPaid =
            isApprovedSettlement &&
            payment?.status === "paid" &&
            Number.isSafeInteger(payment.paidAmount) &&
            payment.paidAmount === calculation.netSalary &&
            typeof payment.reference === "string" &&
            payment.reference.trim().length > 0 &&
            typeof payment.paidOn === "string" &&
            validDate(payment.paidOn);
          runDetails = {
            id: run.id,
            status: run.status,
            month,
            year,
            revision: run.uae_revision,
            itemId: item?.id ?? null,
            profile: readUaeJson<UaeEmployeeProfile | null>(item?.uae_profile, null),
            input: periodInput,
            calculation,
            payment,
            fnfCalculated: isApprovedSettlement,
            fnfPaid,
          };
          if (
            calculation?.finalSettlement &&
            !isApprovedSettlement &&
            ["approved", "paid"].includes(run.status)
          )
            warnings.push(
              "An approved snapshot does not match this exit date or linked employee; reconcile it before treating the settlement as calculated or paid.",
            );
        }
      }
      employees.push({
        id: employee.id,
        name: `${employee.first_name || ""} ${employee.last_name || ""}`.trim(),
        countryId: employee.country_id,
        status: employee.status,
        startDate: isoDate(employee.start_date),
        endDate: employee.end_date ? isoDate(employee.end_date) : null,
        profile,
        run: runDetails,
      });
    }
    const prepared = readUaeJson<UaeExitPreparation | null>(exit.uae_settlement, null);
    if (prepared && !employees.some((employee) => employee.id === prepared.globalEmployeeId))
      warnings.push(
        "The prepared UAE employment is no longer linked to this exit. Restore or reconcile the linkage; the settlement cannot use another country's calculation.",
      );
    if (employees.length && !lastWorkingDate)
      warnings.push("Set the exit's last working date before preparing the UAE settlement.");
    const selected = prepared
      ? employees.find((employee) => employee.id === prepared.globalEmployeeId)
      : employees.length === 1
        ? employees[0]
        : null;
    if (employees.length > 1 && !selected)
      warnings.push("Select the linked UAE employment being settled.");
    return {
      isUae: employees.length > 0 || prepared !== null,
      exitId: exit.id,
      employeeId: Number(exit.employee_id),
      lastWorkingDate,
      employees,
      prepared,
      fnfCalculated: selected?.run?.fnfCalculated === true,
      fnfPaid: selected?.run?.fnfPaid === true,
      warnings,
    };
  }

  async prepare(
    orgId: string,
    exitId: string,
    body: { globalEmployeeId: string; uaeInput: UaePeriodInput },
    actor: string,
  ): Promise<UaeExitPreparation> {
    const parsed = uaeExitSchema.safeParse({ body });
    if (!parsed.success)
      throw new AppError(
        400,
        "INVALID_UAE_SETTLEMENT",
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      );
    const input = parsed.data.body.uaeInput as UaePeriodInput;
    const exit = await this.exit(orgId, exitId);
    const lastWorkingDate = isoDate(exit.last_working_date);
    if (!validDate(lastWorkingDate) || input.finalSettlement?.terminationDate !== lastWorkingDate)
      throw new AppError(
        400,
        "UAE_EXIT_DATE_MISMATCH",
        "Final settlement must match the exit record's last working date",
      );
    if (["completed", "cancelled"].includes(exit.status))
      throw new AppError(
        409,
        "EXIT_CLOSED",
        "A completed or cancelled exit cannot be prepared again",
      );
    const employee = await this.db.findOne<Row>("global_employees", {
      id: body.globalEmployeeId,
      empcloud_org_id: Number(orgId),
      empcloud_user_id: Number(exit.employee_id),
    });
    if (!employee)
      throw new AppError(404, "NOT_FOUND", "Linked UAE employment not found for this exit");
    const country = await this.db.findById<Row>("countries", employee.country_id);
    if (country?.code !== "AE")
      throw new AppError(400, "NOT_UAE_EMPLOYEE", "Select a UAE employment record");
    const empcloudUser = await findUserById(Number(exit.employee_id));
    if (!empcloudUser || Number(empcloudUser.organization_id) !== Number(orgId))
      throw new AppError(
        409,
        "INVALID_EMPLOYEE_LINK",
        "The linked EmpCloud employee must belong to this organisation",
      );
    if (
      !["active", "offboarding"].includes(employee.status) ||
      !["eor", "direct_hire"].includes(employee.employment_type)
    )
      throw new AppError(
        409,
        "INVALID_UAE_EMPLOYMENT",
        "The selected employment is not eligible for UAE employee payroll preparation",
      );
    if (employee.salary_currency !== "AED" || employee.salary_frequency !== "monthly")
      throw new AppError(400, "INVALID_UAE_SALARY", "UAE settlement requires monthly AED salary");
    const year = Number(lastWorkingDate.slice(0, 4)),
      month = Number(lastWorkingDate.slice(5, 7));
    if (year * 100 + month < 202606 || year > 2100)
      throw new AppError(400, "UNSUPPORTED_UAE_PERIOD", "UAE settlement supports June 2026 onward");
    const profile = selectUaeProfile(employee, month, year);
    if (employee.contract_type === "part_time" && profile.workPattern !== "part_time")
      throw new AppError(
        400,
        "INVALID_UAE_WORK_PATTERN",
        "The UAE profile must identify part-time employment",
      );
    const calculation = calculateUaePayroll(profile, input, {
      month,
      year,
      startDate: isoDate(employee.start_date),
      endDate: lastWorkingDate,
    });
    const run = await this.periodRun(orgId, employee.country_id, month, year);
    const previousItems = await this.all("global_payroll_items", {
      empcloud_org_id: Number(orgId),
      global_employee_id: employee.id,
    });
    for (const item of previousItems) {
      if (item.payroll_run_id === run?.id) continue;
      const earlierInput = readUaeJson<UaePeriodInput | null>(item.uae_input, null);
      if (!earlierInput?.finalSettlement) continue;
      const earlierRun = await this.db.findOne<Row>("global_payroll_runs", {
        id: item.payroll_run_id,
        empcloud_org_id: Number(orgId),
        country_id: employee.country_id,
      });
      if (earlierRun && earlierRun.status !== "cancelled")
        throw new AppError(
          409,
          "UAE_SETTLEMENT_ALREADY_EXISTS",
          "This employment already has a final settlement in another payroll period. Reconcile that run before preparing another settlement; a rehire needs a separate employment record.",
        );
    }
    if (run && run.status !== "draft")
      throw new AppError(
        409,
        "IMMUTABLE_PAYROLL",
        "Unlock a locked payroll draft before preparing settlement; approved or paid payroll cannot be changed",
      );
    const prepared: UaeExitPreparation = {
      globalEmployeeId: employee.id,
      countryId: employee.country_id,
      month,
      year,
      uaeInput: input,
      uaeProfile: profile,
      calculation,
      preparedAt: new Date().toISOString(),
      preparedBy: actor,
      ...(run ? { runId: run.id } : {}),
    };
    return this.db.transaction(async () => {
      const employeeUpdated = await this.db.updateMany(
        "global_employees",
        {
          id: employee.id,
          empcloud_org_id: Number(orgId),
          empcloud_user_id: Number(exit.employee_id),
          status: employee.status,
          ...(employee.updated_at ? { updated_at: employee.updated_at } : {}),
        },
        { end_date: lastWorkingDate, status: "offboarding", updated_at: new Date() },
      );
      if (!employeeUpdated)
        throw new AppError(
          409,
          "EMPLOYEE_CHANGED",
          "Employment changed; refresh before preparing settlement",
        );
      const exitUpdated = await this.db.updateMany(
        "employee_exits",
        {
          id: exitId,
          org_id: Number(orgId),
          status: exit.status,
          last_working_date: exit.last_working_date,
          ...(exit.updated_at ? { updated_at: exit.updated_at } : {}),
        },
        { uae_settlement: JSON.stringify(prepared), updated_at: new Date() },
      );
      if (!exitUpdated)
        throw new AppError(
          409,
          "EXIT_CHANGED",
          "Exit changed; refresh before preparing settlement",
        );
      if (run) {
        // Claim the draft revision before reading/replacing its inputs. The outer transaction
        // holds this write until both employment preparation and recalculation have succeeded.
        const claimed = await this.db.updateMany(
          "global_payroll_runs",
          {
            id: run.id,
            empcloud_org_id: Number(orgId),
            status: "draft",
            uae_revision: run.uae_revision,
          },
          { uae_revision: Number(run.uae_revision) + 1 },
        );
        if (!claimed)
          throw new AppError(
            409,
            "PAYROLL_CHANGED",
            "Payroll changed; refresh before preparing settlement",
          );
        const inputs = readUaeJson<Record<string, UaePeriodInput>>(run.uae_inputs, {});
        await new UaePayrollService(this.db).recalculate(
          orgId,
          run.id,
          { ...inputs, [employee.id]: input },
          actor,
        );
      }
      return prepared;
    });
  }
}
