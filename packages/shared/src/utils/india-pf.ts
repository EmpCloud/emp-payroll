import {
  PF_WAGE_CEILING,
  PF_PREVIOUS_WAGE_CEILING,
  PF_WAGE_CEILING_EFFECTIVE_DATE,
  PF_EMPLOYEE_RATE,
  PF_EMPLOYER_RATE,
  PF_EMPLOYER_EPS_RATE,
  PF_ADMIN_CHARGES_RATE,
  PF_EDLI_CHARGES_RATE,
} from "../constants/india";
import type { ComputeIndiaPFParams, PFContribution, IndiaPFPeriod } from "../types/index";

const DAY = 86_400_000;
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const rupees = (value: number) => Math.round(value + 1e-8);
const iso = (value: number) => new Date(value).toISOString().slice(0, 10);

function dateValue(value: string): number {
  const day = value.slice(0, 10);
  const result = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(result) || iso(result) !== day) {
    throw new Error(`Invalid PF date: ${value}`);
  }
  return result;
}

function nonnegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a nonnegative number`);
  return value;
}

function monthBounds(year: number, month: number) {
  if (
    !Number.isInteger(year) ||
    year < 1900 ||
    year > 9998 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    throw new Error("Invalid PF wage month");
  }
  return { start: Date.UTC(year, month - 1, 1), end: Date.UTC(year, month, 0) };
}

export function getIndiaPFWageCeiling(date: string): number {
  // S.O. 5109(E): https://www.labour.gov.in/static/uploads/2026/09/2b0f1dbbd3769fc388416186ec145328.pdf
  return dateValue(date) < dateValue(PF_WAGE_CEILING_EFFECTIVE_DATE)
    ? PF_PREVIOUS_WAGE_CEILING
    : PF_WAGE_CEILING;
}

export function getIndiaPFDueDate(year: number, month: number): string {
  // EPFO circular e-704368, 13 October 2026 (September only):
  // https://compliancehub.sankhlaco.com/api/public/library/v1/documents/db710ec5-0b8a-4c34-b3e9-95aa722a3735
  monthBounds(year, month);
  return year === 2026 && month === 9 ? "2026-10-31" : iso(Date.UTC(year, month, 15));
}

/** Effective-dated ordinary EPF/EPS/EDLI calculation; wagePeriods carry earned, not contracted, wages. */
export function computeIndiaPF(params: ComputeIndiaPFParams): PFContribution {
  // September split: https://pmvbry-cdn.epfindia.gov.in/wp-content/uploads/2026/09/EPFO_Wage_Ceiling_FAQs.pdf (Q7-9).
  // EPS enrollment amendment G.S.R. 847(E): https://www.staffnews.in/wp-content/uploads/2026/09/276595.pdf
  // G.S.R. 890(E) keeps government EPS wages separate: https://www.staffnews.in/wp-content/uploads/2026/10/277193.pdf
  const { employeeId, year, month, pfDetails: details = {}, orgOverrides: org = {} } = params;
  const { start, end } = monthBounds(year, month);
  const revisedOn = dateValue(PF_WAGE_CEILING_EFFECTIVE_DATE);
  const days = (end - start) / DAY + 1;
  const earned =
    nonnegative(params.basicSalary, "Basic salary") +
    nonnegative(params.daAmount ?? 0, "DA") +
    nonnegative(params.retainingAllowance ?? 0, "Retaining allowance");
  const monthlyWages = nonnegative(params.monthlyWages ?? earned, "Monthly PF wages");
  const membershipWages = nonnegative(details.membershipWages ?? monthlyWages, "Membership wages");
  const joined = params.dateOfJoining ? dateValue(params.dateOfJoining) : start;
  const exited = params.dateOfExit ? dateValue(params.dateOfExit) : end;
  const pfStart = details.pfMembershipDate ? dateValue(details.pfMembershipDate) : joined;
  const epsStart = details.epsMembershipDate ? dateValue(details.epsMembershipDate) : pfStart;
  const optedOut = details.isOptedOut === true || details.exclusionReason != null;
  const newlyCovered =
    details.exclusionReason === "wage_ceiling" &&
    details.membershipWages != null &&
    membershipWages > PF_PREVIOUS_WAGE_CEILING &&
    membershipWages <= PF_WAGE_CEILING;
  const newlyEps =
    details.epsExclusionReason === "wage_ceiling" &&
    details.membershipWages != null &&
    membershipWages > PF_PREVIOUS_WAGE_CEILING &&
    membershipWages <= PF_WAGE_CEILING;
  const warnings: string[] = [];
  if (Math.min(end, exited) >= revisedOn && joined <= end) {
    if (
      details.membershipWages == null &&
      (details.exclusionReason === "wage_ceiling" || details.epsExclusionReason === "wage_ceiling")
    ) {
      warnings.push(
        "Review PF/EPS eligibility: record statutory monthly wages at 17 September 2026 (or a later entry/review date) as membership wages before processing a wage-ceiling exclusion.",
      );
    }
    if (optedOut && !details.exclusionReason) {
      warnings.push(
        "Review PF exclusion: specify wage ceiling or statutory exemption before processing this employee.",
      );
    }
    if (
      details.isEpsMember === false &&
      !details.epsExclusionReason &&
      details.exclusionReason !== "exempt"
    ) {
      warnings.push(
        "Review EPS exclusion: specify wage ceiling or other ineligibility before processing this employee.",
      );
    }
    if (
      details.membershipWages != null &&
      (details.exclusionReason === "wage_ceiling" ||
        details.epsExclusionReason === "wage_ceiling") &&
      membershipWages <= PF_PREVIOUS_WAGE_CEILING
    ) {
      warnings.push(
        "Review PF/EPS membership wages: wages at or below the former 15,000 ceiling do not establish an exclusion caused by that ceiling.",
      );
    }
  }
  if (
    params.dateOfJoining &&
    joined >= revisedOn &&
    joined <= end &&
    exited >= start &&
    membershipWages > PF_WAGE_CEILING &&
    !optedOut &&
    details.isEpsMember == null &&
    !details.epsMembershipDate &&
    !details.epsExclusionReason
  ) {
    warnings.push(
      "Review EPS history for this above-ceiling new hire: confirm prior EPS membership or record wage-ceiling exclusion.",
    );
  }
  const requestedRate = nonnegative(
    params.contributionRate ??
      details.contributionRate ??
      org.pfDefaultEmployeeRate ??
      PF_EMPLOYEE_RATE,
    "PF employee rate",
  );
  const employerRate = nonnegative(
    params.employerContributionRate ?? details.employerContributionRate ?? PF_EMPLOYER_RATE,
    "PF employer rate",
  );
  const revisedEmployerRate = employerRate === 10 ? 10 : PF_EMPLOYER_RATE;
  const vpfRate = nonnegative(params.vpfRate ?? details.vpfRate ?? 0, "VPF rate");
  const voluntary = params.isVoluntaryPF ?? details.isVoluntaryPF ?? false;
  const contributionCap =
    org.pfMaxEmployeeContribution == null
      ? undefined
      : nonnegative(org.pfMaxEmployeeContribution, "PF employee contribution cap");

  const wagePeriods =
    params.wagePeriods ??
    (Math.max(start, joined) <= Math.min(end, exited)
      ? [
          {
            startDate: iso(Math.max(start, joined)),
            endDate: iso(Math.min(end, exited)),
            wages: earned,
          },
        ]
      : []);
  const wageDays = new Map<number, number>();
  for (const period of wagePeriods) {
    const from = dateValue(period.startDate);
    const to = dateValue(period.endDate);
    if (from < start || to > end || from > to)
      throw new Error("PF wage periods must be within the wage month");
    const dailyWage = nonnegative(period.wages, "Period PF wages") / ((to - from) / DAY + 1);
    for (let date = from; date <= to; date += DAY) {
      if (wageDays.has(date)) throw new Error("PF wage periods must not overlap");
      wageDays.set(date, dailyWage);
    }
  }

  const windows =
    start < revisedOn && end >= revisedOn
      ? [
          [start, revisedOn - DAY],
          [revisedOn, end],
        ]
      : [[start, end]];
  let employeeRaw = 0,
    employerRaw = 0,
    epsRaw = 0,
    adminRaw = 0,
    edliRaw = 0,
    vpfRaw = 0;
  const periods: IndiaPFPeriod[] = [];
  for (const [from, to] of windows) {
    const revised = from >= revisedOn;
    const ceiling = getIndiaPFWageCeiling(iso(from));
    const fraction = ((to - from) / DAY + 1) / days;
    // Ceiling windows follow calendar dates; unpaid absence reduces earned wages, not this ceiling again.
    const cap = ceiling * fraction;
    let wages = 0,
      coveredWages = 0,
      pensionWages = 0,
      isCovered = false,
      isEpsMember = false;
    for (let date = from; date <= to; date += DAY) {
      if (date < joined || date > exited) continue;
      const wage = wageDays.get(date) ?? 0;
      wages += wage;
      const covered = date >= pfStart && (!optedOut || (newlyCovered && date >= revisedOn));
      const pensionExcluded = details.isEpsMember === false || details.epsExclusionReason != null;
      const pension =
        covered &&
        date >= epsStart &&
        details.epsExclusionReason !== "ineligible" &&
        (!pensionExcluded || (newlyEps && date >= revisedOn));
      isCovered ||= covered;
      isEpsMember ||= pension;
      if (covered) coveredWages += wage;
      if (pension) pensionWages += wage;
    }
    const cappedWages = Math.min(coveredWages, cap);
    const pfWages = org.pfApplyFullBasic ? coveredWages : cappedWages;
    const epsWages = Math.min(pensionWages, cap);
    const edliWages = cappedWages;
    const rate = revised ? Math.max(requestedRate, revisedEmployerRate) : requestedRate;
    let employeeAmount = (pfWages * rate) / 100;
    if (contributionCap != null) {
      employeeAmount = Math.min(employeeAmount, contributionCap * fraction);
      if (revised)
        employeeAmount = Math.max(employeeAmount, (cappedWages * revisedEmployerRate) / 100);
    }
    employeeRaw += employeeAmount;
    employerRaw += (pfWages * (revised ? revisedEmployerRate : employerRate)) / 100;
    epsRaw += (epsWages * PF_EMPLOYER_EPS_RATE) / 100;
    adminRaw += ((voluntary && vpfRate > 0 ? coveredWages : pfWages) * PF_ADMIN_CHARGES_RATE) / 100;
    edliRaw += (edliWages * PF_EDLI_CHARGES_RATE) / 100;
    if (voluntary) vpfRaw += (coveredWages * vpfRate) / 100;
    periods.push({
      startDate: iso(from),
      endDate: iso(to),
      wages: money(wages),
      pfWages: money(pfWages),
      epsWages: money(epsWages),
      edliWages: money(edliWages),
      wageCeiling: ceiling,
      isCovered,
      isEpsMember,
    });
  }
  if (
    periods.some(
      (period) => period.startDate >= PF_WAGE_CEILING_EFFECTIVE_DATE && period.isCovered,
    ) &&
    ((employerRate !== 10 && employerRate !== 12) || requestedRate < revisedEmployerRate)
  ) {
    warnings.push(
      "Review PF contribution rates: use 12%, or 10% for a notified establishment; employee contribution cannot be below that rate.",
    );
  }
  const employeeEPF = rupees(employeeRaw);
  const employerEPS = rupees(epsRaw);
  const employerEPF = Math.max(0, rupees(employerRaw) - employerEPS);
  const employeeVPF = rupees(vpfRaw);
  const adminCharges = org.pfAdminEnabled === false ? 0 : rupees(adminRaw);
  const edliCharges = org.pfEdliEnabled === false ? 0 : rupees(edliRaw);
  return {
    employeeId,
    month,
    year,
    pfWages: money(periods.reduce((sum, period) => sum + period.pfWages, 0)),
    epsWages: money(periods.reduce((sum, period) => sum + period.epsWages, 0)),
    edliWages: money(periods.reduce((sum, period) => sum + period.edliWages, 0)),
    isCovered: periods.some((period) => period.isCovered),
    isEpsMember: periods.some((period) => period.isEpsMember),
    wageCeiling: getIndiaPFWageCeiling(iso(end)),
    periods,
    warnings,
    employeeEPF,
    employerEPF,
    employerEPS,
    employeeVPF,
    adminCharges,
    edliCharges,
    adminChargesEnabled: org.pfAdminEnabled !== false,
    edliChargesEnabled: org.pfEdliEnabled !== false,
    totalEmployer: employerEPF + employerEPS + adminCharges + edliCharges,
    totalEmployee: employeeEPF + employeeVPF,
  };
}
