import type {
  UaeGratuityLiabilityInput,
  UaeGratuityLiabilityResult,
  UaeGratuityValuationInput,
} from "@emp-payroll/shared";
import { AppError } from "../../api/middleware/error.middleware";
import { calculateUaeGratuityAmount, yearsOfService } from "./uae-payroll";

const DAY = 86_400_000;
const iso = (value: number) => new Date(value).toISOString().slice(0, 10);
const money = (value: number) => Number.isSafeInteger(value) && value >= 0;
const documented = (value: string | undefined) =>
  typeof value === "string" && value.trim().length > 0;
function date(value: string | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const result = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(result) && iso(result) === value ? result : null;
}
interface Valuation {
  accrued: number;
  vested: number;
  serviceYears: number | null;
  basis: "formula" | "frozen" | "pension" | "reviewed" | "not_employed";
}

/**
 * An undiscounted statutory-formula provision, not an actuarial valuation.
 * Salary, unpaid service and payments must come from verified historical records.
 * Fund contributions are employer costs shown separately; they never become employee deductions.
 */
export function computeUaeGratuityLiability(
  input: UaeGratuityLiabilityInput,
): UaeGratuityLiabilityResult {
  if (
    !Number.isInteger(input.year) ||
    input.year < 2026 ||
    input.year > 9997 ||
    !Number.isInteger(input.month) ||
    input.month < 1 ||
    input.month > 12
  )
    throw new AppError(
      422,
      "UAE_INPUT_INVALID",
      "Select a valid supported gratuity-liability month.",
    );
  const openingDate = Date.UTC(input.year, input.month - 1, 0);
  const closingDate = Date.UTC(input.year, input.month, 0);
  const warnings: string[] = [];
  const result: UaeGratuityLiabilityResult = {
    status: "needs_review",
    currency: "AED",
    year: input.year,
    month: input.month,
    openingDate: iso(openingDate),
    closingDate: iso(closingDate),
    openingAccruedLiability: null,
    closingAccruedLiability: null,
    openingVestedAmount: null,
    closingVestedAmount: null,
    serviceAccrual: null,
    salaryRevaluation: null,
    accrualExpense: null,
    settlementsPaid:
      Number.isSafeInteger(input.settlementsPaidDuringPeriod) &&
      documented(input.settlementHistoryReference)
        ? input.settlementsPaidDuringPeriod
        : null,
    netMovement: null,
    employerSavingsContributions: null,
    openingServiceYears: null,
    closingServiceYears: null,
    warnings,
  };
  const joined = date(input.startDate);
  const exit = input.endDate ? date(input.endDate) : null;
  if (joined == null || (input.endDate && (exit == null || exit < joined))) {
    warnings.push("Verify employment start and end dates before valuing gratuity.");
    return result;
  }
  const savingsCost = input.savingsContributionsDuringPeriod;
  if (savingsCost) {
    if (money(savingsCost.amount) && documented(savingsCost.reference))
      result.employerSavingsContributions = savingsCost.amount;
    else
      warnings.push("Employer savings contributions require their recorded amount and reference.");
  }

  const valueAt = (
    source: UaeGratuityValuationInput,
    when: number,
    label: string,
  ): Valuation | null => {
    if (when < joined) return { accrued: 0, vested: 0, serviceYears: 0, basis: "not_employed" };
    const profile = source.profile;
    if (!profile) {
      warnings.push(`${label}: the salary and scheme history is missing.`);
      return null;
    }
    const serviceEnd = exit == null ? when : Math.min(when, exit);
    const effective = date(profile.effectiveFrom);
    if (effective == null || effective > serviceEnd) {
      warnings.push(
        `${label}: the supplied profile was not effective on the valuation/employment end date.`,
      );
      return null;
    }
    const continuousStart = profile.savings?.continuousServiceStartDate
      ? date(profile.savings.continuousServiceStartDate)
      : joined;
    if (continuousStart == null || continuousStart > joined) {
      warnings.push(`${label}: verify the continuous-service start date.`);
      return null;
    }
    const review = source.approvedValuation;
    if (review) {
      if (
        !money(review.accruedLiability) ||
        !money(review.vestedAmount) ||
        review.vestedAmount > review.accruedLiability ||
        !documented(review.reference)
      ) {
        warnings.push(
          `${label}: reviewed valuation must contain valid gross accrued/vested amounts and evidence.`,
        );
        return null;
      }
      return {
        accrued: review.accruedLiability,
        vested: review.vestedAmount,
        serviceYears: null,
        basis: "reviewed",
      };
    }
    const pension = profile.pension;
    if (pension && pension.scheme !== "none") {
      if (!documented(pension.authorityReference)) {
        warnings.push(
          `${label}: national pension coverage must be confirmed with the authority record.`,
        );
        return null;
      }
    }
    if (
      ["AE", "BH", "KW", "OM", "QA", "SA"].includes(profile.nationality) &&
      !documented(pension?.authorityReference)
    ) {
      warnings.push(
        `${label}: confirm national pension coverage or its exemption before assigning gratuity.`,
      );
      return null;
    }
    if (!profile.savings) {
      warnings.push(`${label}: the gratuity or savings arrangement is missing.`);
      return null;
    }
    if (profile.savings.scheme !== "gratuity") {
      const enrollment = date(profile.savings.enrolledOn);
      if (enrollment == null || enrollment < continuousStart || enrollment > serviceEnd) {
        warnings.push(
          `${label}: the savings enrollment does not cover this valuation; supply the prior scheme profile.`,
        );
        return null;
      }
      if (enrollment === continuousStart)
        return { accrued: 0, vested: 0, serviceYears: null, basis: "frozen" };
      const frozen = profile.savings.frozenGratuity;
      const frozenDate = frozen ? date(frozen.asOf) : null;
      if (
        !frozen ||
        !money(frozen.amount) ||
        !documented(frozen.reference) ||
        frozenDate == null ||
        frozenDate < continuousStart ||
        frozenDate > enrollment
      ) {
        warnings.push(
          `${label}: verify the preserved pre-enrollment gratuity; fund contributions do not replace this historical balance.`,
        );
        return null;
      }
      return { accrued: frozen.amount, vested: frozen.amount, serviceYears: null, basis: "frozen" };
    }
    if (pension && pension.scheme !== "none")
      return { accrued: 0, vested: 0, serviceYears: null, basis: "pension" };
    if (
      profile.jurisdiction === "difc" ||
      (profile.workPattern && profile.workPattern !== "full_time") ||
      profile.pension?.sector === "government"
    ) {
      warnings.push(
        `${label}: this jurisdiction/work pattern requires a reviewed accrued and vested valuation.`,
      );
      return null;
    }
    const unpaid = source.cumulativeUnpaidServiceDays;
    if (
      unpaid == null ||
      !Number.isFinite(unpaid) ||
      unpaid < 0 ||
      unpaid > (serviceEnd - continuousStart) / DAY + 1 ||
      !documented(source.unpaidServiceReference)
    ) {
      warnings.push(
        `${label}: cumulative unpaid-service history and its evidence are required; missing history is not zero.`,
      );
      return null;
    }
    if (
      !money(profile.basicSalary) ||
      !Array.isArray(profile.allowances) ||
      profile.allowances.some((item) => !money(item.amount))
    ) {
      warnings.push(`${label}: salary history must contain nonnegative integer fils.`);
      return null;
    }
    const monthlyGross =
      profile.basicSalary + profile.allowances.reduce((total, item) => total + item.amount, 0);
    const serviceYears = yearsOfService(continuousStart, serviceEnd, unpaid);
    let accrued: number;
    try {
      accrued = calculateUaeGratuityAmount({
        jurisdiction: profile.jurisdiction,
        basicSalary: profile.basicSalary,
        monthlyGross,
        serviceYears,
        annualWage: source.annualWage,
      });
    } catch (error) {
      warnings.push(
        `${label}: ${error instanceof Error ? error.message : "Review the benefit wage."}`,
      );
      return null;
    }
    const vested = serviceYears >= 1 ? accrued : 0;
    // On termination an unvested provision is released, rather than carried as a payable.
    if (exit != null && exit <= when && serviceYears < 1) accrued = 0;
    return { accrued, vested, serviceYears, basis: "formula" };
  };

  const opening = valueAt(input.opening, openingDate, "Opening balance");
  const closing = valueAt(input.closing, closingDate, "Closing balance");
  result.openingServiceYears = opening?.serviceYears ?? null;
  result.closingServiceYears = closing?.serviceYears ?? null;
  const earlierUnpaid = input.opening.cumulativeUnpaidServiceDays;
  const laterUnpaid = input.closing.cumulativeUnpaidServiceDays;
  const activeDaysInPeriod = Math.max(
    0,
    ((exit == null ? closingDate : Math.min(exit, closingDate)) -
      Math.max(joined, openingDate + DAY)) /
      DAY +
      1,
  );
  if (
    earlierUnpaid != null &&
    laterUnpaid != null &&
    (laterUnpaid < earlierUnpaid || laterUnpaid - earlierUnpaid > activeDaysInPeriod)
  ) {
    warnings.push(
      "Cumulative unpaid service must reconcile to the active days in this month; verify the opening baseline and period attendance.",
    );
    return result;
  }
  if (
    !money(input.settlementsPaidBeforePeriod) ||
    !Number.isSafeInteger(input.settlementsPaidDuringPeriod) ||
    !documented(input.settlementHistoryReference)
  ) {
    warnings.push(
      "Verify paid gratuity settlement history, including a documented zero; approved or unpaid settlements are not cash payments.",
    );
    return result;
  }
  const paidBefore = input.settlementsPaidBeforePeriod;
  const paidThrough = paidBefore + input.settlementsPaidDuringPeriod;
  if (paidThrough < 0 || !Number.isSafeInteger(paidThrough)) {
    warnings.push(
      "Refunded gratuity exceeds verified payments to date; reconcile the cash history.",
    );
    result.settlementsPaid = null;
    return result;
  }
  if ((opening && paidBefore > opening.accrued) || (closing && paidThrough > closing.accrued)) {
    warnings.push(
      "Paid settlements exceed the assessed gross gratuity balance; reconcile the historical entitlement and payments.",
    );
    return result;
  }
  if (opening) {
    result.openingAccruedLiability = opening.accrued - paidBefore;
    result.openingVestedAmount = Math.max(0, opening.vested - paidBefore);
  }
  if (closing) {
    result.closingAccruedLiability = closing.accrued - paidThrough;
    result.closingVestedAmount = Math.max(0, closing.vested - paidThrough);
  }
  if (!opening || !closing) return result;
  result.accrualExpense = closing.accrued - opening.accrued;
  result.netMovement = result.closingAccruedLiability! - result.openingAccruedLiability!;
  if (opening.basis === "formula" && input.opening.profile && input.closing.profile) {
    if (input.opening.profile.jurisdiction !== input.closing.profile.jurisdiction) {
      warnings.push(
        "A jurisdiction change requires a reviewed split of salary revaluation and service accrual.",
      );
      return result;
    }
    // Reprice opening service only; retain the opening scheme to isolate salary revaluation.
    const repriced = valueAt(
      {
        ...input.opening,
        annualWage: input.closing.annualWage,
        profile: {
          ...input.opening.profile,
          basicSalary: input.closing.profile.basicSalary,
          allowances: input.closing.profile.allowances,
        },
      },
      openingDate,
      "Opening service at closing salary",
    );
    if (!repriced) return result;
    result.salaryRevaluation = repriced.accrued - opening.accrued;
    result.serviceAccrual = closing.accrued - repriced.accrued;
  } else {
    const salaryChanged =
      input.opening.profile &&
      input.closing.profile &&
      (input.opening.profile.basicSalary !== input.closing.profile.basicSalary ||
        JSON.stringify(input.opening.profile.allowances) !==
          JSON.stringify(input.closing.profile.allowances));
    if (opening.basis === "reviewed" && salaryChanged) {
      warnings.push(
        "A reviewed opening valuation with changed salary needs a reviewed revaluation split.",
      );
      return result;
    }
    result.salaryRevaluation = 0;
    result.serviceAccrual = result.accrualExpense;
  }
  if (result.employerSavingsContributions == null) {
    const fundScheme = input.closing.profile?.savings.scheme;
    if (fundScheme && fundScheme !== "gratuity") {
      warnings.push(
        "The employer fund contribution for this month is missing; retained gratuity balances exclude fund remittances.",
      );
      return result;
    }
    result.employerSavingsContributions = 0;
  }
  result.status = "calculated";
  return result;
}
