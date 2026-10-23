import type {
  UaeApprovedAmount,
  UaeEmployeeProfile,
  UaePayrollLine,
  UaePayrollResult,
  UaePeriodInput,
} from "@emp-payroll/shared";
import { AppError } from "../../api/middleware/error.middleware";

const DAY = 86_400_000;
const GCC = new Set(["AE", "BH", "KW", "OM", "QA", "SA"]);
const round = (value: number) => Math.round(value + 1e-8);
const sum = (lines: UaePayrollLine[]) => lines.reduce((total, line) => total + line.amount, 0);
const iso = (date: number) => new Date(date).toISOString().slice(0, 10);
const fail = (message: string, code = "UAE_REVIEW_REQUIRED"): never => {
  throw new AppError(422, code, message);
};
function date(value: string, name: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    fail(`${name} must be an ISO calendar date.`, "UAE_INPUT_INVALID");
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || iso(parsed) !== value)
    fail(`${name} is not a valid date.`, "UAE_INPUT_INVALID");
  return parsed;
}
function amount(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    fail(`${name} must be a nonnegative integer in fils.`, "UAE_INPUT_INVALID");
  return value;
}
function quantity(value: number | undefined, name: string): number {
  if (value == null) return 0;
  if (!Number.isFinite(value) || value < 0)
    fail(`${name} must be a nonnegative number.`, "UAE_INPUT_INVALID");
  return value;
}
function evidence(value: string | undefined, name: string) {
  if (typeof value !== "string" || !value.trim()) fail(`${name} requires a documented reference.`);
}
function approved(value: UaeApprovedAmount | undefined, name: string): number {
  if (!value) fail(`${name} requires an approved amount and reference.`);
  evidence(value.reference, name);
  return amount(value.amount, name);
}
function line(
  code: string,
  name: string,
  value: number,
  category: UaePayrollLine["category"],
  reference?: string,
): UaePayrollLine {
  return { code, name, amount: round(value), category, ...(reference ? { reference } : {}) };
}
export function yearsOfService(joined: number, lastDay: number, unpaidDays = 0) {
  // Employment dates are inclusive. Count anniversaries before prorating the remaining year.
  const through = lastDay + DAY - unpaidDays * DAY;
  if (through <= joined) return 0;
  const first = new Date(joined);
  let years = new Date(through).getUTCFullYear() - first.getUTCFullYear();
  let anniversary = Date.UTC(
    first.getUTCFullYear() + years,
    first.getUTCMonth(),
    first.getUTCDate(),
  );
  if (anniversary > through) {
    years--;
    anniversary = Date.UTC(first.getUTCFullYear() + years, first.getUTCMonth(), first.getUTCDate());
  }
  const next = Date.UTC(
    first.getUTCFullYear() + years + 1,
    first.getUTCMonth(),
    first.getUTCDate(),
  );
  return years + (through - anniversary) / (next - anniversary);
}

/** Undiscounted formula amount before the one-year vesting condition or paid settlements. */
export function calculateUaeGratuityAmount(input: {
  jurisdiction: "federal" | "adgm";
  basicSalary: number;
  monthlyGross: number;
  serviceYears: number;
  annualWage?: UaeApprovedAmount;
}): number {
  const { jurisdiction, basicSalary, monthlyGross, serviceYears } = input;
  let dailyBasic = basicSalary / 30;
  if (jurisdiction === "adgm") {
    const annualWage = approved(input.annualWage, "ADGM annual benefit wage");
    if (annualWage < monthlyGross * 12)
      fail("ADGM annual wage cannot be below annual contracted regular wages.");
    dailyBasic = Math.max(basicSalary * 12, annualWage / 2) / 365;
  }
  const value = round(
    dailyBasic * (Math.min(serviceYears, 5) * 21 + Math.max(0, serviceYears - 5) * 30),
  );
  return jurisdiction === "federal" ? Math.min(value, monthlyGross * 24) : value;
}

