/** All monetary amounts in this contract are integer fils (AED 1 = 100 fils). */
export type UaeJurisdiction = "federal" | "difc" | "adgm";
export type UaeWpsCategory =
  | "housing"
  | "conveyance"
  | "medical"
  | "annualPassage"
  | "overtime"
  | "other"
  | "leaveEncashment";
export type UaePensionScheme =
  | "none"
  | "gpssa_old"
  | "gpssa_new"
  | "adpf_old"
  | "adpf_new"
  | "sssf"
  | "gcc";
export interface UaeApprovedAmount {
  amount: number;
  /** Authority, contract, court order or reviewed calculation supporting the amount. */
  reference: string;
}
export interface UaeEmployeeProfile {
  jurisdiction: UaeJurisdiction;
  effectiveFrom: string;
  nationality: string;
  basicSalary: number;
  allowances: { name: string; amount: number }[];
  normalDailyHours: number;
  workPattern?: "full_time" | "part_time" | "temporary" | "domestic";
  isShiftWorker?: boolean;
  probationEndsOn?: string | null;
  pension?: {
    scheme: UaePensionScheme;
    sector?: "private" | "government";
    firstInsuredOn?: string;
    /** Registered pension salary; never replace with prorated earned wages. */
    contributionSalary?: number;
    /** January or joining-year salary reference applicable to this payroll year. */
    salaryYear?: number;
    authorityReference?: string;
    gcc?: {
      employeeRate: number;
      employerRate: number;
      governmentRate?: number;
      minimumSalary: number;
      maximumSalary: number;
      effectiveFrom: string;
      effectiveTo?: string;
      reference: string;
    };
    /** Reviewed adjustment for leave, transfer or other authority-specific cases. */
    approvedPeriodAmounts?: {
      employee: number;
      employer: number;
      government: number;
      reference: string;
      month: number;
      year: number;
    };
  };
  iloe: {
    mode: "employee_paid" | "employer_collected" | "exempt";
    exemptionReason?: string;
    policyReference?: string;
    policyStartsOn?: string;
    policyMonths?: 12 | 24;
    paymentFrequency?: "monthly" | "quarterly" | "semi_annually" | "annually" | "in_full";
  };
  /** Actual employer cost allocated to this month, not an employee deduction. */
  healthInsuranceEmployer: number;
  savings: {
    scheme: "gratuity" | "federal_savings" | "dews" | "alternative";
    enrolledOn?: string;
    continuousServiceStartDate?: string;
    /** Preserved entitlement earned before enrollment, reviewed and frozen. */
    frozenGratuity?: UaeApprovedAmount & { asOf: string };
    approvedMonthlyContribution?: UaeApprovedAmount;
    exemptionReference?: string;
  };
  wps: {
    employeeId?: string;
    routingCode?: string;
    accountNumber?: string;
    exemption?: { reason: string; reference: string };
  };
  /** Contractual due day of the next month; statutory deadline still applies. */
  salaryPaymentDay?: number;
  /** Verified opening history used by the monthly gratuity-liability report. */
  gratuityHistory?: UaeGratuityHistoryBaseline;
}

export type UaeLeaveKind =
  | "annual"
  | "sick"
  | "maternity"
  | "parental"
  | "bereavement_spouse"
  | "bereavement_family"
  | "study"
  | "unpaid";
export interface UaeLeaveInput {
  kind: UaeLeaveKind;
  days: number;
  /** Earlier days already used in the statutory entitlement cycle. */
  usedToDate?: number;
  entitlementReference?: string;
}
export interface UaeDeductionInput extends UaeApprovedAmount {
  name: string;
  kind: "loan" | "overpayment" | "disciplinary" | "court" | "maintenance" | "damage" | "voluntary";
  consent?: boolean;
  courtOrder?: boolean;
}
export interface UaePeriodInput {
  unpaidDays?: number;
  leaves?: UaeLeaveInput[];
  overtime?: {
    ordinaryHours?: number;
    nightHours?: number;
    restDays?: number;
    publicHolidayDays?: number;
    /** Days worked for which compensatory leave is provided instead of premium. */
    compensatedRestDays?: number;
    compensatedPublicHolidayDays?: number;
    /** Evidence that daily/weekly hour and rest-day limits were checked. */
    approvedScheduleReference?: string;
  };
  variableEarnings?: {
    name: string;
    amount: number;
    kind?: "earning" | "reimbursement";
    wpsCategory?: UaeWpsCategory;
  }[];
  deductions?: UaeDeductionInput[];
  /** Actual premium collection; omit when this period has no policy payment due. */
  iloeCollection?: UaeApprovedAmount & {
    premium: number;
    vat: number;
    coverageMonths: number;
    dueOn: string;
  };
  /** Required for non-federal leave/OT and non-standard work patterns. */
  approvedAdjustments?: {
    /** Earned fixed salary for non-full-time work or a partial non-federal month, before leave. */
    regularSalary?: UaeApprovedAmount;
    leaveDeduction?: UaeApprovedAmount;
    overtimePay?: UaeApprovedAmount;
    deductionLimit?: UaeApprovedAmount;
  };
  finalSettlement?: {
    terminationDate: string;
    unpaidServiceDays: number;
    unusedAnnualLeaveDays?: number;
    noticePayDays?: number;
    noticePayDirection?: "employer_pays" | "employee_owes";
    gratuityAlreadyPaid?: number;
    approvedGratuity?: UaeApprovedAmount;
    approvedLeaveEncashment?: UaeApprovedAmount;
    approvedNoticePay?: UaeApprovedAmount;
    /** Reviewed annual wage used for the ADGM 50% basic-wage floor. */
    annualWage?: UaeApprovedAmount;
  };
}

