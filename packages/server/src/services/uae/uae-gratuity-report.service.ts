import type {
  UaeEmployeeProfile,
  UaeGratuityLiabilityResult,
  UaePayrollResult,
  UaePeriodInput,
} from "@emp-payroll/shared";
import { getDB } from "../../db/adapters";
import type { IDBAdapter } from "../../db/adapters/interface";
import { AppError } from "../../api/middleware/error.middleware";
import { computeUaeGratuityLiability } from "./uae-gratuity";
import { readUaeJson } from "./uae-payroll.service";

type Row = Record<string, any>;
const date = (value: unknown) =>
  value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
    : String(value || "").slice(0, 10);
const validDate = (value: unknown): string | null => {
  const text = date(value);
  const parsed = Date.parse(`${text}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) &&
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === text
    ? text
    : null;
};

/** Reconcile cumulative payment states at the period boundaries, rather than summing them. */
function settlementCash(
  item: Row,
  calculation: UaePayrollResult,
  events: Row[],
  periodStart: string,
  closingDate: string,
): { amount: number | null; warnings: string[] } {
  const warnings: string[] = [];
  const audits = events
    .filter((event) => event.payroll_run_id === item.payroll_run_id)
    .map((event) => ({ event, payment: readUaeJson<Row>(event.payload, {}) }))
    .filter(({ payment }) => payment.employeeId === item.global_employee_id)
    .sort((a, b) =>
      String(a.payment.recordedAt ?? a.event.created_at ?? "").localeCompare(
        String(b.payment.recordedAt ?? b.event.created_at ?? ""),
      ),
    );
  const entries: Row[] = [];
  if (audits.length) {
    // An imported payment may predate the first local audit event.
    if (audits[0].payment.previous) entries.push(audits[0].payment.previous);
    entries.push(
      ...audits.map(({ event, payment }) => ({
        ...payment,
        recordedAt: payment.recordedAt ?? event.created_at,
      })),
    );
  } else {
    const current = readUaeJson<Row | null>(item.uae_payment, null);
    if (current) entries.push(current);
  }
  const dated: { payment: Row; on: string; order: number }[] = [];
  let lastPaidOn: string | null = null;
  let priorDisbursement: Row | undefined;
  for (const [order, payment] of entries.entries()) {
    if (!["paid", "refunded"].includes(payment.status)) continue;
    let on = validDate(payment.paidOn);
    if (!on && payment.status === "refunded") {
      on = validDate(payment.recordedAt);
      warnings.push(
        "A legacy refund has no actual refund date; its recording date requires review before cash reconciliation.",
      );
    }
    if (!on) {
      warnings.push(
        "Payment audit evidence has no valid disbursement date; historical gratuity cash is unknown.",
      );
      continue;
    }
    if (payment.status === "paid") {
      if (lastPaidOn && on < lastPaidOn)
        warnings.push(
          "Backdated cumulative payment updates need a documented allocation before historical gratuity cash can be reconciled.",
        );
      lastPaidOn = on;
      priorDisbursement = payment;
    } else {
      if (!priorDisbursement || payment.paidAmount !== priorDisbursement.paidAmount)
        warnings.push(
          "A refunded settlement has no matching prior disbursement audit; verify its cash history before reconciliation.",
        );
      priorDisbursement = undefined;
      lastPaidOn = null;
    }
    dated.push({ payment, on, order });
  }
  const inPeriod = dated.filter(({ on }) => on >= periodStart && on <= closingDate);
  // A later imported reversal cannot reveal the earlier paid state without its audit history.
  if (
    !audits.length &&
    dated.some(({ payment, on }) => payment.status === "refunded" && on > closingDate)
  ) {
    warnings.push(
      "A later settlement refund has no preceding payment audit history; verify the historical cash allocation.",
    );
  }
  if (warnings.length) return { amount: null, warnings };
  if (!inPeriod.length) return { amount: 0, warnings };
  dated.sort((a, b) => a.on.localeCompare(b.on) || a.order - b.order);
  const opening = dated.filter(({ on }) => on < periodStart).at(-1)?.payment;
  const closing = dated.filter(({ on }) => on <= closingDate).at(-1)?.payment;
  const allocation = (payment: Row | undefined): number | null => {
    if (!payment || payment.status === "refunded" || payment.paidAmount === 0) return 0;
    if (
      !Number.isSafeInteger(payment.paidAmount) ||
      payment.paidAmount < 0 ||
      payment.paidAmount > calculation.netSalary
    )
      return null;
    return payment.paidAmount === calculation.netSalary
      ? calculation.finalSettlement!.gratuity
      : null;
  };
  const before = allocation(opening),
    after = allocation(closing);
  if (before == null || after == null)
    return {
      amount: null,
      warnings: [
        "A partial final payment needs a documented gratuity allocation; historical retained liability cannot yet be reconciled.",
      ],
    };
  return { amount: after - before, warnings };
}

/** Read-only monthly liability roll-forward. Missing opening history remains visible as unknown. */
export class UaeGratuityReportService {
  constructor(private db: IDBAdapter = getDB()) {}

  private async all(table: string, filters: Row): Promise<Row[]> {
    const rows: Row[] = [];
    for (let page = 1; ; page++) {
      const result = await this.db.findMany<Row>(table, { filters, page, limit: 1000 });
      rows.push(...result.data);
      if (rows.length >= result.total || result.data.length < 1000) return rows;
    }
  }

  async report(orgId: string, month: number, year: number) {
    if (
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12 ||
      !Number.isInteger(year) ||
      year < 2026 ||
      year > 2100
    )
      throw new AppError(400, "INVALID_PERIOD", "Select a valid liability report month and year");
    const country = await this.db.findOne<Row>("countries", { code: "AE" });
    const openingDate = new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
    const closingDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const employees = country
      ? await this.all("global_employees", {
          empcloud_org_id: Number(orgId),
          country_id: country.id,
          employment_type: ["eor", "direct_hire"],
        })
      : [];
    const runs = country
      ? await this.all("global_payroll_runs", {
          empcloud_org_id: Number(orgId),
          country_id: country.id,
          status: ["approved", "paid"],
        })
      : [];
    const runIds = new Set(runs.filter((run) => run.uae_employer).map((run) => run.id));
    const periodRuns = new Set(
      runs
        .filter((run) => Number(run.period_month) === month && Number(run.period_year) === year)
        .map((run) => run.id),
    );
    const approvedItems = (
      await this.all("global_payroll_items", { empcloud_org_id: Number(orgId) })
    ).filter((item) => runIds.has(item.payroll_run_id) && item.uae_calculation);
    const paymentEvents = (
      await this.all("uae_payroll_events", { empcloud_org_id: Number(orgId), kind: "payment" })
    ).filter((event) => runIds.has(event.payroll_run_id));
    const runPeriod = new Map(
      runs.map((run) => [run.id, Number(run.period_year) * 12 + Number(run.period_month)]),
    );
    const items: (UaeGratuityLiabilityResult & { employeeId: string; employeeName: string })[] = [];
    for (const employee of employees.filter((row) => date(row.start_date) <= closingDate)) {
      const history = readUaeJson<UaeEmployeeProfile[]>(employee.uae_profile_history, []);
      const current = readUaeJson<UaeEmployeeProfile | null>(employee.uae_profile, null);
      if (!history.length && current) history.push(current);
      const applicable = (on: string) =>
        history
          .filter((profile) => profile.effectiveFrom <= on)
          .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
          .at(-1);
      const ownItems = approvedItems.filter((item) => item.global_employee_id === employee.id);
      const periodItem = ownItems.find((item) => periodRuns.has(item.payroll_run_id));
      const openingItem = ownItems.find(
        (item) => runPeriod.get(item.payroll_run_id) === year * 12 + month - 1,
      );
      const approvedOpeningProfile = readUaeJson<UaeEmployeeProfile | undefined>(
        openingItem?.uae_profile,
        undefined,
      );
      const calculation = readUaeJson<UaePayrollResult | null>(periodItem?.uae_calculation, null);
      const input = readUaeJson<UaePeriodInput>(periodItem?.uae_input, {});
      const finalItem = ownItems
        .filter(
          (item) =>
            (runPeriod.get(item.payroll_run_id) ?? Infinity) <= year * 12 + month &&
            readUaeJson<UaePayrollResult>(item.uae_calculation, null)?.finalSettlement,
        )
        .sort(
          (a, b) => (runPeriod.get(b.payroll_run_id) ?? 0) - (runPeriod.get(a.payroll_run_id) ?? 0),
        )[0];
      const finalCalculation = readUaeJson<UaePayrollResult | null>(
        finalItem?.uae_calculation,
        null,
      );
      const finalInput = readUaeJson<UaePeriodInput>(finalItem?.uae_input, {});
      const finalProfile = readUaeJson<UaeEmployeeProfile | undefined>(
        finalItem?.uae_profile,
        undefined,
      );
      const closingProfile =
        readUaeJson<UaeEmployeeProfile | undefined>(periodItem?.uae_profile, undefined) ??
        finalProfile ??
        applicable(
          employee.end_date && date(employee.end_date) < closingDate
            ? date(employee.end_date)
            : closingDate,
        );
      const openingProfile =
        employee.end_date && date(employee.end_date) <= openingDate && finalProfile
          ? finalProfile
          : (approvedOpeningProfile ??
            applicable(
              employee.end_date && date(employee.end_date) < openingDate
                ? date(employee.end_date)
                : openingDate,
            ));
      // A verified baseline may be recorded later, but must describe exactly this opening date.
      const baseline = [...history]
        .reverse()
        .map((profile) => profile.gratuityHistory)
        .find((value) => value?.asOf === openingDate);
      const inactiveWholePeriod = employee.end_date && date(employee.end_date) <= openingDate;
      const warnings: string[] = [];
      let paidDuringPeriod = 0;
      let unknownCash = false;
      for (const item of ownItems) {
        const result = readUaeJson<UaePayrollResult>(item.uae_calculation, null);
        if (!result.finalSettlement) continue;
        const cash = settlementCash(item, result, paymentEvents, periodStart, closingDate);
        warnings.push(...cash.warnings);
        if (cash.amount == null) unknownCash = true;
        else paidDuringPeriod += cash.amount;
      }
      // approvedGratuity is already gross; the snapshot's payable gratuity excludes prior cash.
      const finalAmount = finalInput.finalSettlement?.approvedGratuity;
      const reviewedGross =
        finalAmount?.amount ??
        (finalCalculation?.finalSettlement
          ? finalCalculation.finalSettlement.gratuity +
            (finalInput.finalSettlement?.gratuityAlreadyPaid ?? 0)
          : undefined);
      const valuation =
        reviewedGross !== undefined
          ? {
              accruedLiability: reviewedGross,
              vestedAmount: reviewedGross,
              reference:
                finalAmount?.reference ?? `Approved final settlement ${finalItem!.payroll_run_id}`,
            }
          : undefined;
      const endedBeforeOpening = employee.end_date && date(employee.end_date) <= openingDate;
      const result = computeUaeGratuityLiability({
        month,
        year,
        startDate: date(employee.start_date),
        endDate: employee.end_date ? date(employee.end_date) : undefined,
        opening: {
          profile: openingProfile,
          cumulativeUnpaidServiceDays: baseline?.cumulativeUnpaidServiceDays,
          unpaidServiceReference: baseline?.reference,
          annualWage: baseline?.annualWage,
          ...(endedBeforeOpening && valuation ? { approvedValuation: valuation } : {}),
        },
        closing: {
          profile: closingProfile,
          cumulativeUnpaidServiceDays:
            baseline && (calculation || inactiveWholePeriod)
              ? baseline.cumulativeUnpaidServiceDays + (calculation?.unpaidDays ?? 0)
              : undefined,
          unpaidServiceReference:
            baseline && (calculation || inactiveWholePeriod)
              ? `${baseline.reference}; approved payroll ${periodItem?.payroll_run_id || "employment ended before period"}`
              : undefined,
          annualWage: input.finalSettlement?.annualWage ?? baseline?.annualWage,
          ...(valuation ? { approvedValuation: valuation } : {}),
        },
        settlementsPaidBeforePeriod: baseline?.settlementsPaid ?? 0,
        settlementsPaidDuringPeriod: paidDuringPeriod,
        settlementHistoryReference: baseline?.reference ?? "",
        ...(calculation
          ? {
              savingsContributionsDuringPeriod: {
                amount: calculation.savingsEmployer,
                reference: `Approved payroll ${periodItem!.payroll_run_id}`,
              },
            }
          : inactiveWholePeriod
            ? {
                savingsContributionsDuringPeriod: {
                  amount: 0,
                  reference: "Employment ended before period",
                },
              }
            : {}),
      });
      if (!baseline)
        warnings.push(
          `Record verified gratuity history as of ${openingDate}, including cumulative unpaid service and settlements paid.`,
        );
      if (!calculation && !inactiveWholePeriod)
        warnings.push(
          "Approve this month's payroll before using its unpaid service and employer savings amounts.",
        );
      if (warnings.length) {
        result.status = "needs_review";
        result.closingAccruedLiability =
          result.closingVestedAmount =
          result.serviceAccrual =
          result.salaryRevaluation =
          result.accrualExpense =
          result.netMovement =
            null;
        result.warnings.push(...warnings);
      }
      if (unknownCash) result.settlementsPaid = null;
      items.push({
        employeeId: employee.id,
        employeeName: `${employee.first_name} ${employee.last_name}`,
        ...result,
      });
    }
    const keys = [
      "openingAccruedLiability",
      "closingAccruedLiability",
      "serviceAccrual",
      "salaryRevaluation",
      "accrualExpense",
      "settlementsPaid",
      "netMovement",
      "employerSavingsContributions",
    ] as const;
    const totals = Object.fromEntries(
      keys.map((key) => [
        key,
        items.some(
          (item) =>
            item[key] === null || (key === "settlementsPaid" && item.status === "needs_review"),
        )
          ? null
          : items.reduce((sum, item) => sum + (item[key] ?? 0), 0),
      ]),
    );
    return {
      month,
      year,
      items,
      totals,
      warnings: [
        "Undiscounted statutory-formula provision; vested termination entitlements are shown separately. This report does not post accounting entries.",
        ...(items.some((item) => item.status === "needs_review")
          ? [
              "Resolve missing history before relying on report totals; unknown balances are not zero.",
            ]
          : []),
      ],
    };
  }
}