/** Validation independent of a payroll month; dated salary references are checked at calculation. */
export function validateUaeProfile(
  profile: UaeEmployeeProfile,
  { requirePaymentDetails = true }: { requirePaymentDetails?: boolean } = {},
): void {
  if (!profile || !["federal", "difc", "adgm"].includes(profile.jurisdiction))
    fail("Select the applicable UAE employment jurisdiction.");
  date(profile.effectiveFrom, "Profile effective date");
  if (!/^[A-Z]{2}$/.test(profile.nationality)) fail("Nationality must be an uppercase ISO2 code.");
  amount(profile.basicSalary, "Monthly basic salary");
  if (!Array.isArray(profile.allowances)) fail("Allowances must be an array.");
  profile.allowances.forEach((entry) => {
    evidence(entry.name, "Allowance name");
    amount(entry.amount, "Monthly allowance");
  });
  if (
    profile.basicSalary + profile.allowances.reduce((total, entry) => total + entry.amount, 0) <=
    0
  )
    fail("Contracted monthly salary must be greater than zero.");
  if (!(profile.normalDailyHours > 0 && profile.normalDailyHours <= 12))
    fail("Normal daily hours must be greater than zero and no more than 12.");
  if (profile.probationEndsOn) date(profile.probationEndsOn, "Probation end date");
  const pension = profile.pension;
  if (
    GCC.has(profile.nationality) &&
    (!pension || pension.scheme === "none") &&
    !pension?.authorityReference
  )
    fail("UAE/GCC nationals require a confirmed pension scheme or documented authority exemption.");
  if (
    pension &&
    !["none", "gpssa_old", "gpssa_new", "adpf_old", "adpf_new", "sssf", "gcc"].includes(
      pension.scheme,
    )
  )
    fail("Unsupported pension scheme.");
  if (pension?.scheme && pension.scheme !== "none") {
    if (profile.nationality === "AE" && pension.scheme === "gcc")
      fail("UAE nationals require their UAE pension authority, not GCC extension.");
    if (profile.nationality !== "AE" && !["gcc", "sssf"].includes(pension.scheme))
      fail("A UAE national pension scheme cannot be assigned to this nationality.");
    if (pension.scheme === "gcc" && !GCC.has(profile.nationality))
      fail("GCC extension requires GCC nationality.");
    date(pension.firstInsuredOn, "First insurance date");
    amount(pension.contributionSalary, "Registered pension salary");
    if (!Number.isInteger(pension.salaryYear))
      fail("Record the year of the registered pension salary.");
    evidence(pension.authorityReference, "Pension registration");
  }
  if (
    !profile.iloe ||
    !["employee_paid", "employer_collected", "exempt"].includes(profile.iloe.mode)
  )
    fail("Select the employee's ILOE payment arrangement.");
  if (profile.iloe.mode === "exempt") evidence(profile.iloe.exemptionReason, "ILOE exemption");
  if (profile.iloe.mode === "employer_collected") {
    evidence(profile.iloe.policyReference, "ILOE policy");
    date(profile.iloe.policyStartsOn, "ILOE policy start");
    if (![12, 24].includes(profile.iloe.policyMonths))
      fail("ILOE policy term must be 12 or 24 months.");
    if (
      !["monthly", "quarterly", "semi_annually", "annually", "in_full"].includes(
        profile.iloe.paymentFrequency,
      )
    )
      fail("Record the ILOE payment schedule.");
  }
  amount(profile.healthInsuranceEmployer, "Employer health insurance cost");
  if (
    !profile.savings ||
    !["gratuity", "federal_savings", "dews", "alternative"].includes(profile.savings.scheme)
  )
    fail("Select the gratuity or savings arrangement.");
  if (profile.savings.scheme !== "gratuity")
    date(profile.savings.enrolledOn, "Savings enrollment date");
  if (profile.savings.continuousServiceStartDate)
    date(profile.savings.continuousServiceStartDate, "Continuous service start");
  if (profile.savings.frozenGratuity) {
    approved(profile.savings.frozenGratuity, "Preserved gratuity");
    date(profile.savings.frozenGratuity.asOf, "Preserved gratuity date");
  }
  if (profile.savings.scheme === "alternative")
    approved(profile.savings.approvedMonthlyContribution, "Alternative savings contribution");
  if (profile.savings.scheme === "dews" && profile.jurisdiction !== "difc")
    fail("DEWS requires a DIFC employment profile.");
  if (profile.savings.scheme === "federal_savings" && profile.jurisdiction !== "federal")
    fail("Federal Savings requires a federal employment profile.");
  if (!profile.wps) fail("Record WPS details or a documented exemption.");
  if (profile.wps.exemption) {
    evidence(profile.wps.exemption.reason, "WPS exemption reason");
    evidence(profile.wps.exemption.reference, "WPS exemption");
  } else if (profile.jurisdiction === "federal" && requirePaymentDetails) {
    evidence(profile.wps.employeeId, "WPS employee identifier");
    evidence(profile.wps.routingCode, "WPS routing code");
    evidence(profile.wps.accountNumber, "WPS account");
  }
  if (
    profile.salaryPaymentDay != null &&
    (!Number.isInteger(profile.salaryPaymentDay) ||
      profile.salaryPaymentDay < 1 ||
      profile.salaryPaymentDay > 28)
  )
    fail("Salary payment day must be 1–28 of the following month.");
}