export interface UaePayrollLine {
  code: string;
  name: string;
  amount: number;
  category: "fixed" | "variable" | "reimbursement" | "statutory" | "settlement";
  reference?: string;
  wpsCategory?: UaeWpsCategory;
}
export interface UaePayrollResult {
  currency: "AED";
  jurisdiction: UaeJurisdiction;
  month: number;
  year: number;
  basicSalary: number;
  grossSalary: number;
  netSalary: number;
  totalDeductions: number;
  pensionEmployee: number;
  pensionEmployer: number;
  pensionGovernment: number;
  healthInsuranceEmployer: number;
  otherDeductions: number;
  savingsEmployer: number;
  totalEmployerCost: number;
  earnings: UaePayrollLine[];
  deductions: UaePayrollLine[];
  employerContributions: UaePayrollLine[];
  paymentDueDate: string;
  pensionDueDate: string | null;
  savingsDueDate: string | null;
  warnings: string[];
  /** Active calendar days less actual fully unpaid absence; half-paid leave remains paid. */
  paidDays: number;
  totalDays: number;
  /** Actual fully unpaid days, excluding the wage-loss equivalent of half-paid leave. */
  unpaidDays: number;
  wps: UaeEmployeeProfile["wps"];
  schemeMetadata: {
    pensionScheme: UaePensionScheme;
    pensionContributionSalary: number;
    pensionEmployeeRate: number;
    pensionEmployerRate: number;
    pensionGovernmentRate: number;
    iloeMode: UaeEmployeeProfile["iloe"]["mode"];
    savingsScheme: UaeEmployeeProfile["savings"]["scheme"];
  };
  finalSettlement?: {
    gratuity: number;
    leaveEncashment: number;
    noticePay: number;
    paymentDueDate: string;
    serviceYears: number;
  };
}

/** Verified service history through an inclusive date; never infer imported history as zero. */
export interface UaeGratuityHistoryBaseline {
  asOf: string;
  cumulativeUnpaidServiceDays: number;
  settlementsPaid: number;
  reference: string;
  annualWage?: UaeApprovedAmount;
}

export interface UaeGratuityValuationInput {
  /** Salary and scheme in force at this valuation date. */
  profile?: UaeEmployeeProfile;
  cumulativeUnpaidServiceDays?: number;
  unpaidServiceReference?: string;
  /** Required for automatic ADGM valuation, including its 50% benefit-basic floor. */
  annualWage?: UaeApprovedAmount;
  /** Reviewed gross balances before deducting any gratuity settlements already paid. */
  approvedValuation?: {
    accruedLiability: number;
    vestedAmount: number;
    reference: string;
  };
}

export interface UaeGratuityLiabilityInput {
  year: number;
  month: number;
  startDate: string;
  endDate?: string | null;
  opening: UaeGratuityValuationInput;
  closing: UaeGratuityValuationInput;
  settlementsPaidBeforePeriod: number;
  /** Net verified cash paid in the month; a documented refund is negative. */
  settlementsPaidDuringPeriod: number;
  /** Source proving paid settlement history, including an explicitly verified zero. */
  settlementHistoryReference: string;
  /** Employer fund contributions are shown separately from retained gratuity liability. */
  savingsContributionsDuringPeriod?: UaeApprovedAmount;
}

/** Undiscounted statutory-formula provision, distinct from a vested termination entitlement. */
export interface UaeGratuityLiabilityResult {
  status: "calculated" | "needs_review";
  currency: "AED";
  year: number;
  month: number;
  openingDate: string;
  closingDate: string;
  openingAccruedLiability: number | null;
  closingAccruedLiability: number | null;
  openingVestedAmount: number | null;
  closingVestedAmount: number | null;
  /** Change from additional eligible service, including a release at termination. */
  serviceAccrual: number | null;
  /** Revaluation of opening service using the closing salary and benefit basis. */
  salaryRevaluation: number | null;
  /** Closing gross provision less opening gross provision, before cash settlements. */
  accrualExpense: number | null;
  /** Net cash paid; a documented refund restores liability and is negative. */
  settlementsPaid: number | null;
  /** Closing retained liability less opening retained liability. */
  netMovement: number | null;
  employerSavingsContributions: number | null;
  openingServiceYears: number | null;
  closingServiceYears: number | null;
  warnings: string[];
}
