import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import type { UaeEmployeeProfile, UaePeriodInput, UaePayrollResult } from "@emp-payroll/shared";
import { getDB } from "../../db/adapters";
import type { IDBAdapter } from "../../db/adapters/interface";
import { AppError } from "../../api/middleware/error.middleware";
import {
  uaeProfileSchema,
  uaeInputsSchema,
  uaeEmployerSchema,
  uaePaymentSchema,
  uaeScheduleSchema,
} from "../../api/validators/uae-payroll";
import { calculateUaePayroll, validateUaeProfile } from "./uae-payroll";
import { renderUaePayslip, type UaeReportingSnapshot } from "./uae-reporting";
import { exportUaeBankFile, type UaeBankFormat } from "./uae-bank-exports";
import { DEFAULT_UAE_SCHEDULE, dubaiToday, uaeCalendar, type UaeSchedule } from "./uae-calendar";

type Row = Record<string, any>;
type Employer = z.infer<typeof uaeEmployerSchema>;
type Payment = z.infer<typeof uaePaymentSchema>["body"];

export function readUaeJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new AppError(
      409,
      "INVALID_UAE_DATA",
      "Stored UAE payroll data is invalid; correct the record before proceeding",
    );
  }
}

function isoDate(value: unknown): string {
  // SQL DATE is returned at local midnight by mysql2, not as a UTC instant.
  return value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
    : String(value || "").slice(0, 10);
}
function ruleError(error: unknown): never {
  if (error instanceof AppError) throw error;
  if (error instanceof z.ZodError)
    throw new AppError(
      400,
      "INVALID_UAE_INPUT",
      error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  if (error instanceof Error) throw new AppError(400, "INVALID_UAE_PAYROLL", error.message);
  throw error;
}

export function decodeUaeEmployee(employee: Row): Row {
  return {
    ...employee,
    uae_profile: readUaeJson(employee.uae_profile, null),
    uae_profile_history: readUaeJson(employee.uae_profile_history, []),
  };
}

export function uaeProfileUpdate(employee: Row | null, data: Row, countryCode: string): Row {
  if (data.uaeProfile === undefined) {
    if (
      countryCode === "AE" &&
      employee?.uae_profile &&
      (data.salaryAmount !== undefined ||
        data.salaryFrequency !== undefined ||
        data.salaryCurrency !== undefined)
    ) {
      throw new AppError(
        400,
        "UAE_PROFILE_REQUIRED",
        "Update the UAE basic salary and allowances together with the salary",
      );
    }
    return {};
  }
  if (countryCode !== "AE")
    throw new AppError(400, "INVALID_UAE_COUNTRY", "UAE profiles are only valid for UAE employees");
  try {
    const profile = uaeProfileSchema.parse(data.uaeProfile) as UaeEmployeeProfile;
    validateUaeProfile(profile, { requirePaymentDetails: false });
    const currency = data.salaryCurrency ?? employee?.salary_currency ?? "AED";
    const frequency = data.salaryFrequency ?? employee?.salary_frequency ?? "monthly";
    if (currency !== "AED" || frequency !== "monthly")
      throw new Error("UAE statutory payroll currently requires monthly AED salary");
    const fixed =
      profile.basicSalary + profile.allowances.reduce((sum, line) => sum + line.amount, 0);
    if (fixed !== Number(data.salaryAmount ?? employee?.salary_amount))
      throw new Error("Basic salary plus fixed allowances must equal the monthly salary amount");
    const history = readUaeJson<UaeEmployeeProfile[]>(employee?.uae_profile_history, []);
    if (!history.length && employee?.uae_profile)
      history.push(readUaeJson(employee.uae_profile, null));
    // Changes within a month require a reviewed split calculation; do not silently use one rate.
    if (
      history.length &&
      !profile.effectiveFrom.endsWith("-01") &&
      profile.effectiveFrom !== history[history.length - 1].effectiveFrom
    ) {
      throw new Error("UAE profile amendments must start on the first of a month");
    }
    return {
      uae_profile: JSON.stringify(profile),
      uae_profile_history: JSON.stringify([...history, profile]),
    };
  } catch (error) {
    return ruleError(error);
  }
}

export function selectUaeProfile(employee: Row, month: number, year: number): UaeEmployeeProfile {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const applicableOn = isoDate(employee.start_date) > start ? isoDate(employee.start_date) : start;
  const history = readUaeJson<UaeEmployeeProfile[]>(employee.uae_profile_history, []);
  const current = readUaeJson<UaeEmployeeProfile | null>(employee.uae_profile, null);
  const profiles = history.length ? history : current ? [current] : [];
  const selected = profiles
    .filter((p) => p.effectiveFrom <= applicableOn)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
    .at(-1);
  if (!selected)
    throw new AppError(
      409,
      "UAE_PROFILE_REQUIRED",
      `Configure an effective UAE profile for ${employee.first_name || employee.id} before calculating payroll`,
    );
  return selected;
}

export class UaePayrollService {
  constructor(private db: IDBAdapter = getDB()) {}

  private async all(table: string, filters: Row): Promise<Row[]> {
    const rows: Row[] = [];
    for (let page = 1; ; page++) {
      const result = await this.db.findMany<Row>(table, { filters, page, limit: 1000 });
      rows.push(...result.data);
      if (rows.length >= result.total || result.data.length < 1000) return rows;
    }
  }

  private async run(orgId: string, runId: string): Promise<Row> {
    const run = await this.db.findOne<Row>("global_payroll_runs", {
      id: runId,
      empcloud_org_id: Number(orgId),
    });
    if (!run) throw new AppError(404, "NOT_FOUND", "Payroll run not found");
    const country = await this.db.findById<Row>("countries", run.country_id);
    if (country?.code !== "AE")
      throw new AppError(400, "NOT_UAE_PAYROLL", "This operation requires a UAE payroll run");
    if (!run.uae_employer)
      throw new AppError(
        409,
        "LEGACY_UAE_PAYROLL",
        "Legacy UAE runs have no statutory calculation snapshot; create a new reviewed run",
      );
    return run;
  }

  private async event(orgId: string, runId: string, kind: string, actor: string, payload: unknown) {
    await this.db.create("uae_payroll_events", {
      empcloud_org_id: Number(orgId),
      payroll_run_id: runId,
      kind,
      actor_id: actor,
      payload: JSON.stringify(payload),
    });
  }

  private async prepare(
    orgId: string,
    countryId: string,
    month: number,
    year: number,
    inputs: Record<string, UaePeriodInput>,
  ) {
    const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const employees = await this.all("global_employees", {
      empcloud_org_id: Number(orgId),
      country_id: countryId,
      status: ["active", "offboarding", "terminated"],
      employment_type: ["eor", "direct_hire"],
    });
    const included = employees.filter(
      (emp) =>
        isoDate(emp.start_date) <= periodEnd &&
        (!emp.end_date || isoDate(emp.end_date) >= periodStart) &&
        (emp.status === "active" || inputs[emp.id]?.finalSettlement),
    );
    const ids = new Set(included.map((employee) => employee.id));
    if (Object.keys(inputs).some((id) => !ids.has(id)))
      throw new AppError(
        400,
        "INVALID_UAE_EMPLOYEE",
        "Period inputs contain an employee outside this organisation, period or payroll scope",
      );
    if (!included.length)
      throw new AppError(400, "NO_EMPLOYEES", "No eligible UAE employees for this period");
    for (const employee of included.filter((row) => inputs[row.id]?.finalSettlement)) {
      const priorItems = await this.all("global_payroll_items", {
        empcloud_org_id: Number(orgId),
        global_employee_id: employee.id,
      });
      for (const item of priorItems) {
        if (!readUaeJson<UaePeriodInput>(item.uae_input, {}).finalSettlement) continue;
        const priorRun = await this.db.findOne<Row>("global_payroll_runs", {
          id: item.payroll_run_id,
          empcloud_org_id: Number(orgId),
        });
        if (
          priorRun &&
          priorRun.status !== "cancelled" &&
          (Number(priorRun.period_month) !== month || Number(priorRun.period_year) !== year)
        )
          throw new AppError(
            409,
            "UAE_SETTLEMENT_ALREADY_EXISTS",
            "This employment already has a final settlement in another period; reconcile it before preparing another settlement",
          );
      }
    }
    return included.map((employee) => {
      if (employee.salary_currency !== "AED" || employee.salary_frequency !== "monthly")
        throw new AppError(
          400,
          "INVALID_UAE_SALARY",
          "UAE statutory payroll requires monthly AED salary",
        );
      const profile = selectUaeProfile(employee, month, year);
      if (employee.contract_type === "part_time" && profile.workPattern !== "part_time")
        throw new AppError(
          400,
          "INVALID_UAE_WORK_PATTERN",
          "The UAE profile must identify part-time employment",
        );
      const input = inputs[employee.id] ?? {};
      let calculation: UaePayrollResult;
      try {
        calculation = calculateUaePayroll(profile, input, {
          month,
          year,
          startDate: isoDate(employee.start_date),
          endDate: employee.end_date ? isoDate(employee.end_date) : undefined,
        });
      } catch (error) {
        return ruleError(error);
      }
      return {
        empcloud_org_id: Number(orgId),
        global_employee_id: employee.id,
        uae_empcloud_user_id: employee.empcloud_user_id ? Number(employee.empcloud_user_id) : null,
        gross_salary: calculation.grossSalary,
        tax_amount: 0,
        social_security_employee: 0,
        social_security_employer: 0,
        pension_employee: calculation.pensionEmployee,
        pension_employer: calculation.pensionEmployer,
        health_insurance_employee: 0,
        health_insurance_employer: calculation.healthInsuranceEmployer,
        other_deductions: calculation.otherDeductions,
        net_salary: calculation.netSalary,
        total_employer_cost: calculation.totalEmployerCost,
        currency: "AED",
        uae_profile: JSON.stringify(profile),
        uae_input: JSON.stringify(input),
        uae_calculation: JSON.stringify(calculation),
        uae_employee: JSON.stringify({
          id: employee.id,
          empcloudUserId: employee.empcloud_user_id,
          name: `${employee.first_name} ${employee.last_name}`,
          email: employee.email,
          jobTitle: employee.job_title,
          bankAccount: profile.wps.accountNumber || employee.bank_account,
        }),
        uae_payment: null,
      };
    });
  }

  private totals(items: Row[]) {
    return items.reduce(
      (totals, item) => ({
        total_gross: totals.total_gross + item.gross_salary,
        total_deductions: totals.total_deductions + item.gross_salary - item.net_salary,
        total_net: totals.total_net + item.net_salary,
        total_employer_cost: totals.total_employer_cost + item.total_employer_cost,
      }),
      { total_gross: 0, total_deductions: 0, total_net: 0, total_employer_cost: 0 },
    );
  }

  async createRun(
    orgId: string,
    countryId: string,
    month: number,
    year: number,
    inputs: Record<string, UaePeriodInput> = {},
    employer?: Employer,
    actor = "system",
    schedule: UaeSchedule = DEFAULT_UAE_SCHEDULE,
  ) {
    if (
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12 ||
      !Number.isInteger(year) ||
      year * 100 + month < 202606 ||
      year > 2100
    )
      throw new AppError(
        400,
        "UNSUPPORTED_UAE_PERIOD",
        "UAE statutory runs support June 2026 onward; historical rules require a separately verified version",
      );
    try {
      inputs = uaeInputsSchema.parse(inputs) as Record<string, UaePeriodInput>;
      employer = uaeEmployerSchema.parse(employer);
      schedule = uaeScheduleSchema.parse(schedule) as UaeSchedule;
    } catch (error) {
      return ruleError(error);
    }
    const existing = await this.db.findOne<Row>("global_payroll_runs", {
      empcloud_org_id: Number(orgId),
      country_id: countryId,
      period_month: month,
      period_year: year,
    });
    if (existing)
      throw new AppError(
        409,
        "DUPLICATE_RUN",
        "A UAE payroll run already exists for this period; reconcile the existing run before creating another",
      );
    const items = await this.prepare(orgId, countryId, month, year, inputs);
    try {
      return await this.db.transaction(async () => {
        const run = await this.db.create<Row>("global_payroll_runs", {
          empcloud_org_id: Number(orgId),
          country_id: countryId,
          period_month: month,
          period_year: year,
          status: "draft",
          currency: "AED",
          exchange_rate_to_base: 1,
          ...this.totals(items),
          uae_period_key: `${orgId}:${countryId}:${year}-${month}`,
          uae_revision: 1,
          uae_inputs: JSON.stringify(inputs),
          uae_employer: JSON.stringify(employer),
          uae_schedule: JSON.stringify(schedule),
        });
        for (const item of items)
          await this.db.create("global_payroll_items", { ...item, payroll_run_id: run.id });
        await this.event(orgId, run.id, "created", actor, {
          revision: 1,
          ruleVersion: "uae-2026-06",
          inputs,
        });
        return { ...run, employee_count: items.length };
      });
    } catch (error) {
      if (["ER_DUP_ENTRY", "23505", 11000].includes((error as any)?.code))
        throw new AppError(
          409,
          "DUPLICATE_RUN",
          "A UAE payroll run already exists for this period",
        );
      throw error;
    }
  }

  async recalculate(
    orgId: string,
    runId: string,
    inputs: Record<string, UaePeriodInput>,
    actor: string,
    schedule?: UaeSchedule,
    expectedRevision?: number,
  ) {
    const run = await this.run(orgId, runId);
    if (run.status !== "draft")
      throw new AppError(409, "IMMUTABLE_PAYROLL", "Only draft UAE payroll can be recalculated");
    if (expectedRevision !== undefined && expectedRevision !== Number(run.uae_revision))
      throw new AppError(
        409,
        "PAYROLL_CHANGED",
        "Payroll inputs changed; reload the latest revision before recalculating",
      );
    try {
      inputs = uaeInputsSchema.parse(inputs) as Record<string, UaePeriodInput>;
      schedule = uaeScheduleSchema.parse(
        schedule ?? readUaeJson(run.uae_schedule, DEFAULT_UAE_SCHEDULE),
      ) as UaeSchedule;
    } catch (error) {
      return ruleError(error);
    }
    const items = await this.prepare(
      orgId,
      run.country_id,
      run.period_month,
      run.period_year,
      inputs,
    );
    return this.db.transaction(async () => {
      const locked = await this.db.updateMany(
        "global_payroll_runs",
        {
          id: runId,
          empcloud_org_id: Number(orgId),
          status: "draft",
          uae_revision: run.uae_revision,
        },
        { status: "processing" },
      );
      if (!locked)
        throw new AppError(409, "PAYROLL_CHANGED", "Payroll changed; refresh before recalculating");
      const previous = await this.all("global_payroll_items", {
        payroll_run_id: runId,
        empcloud_org_id: Number(orgId),
      });
      await this.event(orgId, runId, "recalculated", actor, {
        previousRevision: run.uae_revision,
        previousItems: previous,
        inputs,
      });
      await this.db.deleteMany("global_payroll_items", {
        payroll_run_id: runId,
        empcloud_org_id: Number(orgId),
      });
      for (const item of items)
        await this.db.create("global_payroll_items", { ...item, payroll_run_id: runId });
      return this.db.update("global_payroll_runs", runId, {
        ...this.totals(items),
        status: "draft",
        uae_inputs: JSON.stringify(inputs),
        uae_schedule: JSON.stringify(schedule),
        uae_revision: Number(run.uae_revision) + 1,
      });
    });
  }

  async lock(orgId: string, runId: string, expectedRevision: number, actor: string) {
    return this.transition(orgId, runId, expectedRevision, actor, "draft", "locked");
  }

  async unlock(
    orgId: string,
    runId: string,
    expectedRevision: number,
    reason: string,
    actor: string,
  ) {
    if (!reason?.trim())
      throw new AppError(400, "REASON_REQUIRED", "Explain why payroll must be unlocked");
    return this.transition(orgId, runId, expectedRevision, actor, "locked", "draft", reason);
  }

  private async transition(
    orgId: string,
    runId: string,
    expectedRevision: number,
    actor: string,
    from: string,
    to: string,
    reason?: string,
  ) {
    const run = await this.run(orgId, runId);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1)
      throw new AppError(400, "REVISION_REQUIRED", "Provide the payroll revision you reviewed");
    if (to !== "draft" && run.status === from && Number(run.uae_revision) === expectedRevision) {
      const saved = await this.all("global_payroll_items", {
        payroll_run_id: runId,
        empcloud_org_id: Number(orgId),
      });
      const fresh = await this.prepare(
        orgId,
        run.country_id,
        Number(run.period_month),
        Number(run.period_year),
        readUaeJson(run.uae_inputs, {}),
      );
      if (
        saved.length !== fresh.length ||
        fresh.some((item) => {
          const previous = saved.find((row) => row.global_employee_id === item.global_employee_id);
          return (
            !previous ||
            ["uae_profile", "uae_calculation", "uae_employee", "uae_input"].some(
              (key) =>
                // JSON columns may reorder object keys when snapshots are stored.
                !isDeepStrictEqual(readUaeJson(previous[key], null), readUaeJson(item[key], null)),
            )
          );
        })
      )
        throw new AppError(
          409,
          "STALE_UAE_INPUTS",
          "Employee or exit details changed; unlock if necessary and recalculate payroll before approval",
        );
    }
    return this.db.transaction(async () => {
      const updated = await this.db.updateMany(
        "global_payroll_runs",
        { id: runId, empcloud_org_id: Number(orgId), status: from, uae_revision: expectedRevision },
        {
          status: to,
          uae_revision: expectedRevision + 1,
          ...(to === "approved" ? { approved_by: Number(actor) } : {}),
        },
      );
      if (!updated)
        throw new AppError(
          409,
          "PAYROLL_CHANGED",
          `Payroll must be ${from} at the reviewed revision; refresh before continuing`,
        );
      await this.event(orgId, runId, to === "draft" ? "unlocked" : to, actor, {
        revision: expectedRevision + 1,
        previousRevision: run.uae_revision,
        reason,
      });
      return this.db.findById("global_payroll_runs", runId);
    });
  }

  async approve(orgId: string, runId: string, actor: string, expectedRevision?: number) {
    return this.transition(orgId, runId, expectedRevision!, actor, "locked", "approved");
  }

  async calendar(orgId: string, run: Row) {
    const items = await this.all("global_payroll_items", {
      payroll_run_id: run.id,
      empcloud_org_id: Number(orgId),
    });
    const dueDates = items
      .map(
        (item) => readUaeJson<UaePayrollResult | null>(item.uae_calculation, null)?.paymentDueDate,
      )
      .filter((date): date is string => !!date)
      .sort();
    return dueDates.length
      ? uaeCalendar(dueDates[0], run.status, readUaeJson(run.uae_schedule, DEFAULT_UAE_SCHEDULE))
      : null;
  }

  async details(orgId: string, run: Row, items: Row[]) {
    items = await this.all("global_payroll_items", {
      payroll_run_id: run.id,
      empcloud_org_id: Number(orgId),
    });
    const decoded: Row[] = items.map((item) => ({
      ...item,
      uae_profile: readUaeJson(item.uae_profile, null),
      uae_calculation: readUaeJson(item.uae_calculation, null),
      uae_input: readUaeJson(item.uae_input, {}),
      uae_employee: readUaeJson<Row | null>(item.uae_employee, null),
      uae_payment: readUaeJson<Row | null>(item.uae_payment, null),
    }));
    const events = await this.all("uae_payroll_events", {
      payroll_run_id: run.id,
      empcloud_org_id: Number(orgId),
    });
    return {
      uae_inputs: readUaeJson(run.uae_inputs, {}),
      uae_employer: readUaeJson(run.uae_employer, null),
      uae_schedule: readUaeJson(run.uae_schedule, DEFAULT_UAE_SCHEDULE),
      uae_calendar: await this.calendar(orgId, run),
      items: decoded.map((item) => ({
        ...item,
        employee_name: item.uae_employee?.name || item.employee_name,
        employee_email: item.uae_employee?.email || item.employee_email,
      })),
      payment_summary: this.paymentSummary(decoded),
      uae_events: events.map((event) => ({ ...event, payload: readUaeJson(event.payload, {}) })),
    };
  }

  private paymentSummary(items: Row[]) {
    let paidAmount = 0,
      netDue = 0,
      wpsDue = 0,
      wpsPaid = 0;
    let uncertainAllocation = false;
    for (const item of items) {
      const calculation = readUaeJson<UaePayrollResult | null>(item.uae_calculation, null);
      const payment = readUaeJson<Row | null>(item.uae_payment, null);
      const paid = payment?.status === "paid" ? Number(payment.paidAmount) : 0;
      netDue += Number(item.net_salary);
      paidAmount += paid;
      if (calculation?.jurisdiction === "federal" && !calculation.wps.exemption) {
        const nonWages = calculation.earnings
          .filter((line) => ["reimbursement", "settlement"].includes(line.category))
          .reduce((sum, line) => sum + line.amount, 0);
        wpsDue += calculation.grossSalary - nonWages;
        const onTimePaid =
          payment?.status === "paid"
            ? Number(
                payment.onTimePaidAmount ??
                  (payment.paidOn <= calculation.paymentDueDate ? paid : 0),
              )
            : 0;
        if (nonWages > 0 && onTimePaid > 0 && onTimePaid < Number(item.net_salary))
          uncertainAllocation = true;
        wpsPaid += Math.max(0, onTimePaid - nonWages);
      }
    }
    return {
      paidAmount,
      netDue,
      fullyPaid:
        items.length > 0 &&
        items.every((item) => {
          const payment = readUaeJson<Row | null>(item.uae_payment, null);
          return (
            Number(item.net_salary) === 0 ||
            (payment?.status === "paid" && Number(payment.paidAmount) === Number(item.net_salary))
          );
        }),
      wpsThresholdMet: wpsDue === 0 || uncertainAllocation ? null : wpsPaid * 100 >= wpsDue * 85,
      wpsPaidOnTime: uncertainAllocation ? null : wpsPaid,
      wpsWagesDue: wpsDue,
      warnings: uncertainAllocation
        ? [
            "Review the bank's allocation of partial payments between wages and non-wage amounts before assessing the WPS threshold.",
          ]
        : [],
    };
  }

  async recordPayment(orgId: string, runId: string, payment: Payment, actor: string) {
    try {
      payment = uaePaymentSchema.parse({ body: payment }).body;
    } catch (error) {
      return ruleError(error);
    }
    const run = await this.run(orgId, runId);
    if (!["approved", "paid"].includes(run.status))
      throw new AppError(
        409,
        "INVALID_STATUS",
        "Approve payroll before recording payment evidence",
      );
    return this.db.transaction(async () => {
      const locked = await this.db.updateMany(
        "global_payroll_runs",
        {
          id: runId,
          empcloud_org_id: Number(orgId),
          status: run.status,
          uae_revision: run.uae_revision,
        },
        { uae_revision: Number(run.uae_revision) + 1 },
      );
      if (!locked)
        throw new AppError(409, "PAYROLL_CHANGED", "Payment evidence changed; refresh and retry");
      const items = await this.all("global_payroll_items", {
        payroll_run_id: runId,
        empcloud_org_id: Number(orgId),
      });
      const item = items.find((row) => row.global_employee_id === payment.employeeId);
      if (!item) throw new AppError(404, "NOT_FOUND", "Employee is not in this payroll run");
      const previous = readUaeJson<Row | null>(item.uae_payment, null);
      if (payment.paidAmount > Number(item.net_salary))
        throw new AppError(
          400,
          "INVALID_PAYMENT",
          "Disbursed amount cannot exceed approved net pay",
        );
      if (payment.status === "refunded" && previous?.status !== "paid")
        throw new AppError(400, "INVALID_PAYMENT", "A refund requires a previous disbursement");
      if (
        payment.status === "paid" &&
        previous?.status === "paid" &&
        payment.paidAmount < previous.paidAmount
      )
        throw new AppError(
          409,
          "INVALID_PAYMENT",
          "Record a full refund before reducing a confirmed disbursement",
        );
      if (previous?.status === "paid" && !["paid", "refunded"].includes(payment.status))
        throw new AppError(
          409,
          "INVALID_PAYMENT",
          "Record a refund before replacing a disbursement with another status",
        );
      if (payment.status === "refunded" && payment.paidAmount !== previous?.paidAmount)
        throw new AppError(
          400,
          "INVALID_PAYMENT",
          "Record a full reversal of the confirmed disbursement; then record the corrected total",
        );
      if (payment.status === "refunded" && payment.paidOn! < previous?.paidOn)
        throw new AppError(
          400,
          "INVALID_PAYMENT_DATE",
          "A refund cannot precede the confirmed disbursement",
        );
      if (payment.paidOn && payment.paidOn > dubaiToday())
        throw new AppError(
          400,
          "INVALID_PAYMENT_DATE",
          "Disbursement evidence cannot be dated in the future",
        );
      const calculation = readUaeJson<UaePayrollResult>(item.uae_calculation, null);
      const previousPaid = previous?.status === "paid" ? Number(previous.paidAmount) : 0;
      const previousOnTime =
        previous?.status === "paid"
          ? Number(
              previous.onTimePaidAmount ??
                (previous.paidOn <= calculation.paymentDueDate ? previousPaid : 0),
            )
          : 0;
      const onTimePaidAmount =
        payment.status === "paid"
          ? previousOnTime +
            (payment.paidOn <= calculation.paymentDueDate ? payment.paidAmount - previousPaid : 0)
          : 0;
      const evidence = {
        ...payment,
        onTimePaidAmount,
        recordedAt: new Date().toISOString(),
        recordedBy: actor,
      };
      await this.db.update("global_payroll_items", item.id, {
        uae_payment: JSON.stringify(evidence),
      });
      item.uae_payment = evidence;
      const summary = this.paymentSummary(items);
      await this.event(orgId, runId, "payment", actor, { ...evidence, previous });
      await this.db.update("global_payroll_runs", runId, {
        status: summary.fullyPaid ? "paid" : "approved",
        paid_at: summary.fullyPaid ? new Date() : null,
      });
      return { payment: evidence, payment_summary: summary };
    });
  }

  private reportingSnapshot(run: Row, item: Row): UaeReportingSnapshot {
    const calculation = readUaeJson<UaePayrollResult>(item.uae_calculation, null);
    if (!calculation)
      throw new AppError(
        409,
        "MISSING_UAE_SNAPSHOT",
        "This payroll item has no approved UAE calculation",
      );
    const profile = readUaeJson<UaeEmployeeProfile>(item.uae_profile, null);
    const variableGross = calculation.earnings
      .filter((line) => line.category === "variable" || line.category === "reimbursement")
      .reduce((sum, line) => sum + line.amount, 0);
    const variableIncome = Math.min(variableGross, calculation.netSalary);
    const variableBreakdown = {
      housing: 0,
      conveyance: 0,
      medical: 0,
      annualPassage: 0,
      overtime: 0,
      other: 0,
      leaveEncashment: 0,
    };
    let remainingVariable = variableIncome;
    // Payroll deductions reduce fixed income first, then the ordered variable lines.
    // This deterministic payable allocation always reconciles EVP to EDR variable pay.
    for (const line of calculation.earnings.filter(
      (line) => line.category === "variable" || line.category === "reimbursement",
    )) {
      const payable = Math.min(line.amount, remainingVariable);
      variableBreakdown[line.wpsCategory ?? (line.code === "OVERTIME" ? "overtime" : "other")] +=
        payable;
      remainingVariable -= payable;
    }
    return {
      approvalStatus: run.status,
      employer: readUaeJson(run.uae_employer, null),
      employee: readUaeJson(item.uae_employee, null),
      year: run.period_year,
      month: run.period_month,
      periodStart: `${run.period_year}-${String(run.period_month).padStart(2, "0")}-01`,
      periodEnd: new Date(Date.UTC(run.period_year, run.period_month, 0))
        .toISOString()
        .slice(0, 10),
      currency: "AED",
      grossPay: calculation.grossSalary,
      totalDeductions: calculation.totalDeductions,
      netPay: calculation.netSalary,
      earnings: calculation.earnings.map((line) => ({ label: line.name, amount: line.amount })),
      deductions: calculation.deductions.map((line) => ({ label: line.name, amount: line.amount })),
      employerBenefits: calculation.employerContributions.map((line) => ({
        label: line.name,
        amount: line.amount,
      })),
      dueDate: calculation.paymentDueDate,
      ...(calculation.finalSettlement
        ? {
            finalSettlement: [
              { label: "Gratuity", amount: calculation.finalSettlement.gratuity },
              { label: "Unused leave", amount: calculation.finalSettlement.leaveEncashment },
              {
                label: calculation.finalSettlement.noticePay < 0 ? "Notice recovery" : "Notice pay",
                amount: Math.abs(calculation.finalSettlement.noticePay),
              },
            ],
          }
        : {}),
      wps: {
        scope:
          profile.jurisdiction !== "federal"
            ? "outside_mohre"
            : profile.wps.exemption
              ? "exempt"
              : "mohre",
        exemptionReason:
          profile.jurisdiction !== "federal"
            ? `${profile.jurisdiction.toUpperCase()} employment jurisdiction`
            : profile.wps.exemption?.reason,
        exemptionEvidence: profile.wps.exemption?.reference,
        employeeId: profile.wps.employeeId,
        agentRoutingCode: profile.wps.routingCode,
        account: profile.wps.accountNumber,
        fixedIncome: calculation.netSalary - variableIncome,
        variableIncome,
        unpaidLeaveDays: calculation.unpaidDays,
        variableBreakdown,
        wagesDue:
          calculation.grossSalary -
          calculation.earnings
            .filter((line) => ["reimbursement", "settlement"].includes(line.category))
            .reduce((sum, line) => sum + line.amount, 0),
      },
    };
  }

  async payslip(orgId: string, runId: string, itemId: string) {
    const run = await this.run(orgId, runId);
    if (!["approved", "paid"].includes(run.status))
      throw new AppError(409, "INVALID_STATUS", "Approve payroll before issuing payslips");
    const item = await this.db.findOne<Row>("global_payroll_items", {
      id: itemId,
      payroll_run_id: runId,
      empcloud_org_id: Number(orgId),
    });
    if (!item) throw new AppError(404, "NOT_FOUND", "Payslip not found");
    try {
      return renderUaePayslip({
        snapshot: this.reportingSnapshot(run, item),
        paymentStatus: readUaeJson<Row | null>(item.uae_payment, null)?.status || "not_confirmed",
      });
    } catch (error) {
      return ruleError(error);
    }
  }

  async myPayslips(orgId: string, userId: string) {
    const payslips: Row[] = [];
    const items = await this.all("global_payroll_items", {
      empcloud_org_id: Number(orgId),
      uae_empcloud_user_id: Number(userId),
    });
    for (const item of items) {
      if (!item.uae_calculation) continue;
      const snapshot = readUaeJson<Row | null>(item.uae_employee, null);
      if (Number(snapshot?.empcloudUserId) !== Number(userId)) continue;
      const run = await this.db.findOne<Row>("global_payroll_runs", {
        id: item.payroll_run_id,
        empcloud_org_id: Number(orgId),
      });
      if (!run || !["approved", "paid"].includes(run.status)) continue;
      payslips.push({
        id: item.id,
        runId: run.id,
        month: run.period_month,
        year: run.period_year,
        netSalary: Number(item.net_salary),
        currency: "AED",
        paymentStatus: readUaeJson<Row | null>(item.uae_payment, null)?.status || "not_confirmed",
      });
    }
    return payslips.sort((a, b) => b.year - a.year || b.month - a.month);
  }

  async myPayslip(orgId: string, userId: string, itemId: string) {
    const item = await this.db.findOne<Row>("global_payroll_items", {
      id: itemId,
      empcloud_org_id: Number(orgId),
    });
    const snapshot = readUaeJson<Row | null>(item?.uae_employee, null);
    if (!item || !snapshot?.empcloudUserId || Number(snapshot.empcloudUserId) !== Number(userId))
      throw new AppError(404, "NOT_FOUND", "Payslip not found");
    return this.payslip(orgId, item.payroll_run_id, itemId);
  }

  async exportWps(
    orgId: string,
    runId: string,
    request: {
      employerId: string;
      employerRoutingCode: string;
      reference?: string;
      bankFormat: UaeBankFormat;
      includeEvp?: boolean;
    },
    actor: string,
  ) {
    const run = await this.run(orgId, runId);
    if (run.status !== "approved")
      throw new AppError(
        409,
        "INVALID_STATUS",
        "WPS export requires an approved, unpaid payroll run",
      );
    const items = await this.all("global_payroll_items", {
      payroll_run_id: runId,
      empcloud_org_id: Number(orgId),
    });
    if (items.some((item) => readUaeJson<Row | null>(item.uae_payment, null)?.status === "paid"))
      throw new AppError(
        409,
        "PAYMENT_ALREADY_RECORDED",
        "This run already has disbursements; reconcile with the bank before creating another payment file",
      );
    if (
      items.some((item) =>
        readUaeJson<UaePayrollResult>(item.uae_calculation, null)?.earnings.some(
          (line) => line.category === "reimbursement" && line.amount > 0,
        ),
      )
    )
      throw new AppError(
        409,
        "UAE_WPS_ALLOCATION_REQUIRED",
        "Reimbursements need a separately reviewed bank disbursement or allocation; do not classify non-wage expenses as EVP allowances",
      );
    try {
      const file = exportUaeBankFile({
        bankFormat: request.bankFormat,
        includeEvp: request.includeEvp,
        employerId: request.employerId,
        employerRoutingCode: request.employerRoutingCode,
        reference: request.reference,
        createdAt: new Date().toISOString(),
        month: run.period_month,
        year: run.period_year,
        items: items.map((item) => this.reportingSnapshot(run, item)),
      });
      await this.event(orgId, runId, "wps_exported", actor, {
        filename: file.filename,
        bankFormat: request.bankFormat,
        revision: run.uae_revision,
      });
      return file;
    } catch (error) {
      return ruleError(error);
    }
  }
}