/** Pure UAE payroll arithmetic. Currency amounts are integer fils throughout. */
export function calculateUaePayroll(
  profile: UaeEmployeeProfile,
  input: UaePeriodInput,
  context: { month: number; year: number; startDate: string; endDate?: string | null },
): UaePayrollResult {
  validateUaeProfile(profile);
  const { month, year } = context;
  if (
    !Number.isInteger(year) ||
    year < 2022 ||
    year > 9997 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  )
    fail("Invalid UAE payroll month.", "UAE_INPUT_INVALID");
  const from = Date.UTC(year, month - 1, 1);
  const through = Date.UTC(year, month, 0);
  const totalDays = (through - from) / DAY + 1;
  const joined = date(context.startDate, "Employment start date");
  const exit = context.endDate ? date(context.endDate, "Employment end date") : Infinity;
  if (joined > exit) fail("Employment ends before it starts.");
  const activeStart = Math.max(joined, from);
  const activeEnd = Math.min(exit, through);
  if (activeStart > activeEnd) fail("Employee is not employed in this payroll month.");
  if (date(profile.effectiveFrom, "Profile effective date") > activeStart)
    fail(
      "This profile does not cover the complete active payroll period. Use the applicable salary history.",
    );
  if (profile.jurisdiction === "federal" && from < Date.UTC(2022, 2, 1))
    fail("Payroll before March 2022 requires the prior federal labour-law rules.");
  if (profile.jurisdiction === "adgm" && from < Date.UTC(2025, 3, 1))
    fail("ADGM payroll before April 2025 requires the prior employment regulations.");
  if (profile.workPattern === "domestic")
    fail(
      "Domestic-worker payroll requires a separately approved regime under its own employment law.",
    );
  const reviewedPattern =
    profile.workPattern === "part_time" || profile.workPattern === "temporary";
  const federalFullTime = profile.jurisdiction === "federal" && !reviewedPattern;
  if (profile.pension?.sector === "government")
    fail(
      "Government employment requires its own approved employment rules; federal here means the private-sector labour law.",
    );
  const activeDays = (activeEnd - activeStart) / DAY + 1;
  const fullMonth = activeDays === totalDays;
  const monthlyGross =
    profile.basicSalary + profile.allowances.reduce((total, entry) => total + entry.amount, 0);
  const warnings: string[] = [];
  if (
    federalFullTime &&
    profile.nationality === "AE" &&
    through >= Date.UTC(2026, 0, 1) &&
    monthlyGross < 600_000
  ) {
    if (from >= Date.UTC(2026, 6, 1) || joined >= Date.UTC(2026, 0, 1))
      fail(
        "Emirati private-sector contracted monthly wage must be at least AED 6,000 for this period.",
      );
    warnings.push(
      "Raise the Emirati contract wage to AED 6,000 by 30 June 2026; renewed/amended 2026 permits already require it.",
    );
  }
  if (reviewedPattern)
    warnings.push(
      "Salary and benefit amounts use the documented review for this non-full-time work pattern, including applicable minimum-wage eligibility.",
    );

  // Federal Decree-Law 33/2021, Articles 29–33; https://uaelegislation.gov.ae/en/legislations/1541
  const leaves = input.leaves ?? [];
  let leaveDays = 0;
  let unpaidEquivalent = quantity(input.unpaidDays, "Unpaid days");
  let actualUnpaidDays = unpaidEquivalent;
  const kinds = new Set<string>();
  for (const leave of leaves) {
    if (kinds.has(leave.kind))
      fail("Combine each leave type into one period entry to preserve entitlement thresholds.");
    kinds.add(leave.kind);
    const count = quantity(leave.days, "Leave days");
    const used = quantity(leave.usedToDate, "Leave already used");
    leaveDays += count;
    if (leave.kind === "unpaid") {
      unpaidEquivalent += count;
      actualUnpaidDays += count;
    }
    if (!federalFullTime) continue;
    const entitlement = (maximum: number) => {
      if (used + count > maximum)
        fail(
          `${leave.kind} exceeds its verified paid-leave entitlement; record excess as unpaid or obtain a reviewed calculation.`,
        );
    };
    const elapsedYears = yearsOfService(joined, activeEnd);
    switch (leave.kind) {
      case "unpaid":
        break;
      case "sick": {
        if (leave.usedToDate == null)
          fail("Sick leave requires days already used in its entitlement year.");
        if (
          !profile.probationEndsOn ||
          date(profile.probationEndsOn, "Probation end") >= activeStart
        )
          fail("Confirm completion of probation before applying statutory paid sick leave.");
        entitlement(90);
        const full = Math.max(0, Math.min(used + count, 15) - Math.min(used, 15));
        const half = Math.max(0, Math.min(used + count, 45) - Math.max(used, 15));
        unpaidEquivalent += count - full - half / 2;
        actualUnpaidDays += count - full - half;
        break;
      }
      case "maternity": {
        if (leave.usedToDate == null)
          fail("Maternity leave requires earlier days in this entitlement.");
        entitlement(60);
        const full = Math.max(0, Math.min(used + count, 45) - Math.min(used, 45));
        unpaidEquivalent += (count - full) / 2;
        break;
      }
      case "annual": {
        evidence(
          leave.entitlementReference,
          "Approved annual-leave balance including carry-forward",
        );
        if (elapsedYears < 0.5)
          fail("Annual leave before six months requires a separately reviewed arrangement.");
        break;
      }
      case "parental":
        if (leave.usedToDate == null)
          fail("Parental leave requires days already used for this birth.");
        evidence(leave.entitlementReference, "Parental leave within six months of birth");
        entitlement(5);
        break;
      case "bereavement_spouse":
        if (leave.usedToDate == null)
          fail("Bereavement leave requires days already used for this event.");
        evidence(leave.entitlementReference, "Bereavement entitlement");
        entitlement(5);
        break;
      case "bereavement_family":
        if (leave.usedToDate == null)
          fail("Bereavement leave requires days already used for this event.");
        evidence(leave.entitlementReference, "Eligible family bereavement");
        entitlement(3);
        break;
      case "study":
        if (leave.usedToDate == null)
          fail("Study leave requires days already used in this entitlement year.");
        evidence(leave.entitlementReference, "Approved study leave");
        if (elapsedYears < 2) fail("Statutory study leave requires two years of service.");
        entitlement(10);
        break;
      default:
        fail("Unsupported leave type.");
    }
  }
  if (
    leaveDays + quantity(input.unpaidDays, "Unpaid days") > activeDays ||
    unpaidEquivalent > activeDays
  )
    fail("Leave and unpaid days exceed the active calendar days. Do not count unpaid leave twice.");
  let regularBeforeLeave: number;
  if (reviewedPattern || (profile.jurisdiction !== "federal" && !fullMonth))
    regularBeforeLeave = approved(
      input.approvedAdjustments?.regularSalary,
      "Non-full-time or partial-month non-federal salary",
    );
  else regularBeforeLeave = round(monthlyGross * (fullMonth ? 1 : Math.min(1, activeDays / 30)));
  let leaveLoss = round((monthlyGross / 30) * unpaidEquivalent);
  // No fixed wages are earned during an entirely unpaid active period, including February.
  if (actualUnpaidDays === activeDays) leaveLoss = regularBeforeLeave;
  else leaveLoss = Math.min(leaveLoss, regularBeforeLeave);
  if (!federalFullTime && (leaveDays > 0 || quantity(input.unpaidDays, "Unpaid days") > 0))
    leaveLoss = approved(
      input.approvedAdjustments?.leaveDeduction,
      "Non-federal or non-full-time leave pay",
    );
  else if (input.approvedAdjustments?.leaveDeduction)
    fail("Federal statutory leave pay cannot be replaced by an arbitrary deduction override.");
  if (leaveLoss > regularBeforeLeave) fail("Leave deduction exceeds earned fixed salary.");
  const fixedEarned = regularBeforeLeave - leaveLoss;
  const earnings: UaePayrollLine[] = [];
  const earnedBasic =
    monthlyGross > 0 ? round((fixedEarned * profile.basicSalary) / monthlyGross) : 0;
  earnings.push(line("BASIC", "Basic salary", earnedBasic, "fixed"));
  let allocated = earnedBasic;
  let cumulativeContract = profile.basicSalary;
  profile.allowances.forEach((entry, index) => {
    cumulativeContract += entry.amount;
    // Cumulative allocation preserves every fils without creating a negative final allowance.
    const value = round((fixedEarned * cumulativeContract) / monthlyGross) - allocated;
    earnings.push(line(`ALLOWANCE_${index + 1}`, entry.name, value, "fixed"));
    allocated += value;
  });

  const ot = input.overtime;
  const ordinary = quantity(ot?.ordinaryHours, "Ordinary overtime hours");
  const night = quantity(ot?.nightHours, "Night overtime hours");
  const rest = quantity(ot?.restDays, "Rest days worked");
  const holidays = quantity(ot?.publicHolidayDays, "Public holidays worked");
  const restOff = quantity(ot?.compensatedRestDays, "Compensated rest days");
  const holidayOff = quantity(ot?.compensatedPublicHolidayDays, "Compensated public holidays");
  if (restOff > rest || holidayOff > holidays) fail("Compensatory leave exceeds days worked.");
  const hasOvertime = ordinary + night + rest + holidays > 0;
  let overtimePay = 0;
  if (hasOvertime) {
    evidence(ot.approvedScheduleReference, "Overtime daily/weekly limits and rest-day schedule");
    let federalMinimum = 0;
    if (federalFullTime) {
      if (profile.normalDailyHours > 8)
        fail("Federal ordinary hours above 8 require a separately approved sector regime.");
      if (ordinary + night > activeDays * 2)
        fail(
          "Overtime exceeds the ordinary two-hour daily limit; exceptional cases require separate review.",
        );
      const hourly = profile.basicSalary / 30 / profile.normalDailyHours;
      federalMinimum = round(
        hourly * (ordinary * 1.25 + night * (profile.isShiftWorker ? 1.25 : 1.5)),
      );
    }
    if (!federalFullTime || rest > restOff || holidays > holidayOff) {
      overtimePay = approved(
        input.approvedAdjustments?.overtimePay,
        "Jurisdiction/rest-day overtime compensation",
      );
    } else {
      overtimePay = federalMinimum;
      if (input.approvedAdjustments?.overtimePay) {
        const higher = approved(input.approvedAdjustments.overtimePay, "Agreed overtime pay");
        if (higher < overtimePay) fail("Approved overtime pay is below the federal minimum.");
        overtimePay = higher;
      }
    }
    if (overtimePay < federalMinimum) fail("Approved overtime pay is below the federal minimum.");
  } else if (input.approvedAdjustments?.overtimePay)
    fail("Approved overtime pay requires corresponding overtime input.");
  if (overtimePay)
    earnings.push(
      line(
        "OVERTIME",
        "Overtime",
        overtimePay,
        "variable",
        input.approvedAdjustments?.overtimePay?.reference,
      ),
    );
  for (const [index, entry] of (input.variableEarnings ?? []).entries()) {
    evidence(entry.name, "Variable earning name");
    amount(entry.amount, "Variable earning");
    if (
      entry.wpsCategory &&
      (entry.kind === "reimbursement" ||
        ![
          "housing",
          "conveyance",
          "medical",
          "annualPassage",
          "overtime",
          "other",
          "leaveEncashment",
        ].includes(entry.wpsCategory))
    )
      fail(
        "WPS variable-income categories apply only to eligible variable earnings, not reimbursements.",
      );
    earnings.push({
      ...line(
        `VARIABLE_${index + 1}`,
        entry.name,
        entry.amount,
        entry.kind === "reimbursement" ? "reimbursement" : "variable",
      ),
      ...(entry.wpsCategory ? { wpsCategory: entry.wpsCategory } : {}),
    });
  }
  const wageForDeductions = sum(earnings.filter((entry) => entry.category !== "reimbursement"));

  // GPSSA law 57/2023, ADPF 2026 consolidated law, SSSF law and GCC approved registration.
  // https://www.gpssa.gov.ae/pages/en/help/faq
  // https://www.pension.gov.ae/en-us/Brochures/Entities.pdf
  const pension = profile.pension;
  const pensionScheme = pension?.scheme ?? "none";
  let pensionSalary = 0,
    employeeRate = 0,
    employerRate = 0,
    governmentRate = 0;
  let pensionEmployee = 0,
    pensionEmployer = 0,
    pensionGovernment = 0;
  let pensionDueDate: string | null = null;
  if (pensionScheme !== "none") {
    const insuredOn = date(pension.firstInsuredOn, "First insurance date");
    if (insuredOn > activeEnd)
      fail("Pension registration starts after this active payroll period.");
    if (insuredOn > activeStart && insuredOn !== joined && !pension.approvedPeriodAmounts)
      fail("Mid-period pension coverage requires an authority-reviewed period calculation.");
    if (pension.salaryYear !== year)
      fail("Confirm the registered January/joining pension salary for this payroll year.");
    pensionSalary = pension.contributionSalary;
    let minimum = 0,
      maximum = Infinity;
    switch (pensionScheme) {
      case "gpssa_old":
        if (insuredOn >= Date.UTC(2023, 9, 31))
          fail("GPSSA old regime requires membership before 31 October 2023.");
        employeeRate = 5;
        employerRate = 12.5;
        governmentRate = 2.5;
        minimum = 100_000;
        maximum = 5_000_000;
        break;
      case "gpssa_new":
        if (insuredOn < Date.UTC(2023, 9, 31))
          fail("Review GPSSA membership history before selecting the new regime.");
        employeeRate = 11;
        governmentRate = pensionSalary < 2_000_000 ? 2.5 : 0;
        employerRate = 15 - governmentRate;
        minimum = 300_000;
        maximum = 7_000_000;
        break;
      case "adpf_old":
        if (insuredOn >= Date.UTC(2023, 11, 1))
          fail("ADPF old regime requires membership before 1 December 2023.");
        employeeRate = 5;
        employerRate = 15;
        governmentRate = 6;
        minimum = 600_000;
        maximum = 15_000_000;
        break;
      case "adpf_new":
        if (insuredOn < Date.UTC(2023, 11, 1))
          fail("Review ADPF membership history before selecting the new regime.");
        employeeRate = 11;
        employerRate = 15;
        minimum = 600_000;
        maximum = 10_000_000;
        break;
      case "sssf":
        employeeRate = 5;
        employerRate = 15;
        minimum = 400_000;
        maximum = 7_000_000;
        break;
      case "gcc": {
        const rates = pension.gcc;
        if (!rates)
          fail(
            "GCC contributions require the home authority's approved effective rates and salary limits.",
          );
        evidence(rates.reference, "GCC rates");
        if (
          date(rates.effectiveFrom, "GCC rates start") > from ||
          (rates.effectiveTo && date(rates.effectiveTo, "GCC rates end") < through)
        )
          fail("The GCC approved rates do not cover the complete payroll month.");
        for (const rate of [rates.employeeRate, rates.employerRate, rates.governmentRate ?? 0])
          if (!Number.isFinite(rate) || rate < 0 || rate > 100)
            fail("GCC contribution rates must be percentages from 0 to 100.");
        employeeRate = rates.employeeRate;
        employerRate = rates.employerRate;
        governmentRate = rates.governmentRate ?? 0;
        minimum = amount(rates.minimumSalary, "GCC minimum salary");
        maximum = amount(rates.maximumSalary, "GCC maximum salary");
        break;
      }
    }
    if (pensionSalary < minimum || pensionSalary > maximum || minimum > maximum)
      fail(
        "Registered pension salary is outside this scheme's permitted limits; confirm the authority record.",
      );
    if (pensionScheme === "sssf")
      warnings.push(
        "SSSF registration salary must reflect its approved annual increase limit and authority coverage.",
      );
    if (pensionScheme === "sssf" && profile.nationality !== "AE")
      warnings.push(
        "Non-UAE SSSF coverage relies on the documented authority registration, including eligibility as a child of an Emirati mother with the required Sharjah family record.",
      );
    const partialExit = exit >= from && exit < through;
    // Private-sector ADPF Article 64 (2026 consolidated law) and SSSF Article 12(2).
    // https://www.pension.gov.ae/ar-ae/PensionLaw/%D9%86%D8%B5%20%D8%A7%D9%84%D9%82%D8%A7%D9%86%D9%88%D9%86.pdf
    // https://og.shj.ae/TashView.aspx?I=1752845
    const noExitMonthContribution =
      partialExit && ["gpssa_old", "adpf_old", "adpf_new", "sssf"].includes(pensionScheme);
    if (!noExitMonthContribution) {
      pensionEmployee = round((pensionSalary * employeeRate) / 100);
      pensionEmployer = round((pensionSalary * employerRate) / 100);
      pensionGovernment = round((pensionSalary * governmentRate) / 100);
    }
    if (
      unpaidEquivalent > 0 ||
      leaveLoss > 0 ||
      reviewedPattern ||
      (pensionScheme === "gcc" && !fullMonth) ||
      (noExitMonthContribution && joined >= from)
    ) {
      const override = pension.approvedPeriodAmounts;
      if (!override || override.month !== month || override.year !== year)
        fail(
          "Pension treatment for unpaid/part-paid leave, a non-full-time contract, a partial GCC month or joining and leaving in one month requires the authority-approved amounts for this period.",
        );
    }
    if (pension.approvedPeriodAmounts) {
      const override = pension.approvedPeriodAmounts;
      if (override.month !== month || override.year !== year)
        fail("Pension period approval belongs to a different month.");
      evidence(override.reference, "Pension period approval");
      pensionEmployee = amount(override.employee, "Approved employee pension");
      pensionEmployer = amount(override.employer, "Approved employer pension");
      pensionGovernment = amount(override.government, "Approved government pension");
    }
    pensionDueDate = iso(Date.UTC(year, month, pensionScheme.startsWith("adpf") ? 20 : 15));
  }
  const deductions: UaePayrollLine[] = [];
  const employerContributions: UaePayrollLine[] = [];
  if (pensionEmployee)
    deductions.push(
      line(
        "PENSION",
        "Employee pension",
        pensionEmployee,
        "statutory",
        pension?.authorityReference,
      ),
    );
  if (pensionEmployer)
    employerContributions.push(
      line(
        "PENSION",
        "Employer pension",
        pensionEmployer,
        "statutory",
        pension?.authorityReference,
      ),
    );
  if (profile.healthInsuranceEmployer)
    employerContributions.push(
      line("HEALTH", "Employer health insurance", profile.healthInsuranceEmployer, "statutory"),
    );

  // ILOE is an individual subscription. Only collect an actual scheduled employer-managed payment.
  // https://iloe.ae/ and https://iloe.ae/pdf/ILOE-User-Manual.pdf
  if (input.iloeCollection) {
    if (profile.iloe.mode !== "employer_collected")
      fail("ILOE collection is only allowed for an employer-collected policy.");
    const collection = input.iloeCollection;
    const collected = approved(collection, "ILOE collection");
    const due = date(collection.dueOn, "ILOE collection due date");
    if (due < from || due > through) fail("ILOE collection belongs to a different payroll period.");
    const frequencyMonths = {
      monthly: 1,
      quarterly: 3,
      semi_annually: 6,
      annually: 12,
      in_full: profile.iloe.policyMonths,
    }[profile.iloe.paymentFrequency];
    if (collection.coverageMonths !== frequencyMonths)
      fail("ILOE collection does not match the policy payment frequency.");
    const policyStart = date(profile.iloe.policyStartsOn, "ILOE policy start");
    const policyDate = new Date(policyStart);
    const policyEnd = Date.UTC(
      policyDate.getUTCFullYear(),
      policyDate.getUTCMonth() + profile.iloe.policyMonths,
      policyDate.getUTCDate(),
    );
    if (due < policyStart || due >= policyEnd)
      fail("ILOE payment is outside the recorded policy term.");
    const dueDate = new Date(due);
    const offset =
      (dueDate.getUTCFullYear() - policyDate.getUTCFullYear()) * 12 +
      dueDate.getUTCMonth() -
      policyDate.getUTCMonth();
    const scheduledDay = Math.min(
      policyDate.getUTCDate(),
      new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth() + 1, 0)).getUTCDate(),
    );
    if (
      offset % frequencyMonths !== 0 ||
      dueDate.getUTCDate() !== scheduledDay ||
      offset + collection.coverageMonths > profile.iloe.policyMonths
    )
      fail("ILOE payment date does not match the recorded installment schedule.");
    const monthlyPremium = profile.basicSalary <= 1_600_000 ? 500 : 1000;
    const premium = monthlyPremium * collection.coverageMonths;
    const vat = due === policyStart ? round(monthlyPremium * profile.iloe.policyMonths * 0.05) : 0;
    if (
      amount(collection.premium, "ILOE premium") !== premium ||
      amount(collection.vat, "ILOE VAT") !== vat ||
      collected !== premium + vat
    )
      fail(
        "ILOE payment must match the scheduled tier premium and policy VAT collected with the first payment.",
      );
    deductions.push(
      line("ILOE", "ILOE premium and VAT", collected, "statutory", collection.reference),
    );
  }

  const savings = profile.savings;
  let savingsEmployer = 0;
  let savingsDueDate: string | null = null;
  const continuousStart = savings.continuousServiceStartDate
    ? date(savings.continuousServiceStartDate, "Continuous service start")
    : joined;
  if (continuousStart > joined)
    fail("Continuous service cannot start after the current employment starts.");
  if (
    profile.jurisdiction === "difc" &&
    savings.scheme === "gratuity" &&
    pensionScheme === "none" &&
    !savings.exemptionReference
  )
    fail(
      "DIFC employees require DEWS/a qualifying alternative or a documented exemption; gratuity alone is not the current default.",
    );
  if (savings.scheme !== "gratuity") {
    const enrollment = date(savings.enrolledOn, "Savings enrollment");
    if (enrollment > activeEnd) fail("Savings enrollment starts after this payroll period.");
    if (enrollment < continuousStart) fail("Savings enrollment predates continuous employment.");
    if (savings.scheme === "dews" && enrollment < Date.UTC(2020, 1, 1))
      fail("DEWS commencement cannot precede 1 February 2020.");
    if (savings.frozenGratuity) {
      const frozenDate = date(savings.frozenGratuity.asOf, "Preserved gratuity date");
      if (frozenDate < continuousStart || frozenDate > enrollment)
        fail(
          "Preserved gratuity must be assessed at or before enrollment and within continuous service.",
        );
    }
    if (savings.scheme === "alternative")
      savingsEmployer = approved(
        savings.approvedMonthlyContribution,
        "Alternative savings contribution",
      );
    else {
      const beforeYears = yearsOfService(continuousStart, activeStart - DAY);
      const afterYears = yearsOfService(continuousStart, activeEnd);
      if (
        !fullMonth ||
        unpaidEquivalent > 0 ||
        leaveLoss > 0 ||
        reviewedPattern ||
        enrollment > activeStart ||
        (beforeYears < 5 && afterYears > 5) ||
        pensionScheme !== "none"
      ) {
        savingsEmployer = approved(
          savings.approvedMonthlyContribution,
          "Savings contribution for partial month, leave, rate transition or national pension interaction",
        );
      } else {
        const benefitBasic =
          savings.scheme === "dews"
            ? Math.max(profile.basicSalary, monthlyGross / 2)
            : profile.basicSalary;
        savingsEmployer = round(benefitBasic * (beforeYears >= 5 ? 0.0833 : 0.0583));
      }
    }
    if (savings.scheme === "alternative")
      warnings.push(
        "Use the qualifying alternative fund's documented remittance deadline; no universal deadline is assumed.",
      );
    else savingsDueDate = iso(Date.UTC(year, month, savings.scheme === "dews" ? 21 : 15));
    employerContributions.push(
      line(
        "SAVINGS",
        "Employer savings contribution",
        savingsEmployer,
        "statutory",
        savings.approvedMonthlyContribution?.reference,
      ),
    );
  }
  if (
    profile.jurisdiction === "difc" &&
    pensionScheme !== "none" &&
    savings.scheme === "gratuity"
  ) {
    if (savings.exemptionReference)
      evidence(savings.exemptionReference, "DIFC national qualifying-scheme top-up exemption");
    else {
      savingsEmployer = approved(
        savings.approvedMonthlyContribution,
        "DIFC national qualifying-scheme top-up assessment",
      );
      savingsDueDate = iso(Date.UTC(year, month, 21));
      employerContributions.push(
        line(
          "SAVINGS",
          "DIFC national qualifying-scheme top-up",
          savingsEmployer,
          "statutory",
          savings.approvedMonthlyContribution.reference,
        ),
      );
    }
  }

  let settlement: UaePayrollResult["finalSettlement"];
  if (input.finalSettlement) {
    const final = input.finalSettlement;
    const last = date(final.terminationDate, "Settlement termination date");
    if (last !== exit || last < from || last > through)
      fail("Final settlement must match the recorded employment end in this payroll month.");
    const unpaidService = quantity(final.unpaidServiceDays, "Unpaid service days");
    if (unpaidService > (last - continuousStart) / DAY + 1)
      fail("Unpaid service exceeds employment duration.");
    const serviceYears = yearsOfService(continuousStart, last, unpaidService);
    let gratuity = 0;
    if (reviewedPattern)
      gratuity = approved(final.approvedGratuity, "Non-full-time gratuity calculation");
    else if (savings.scheme !== "gratuity") {
      if (continuousStart < date(savings.enrolledOn, "Savings enrollment"))
        gratuity = approved(savings.frozenGratuity, "Preserved pre-enrollment gratuity");
    } else if (pensionScheme === "none" && serviceYears >= 1) {
      if (profile.jurisdiction === "difc") {
        gratuity = approved(final.approvedGratuity, "DIFC historical/exempt gratuity");
      } else {
        gratuity = calculateUaeGratuityAmount({
          jurisdiction: profile.jurisdiction,
          basicSalary: profile.basicSalary,
          monthlyGross,
          serviceYears,
          annualWage: final.annualWage,
        });
      }
    }
    if (final.approvedGratuity) {
      const agreed = approved(final.approvedGratuity, "Reviewed gratuity");
      if (agreed < gratuity)
        fail("Reviewed gratuity cannot reduce the statutory or preserved entitlement.");
      gratuity = agreed;
    }
    const alreadyPaid = amount(final.gratuityAlreadyPaid ?? 0, "Gratuity previously paid");
    if (alreadyPaid > gratuity) fail("Previously paid gratuity exceeds the assessed entitlement.");
    gratuity -= alreadyPaid;
    const leaveBalance = quantity(final.unusedAnnualLeaveDays, "Unused annual leave");
    let leaveEncashment = 0;
    if (leaveBalance > 0)
      leaveEncashment = federalFullTime
        ? round((profile.basicSalary / 30) * leaveBalance)
        : approved(
            final.approvedLeaveEncashment,
            "Non-federal or non-full-time annual-leave encashment",
          );
    const noticeDays = quantity(final.noticePayDays, "Notice days");
    let noticePay = 0;
    if (noticeDays > 0) {
      if (!final.noticePayDirection) fail("Specify who owes notice compensation.");
      noticePay = federalFullTime
        ? round((monthlyGross / 30) * noticeDays)
        : approved(final.approvedNoticePay, "Non-federal or non-full-time notice compensation");
    }
    if (gratuity)
      earnings.push(
        line(
          "GRATUITY",
          "End-of-service gratuity",
          gratuity,
          "settlement",
          final.approvedGratuity?.reference ?? savings.frozenGratuity?.reference,
        ),
      );
    if (leaveEncashment)
      earnings.push(line("LEAVE_ENCASHMENT", "Unused annual leave", leaveEncashment, "settlement"));
    if (noticePay) {
      if (final.noticePayDirection === "employee_owes")
        deductions.push(line("NOTICE", "Notice compensation owed", noticePay, "settlement"));
      else earnings.push(line("NOTICE", "Notice compensation", noticePay, "settlement"));
    }
    settlement = {
      gratuity,
      leaveEncashment,
      noticePay: final.noticePayDirection === "employee_owes" ? -noticePay : noticePay,
      paymentDueDate: iso(last + (profile.jurisdiction === "adgm" ? 21 : 14) * DAY),
      serviceYears,
    };
  }

  // Article 25 category ceilings are aggregate per category, never per deduction line.
  // https://www.mohre.gov.ae/assets/download/4dd83c0a/Federal%20Decree-Law%20No.%2033%20of%202021%20Regarding%20the%20Regulation%20of%20Employment%20Relationship%20and%20its%20amendments.pdf.aspx
  const categoryTotals = new Map<string, number>();
  for (const [index, entry] of (input.deductions ?? []).entries()) {
    approved(entry, "Payroll deduction");
    evidence(entry.name, "Deduction name");
    if (["loan", "voluntary"].includes(entry.kind) && !entry.consent)
      fail(
        "Loan/voluntary deductions require written consent and their lawful basis; loans must be interest-free.",
      );
    if (["court", "maintenance"].includes(entry.kind) && !entry.courtOrder)
      fail("Court/maintenance deductions require a court order.");
    if (
      ![
        "loan",
        "overpayment",
        "disciplinary",
        "court",
        "maintenance",
        "damage",
        "voluntary",
      ].includes(entry.kind)
    )
      fail("Unsupported deduction category.");
    const key = entry.kind === "damage" && entry.courtOrder ? "court_approved_damage" : entry.kind;
    categoryTotals.set(key, (categoryTotals.get(key) ?? 0) + entry.amount);
    deductions.push(
      line(`DEDUCTION_${index + 1}`, entry.name, entry.amount, "variable", entry.reference),
    );
  }
  if (profile.jurisdiction === "federal") {
    const caps = {
      overpayment: wageForDeductions * 0.2,
      disciplinary: wageForDeductions * 0.05,
      court: wageForDeductions * 0.25,
      damage: (monthlyGross / 30) * 5,
    };
    for (const [kind, cap] of Object.entries(caps))
      if ((categoryTotals.get(kind) ?? 0) > Math.floor(cap))
        fail(`${kind} deductions exceed the federal statutory category ceiling.`);
    if (sum(deductions) > Math.floor(wageForDeductions * 0.5))
      fail(
        "Combined deductions exceed 50% of earned wages. Reduce/defer authorised recoveries or obtain a reviewed settlement; never reduce statutory pension automatically.",
      );
  } else if (deductions.length) {
    const limit = approved(
      input.approvedAdjustments?.deductionLimit,
      "Non-federal authorised deduction limit",
    );
    if (sum(deductions) > limit)
      fail("Deductions exceed the approved jurisdiction-specific limit.");
  }
  const grossSalary = sum(earnings);
  const totalDeductions = sum(deductions);
  if (totalDeductions > grossSalary) fail("Deductions would make net pay negative.");
  const dueDay =
    profile.salaryPaymentDay ??
    (profile.jurisdiction === "difc" ? 7 : profile.jurisdiction === "adgm" ? 14 : 1);
  if (
    (profile.jurisdiction === "federal" && from >= Date.UTC(2026, 5, 1) && dueDay > 1) ||
    (profile.jurisdiction === "difc" && dueDay > 7) ||
    (profile.jurisdiction === "adgm" && dueDay > 14)
  )
    fail("Contract salary payment date exceeds the jurisdiction's statutory payment deadline.");
  const regularPaymentDue = iso(Date.UTC(year, month, dueDay));
  const paymentDueDate =
    settlement && settlement.paymentDueDate < regularPaymentDue
      ? settlement.paymentDueDate
      : regularPaymentDue;
  return {
    currency: "AED",
    jurisdiction: profile.jurisdiction,
    month,
    year,
    basicSalary: earnedBasic,
    grossSalary,
    netSalary: grossSalary - totalDeductions,
    totalDeductions,
    pensionEmployee,
    pensionEmployer,
    pensionGovernment,
    healthInsuranceEmployer: profile.healthInsuranceEmployer,
    otherDeductions: totalDeductions - pensionEmployee,
    savingsEmployer,
    totalEmployerCost: grossSalary + sum(employerContributions),
    earnings,
    deductions,
    employerContributions,
    paymentDueDate,
    pensionDueDate,
    savingsDueDate,
    warnings,
    paidDays: activeDays - actualUnpaidDays,
    totalDays,
    unpaidDays: actualUnpaidDays,
    wps: structuredClone(profile.wps),
    schemeMetadata: {
      pensionScheme,
      pensionContributionSalary: pensionSalary,
      pensionEmployeeRate: employeeRate,
      pensionEmployerRate: employerRate,
      pensionGovernmentRate: governmentRate,
      iloeMode: profile.iloe.mode,
      savingsScheme: savings.scheme,
    },
    ...(settlement ? { finalSettlement: settlement } : {}),
  };
}
