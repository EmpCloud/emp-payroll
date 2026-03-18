// ============================================================================
// UK PAYROLL CONSTANTS — Tax Year 2025-26 (6 April 2025 – 5 April 2026)
// PAYE income tax, National Insurance, Student Loan, Pension auto-enrolment
// Update annually when HMRC publishes new thresholds.
// ============================================================================

// ---------------------------------------------------------------------------
// PAYE Income Tax Bands — England, Wales, Northern Ireland (2025-26)
// Scotland has separate bands (see below)
// ---------------------------------------------------------------------------

export interface UKTaxBand {
  name: string;
  min: number;
  max: number;
  rate: number; // percentage
}

export const UK_PAYE_BANDS_ENGLAND: UKTaxBand[] = [
  { name: "Personal Allowance", min: 0, max: 12570, rate: 0 },
  { name: "Basic rate", min: 12571, max: 50270, rate: 20 },
  { name: "Higher rate", min: 50271, max: 125140, rate: 40 },
  { name: "Additional rate", min: 125141, max: Infinity, rate: 45 },
];

// Scotland has different bands (Scottish taxpayers identified by S tax code)
export const UK_PAYE_BANDS_SCOTLAND: UKTaxBand[] = [
  { name: "Personal Allowance", min: 0, max: 12570, rate: 0 },
  { name: "Starter rate", min: 12571, max: 14876, rate: 19 },
  { name: "Basic rate", min: 14877, max: 26561, rate: 20 },
  { name: "Intermediate rate", min: 26562, max: 43662, rate: 21 },
  { name: "Higher rate", min: 43663, max: 75000, rate: 42 },
  { name: "Advanced rate", min: 75001, max: 125140, rate: 45 },
  { name: "Top rate", min: 125141, max: Infinity, rate: 48 },
];

export type UKTaxRegion = "england" | "scotland" | "wales" | "northern_ireland";

export const UK_PAYE_BANDS: Record<UKTaxRegion, UKTaxBand[]> = {
  england: UK_PAYE_BANDS_ENGLAND,
  scotland: UK_PAYE_BANDS_SCOTLAND,
  wales: UK_PAYE_BANDS_ENGLAND,
  northern_ireland: UK_PAYE_BANDS_ENGLAND,
};

// ---------------------------------------------------------------------------
// Personal Allowance
// ---------------------------------------------------------------------------
export const UK_PERSONAL_ALLOWANCE = 12570;
export const UK_PA_TAPER_THRESHOLD = 100000;
export const UK_PA_TAPER_RATE = 0.5;

// ---------------------------------------------------------------------------
// National Insurance Contributions (NIC) — 2025-26
// ---------------------------------------------------------------------------

// Class 1 — Employee
export const NIC_EMPLOYEE_PRIMARY_THRESHOLD_ANNUAL = 12570;
export const NIC_EMPLOYEE_PRIMARY_THRESHOLD_MONTHLY = 1048;
export const NIC_EMPLOYEE_PRIMARY_THRESHOLD_WEEKLY = 242;
export const NIC_EMPLOYEE_UPPER_EARNINGS_LIMIT_ANNUAL = 50270;
export const NIC_EMPLOYEE_UPPER_EARNINGS_LIMIT_MONTHLY = 4189;
export const NIC_EMPLOYEE_RATE_MAIN = 8; // % between PT and UEL
export const NIC_EMPLOYEE_RATE_ABOVE_UEL = 2; // % above UEL

// Class 1 — Employer
export const NIC_EMPLOYER_SECONDARY_THRESHOLD_ANNUAL = 5000;
export const NIC_EMPLOYER_SECONDARY_THRESHOLD_MONTHLY = 417;
export const NIC_EMPLOYER_RATE = 15; // % (increased from 13.8% April 2025)

// Class 1A — Employer on benefits in kind
export const NIC_CLASS_1A_RATE = 15;

// Employment Allowance
export const NIC_EMPLOYMENT_ALLOWANCE = 10500;

// ---------------------------------------------------------------------------
// NIC Category Letters
// ---------------------------------------------------------------------------
export type NICCategory = "A" | "B" | "C" | "F" | "H" | "J" | "M" | "V" | "Z";

// ---------------------------------------------------------------------------
// Student Loan Repayment — 2025-26
// ---------------------------------------------------------------------------
export interface StudentLoanPlan {
  name: string;
  annualThreshold: number;
  monthlyThreshold: number;
  weeklyThreshold: number;
  rate: number;
}

export const UK_STUDENT_LOAN_PLANS: Record<string, StudentLoanPlan> = {
  plan1: { name: "Plan 1 (pre-2012 England/Wales, Scotland/NI)", annualThreshold: 24990, monthlyThreshold: 2082, weeklyThreshold: 480, rate: 9 },
  plan2: { name: "Plan 2 (post-2012 England/Wales)", annualThreshold: 27295, monthlyThreshold: 2274, weeklyThreshold: 524, rate: 9 },
  plan4: { name: "Plan 4 (post-2012 Scotland)", annualThreshold: 31395, monthlyThreshold: 2616, weeklyThreshold: 603, rate: 9 },
  plan5: { name: "Plan 5 (post-2023 England/Wales)", annualThreshold: 25000, monthlyThreshold: 2083, weeklyThreshold: 480, rate: 9 },
  postgrad: { name: "Postgraduate Loan", annualThreshold: 21000, monthlyThreshold: 1750, weeklyThreshold: 403, rate: 6 },
};

// ---------------------------------------------------------------------------
// Pension Auto-Enrolment — 2025-26
// ---------------------------------------------------------------------------
export const PENSION_QUALIFYING_EARNINGS_LOWER = 6240;
export const PENSION_QUALIFYING_EARNINGS_UPPER = 50270;
export const PENSION_AUTO_ENROL_TRIGGER = 10000;
export const PENSION_EMPLOYEE_MIN_RATE = 5;
export const PENSION_EMPLOYER_MIN_RATE = 3;
export const PENSION_TOTAL_MIN_RATE = 8;
export type PensionMethod = "relief_at_source" | "net_pay" | "salary_sacrifice";
export const PENSION_ANNUAL_ALLOWANCE = 60000;
export const PENSION_ANNUAL_ALLOWANCE_TAPER_THRESHOLD = 260000;
export const PENSION_ANNUAL_ALLOWANCE_MINIMUM = 10000;

// ---------------------------------------------------------------------------
// Statutory Pay — 2025-26
// ---------------------------------------------------------------------------
export const STATUTORY_SICK_PAY_WEEKLY = 118.75;
export const SSP_QUALIFYING_DAYS = 3;
export const SSP_LOWER_EARNINGS_LIMIT_WEEKLY = 125;
export const STATUTORY_MATERNITY_PAY_RATE = 187.18;
export const SMP_HIGHER_RATE_WEEKS = 6;
export const SMP_STANDARD_WEEKS = 33;
export const STATUTORY_PATERNITY_PAY_WEEKLY = 187.18;
export const STATUTORY_SHARED_PARENTAL_PAY_WEEKLY = 187.18;

// ---------------------------------------------------------------------------
// Tax Code Parsing
// ---------------------------------------------------------------------------
export const UK_DEFAULT_TAX_CODE = "1257L";
export const UK_EMERGENCY_TAX_CODES = ["1257L", "1257L W1", "1257L M1", "1257L X"];

export interface ParsedTaxCode {
  prefix?: "S" | "C" | "K";
  allowance: number;
  suffix?: "L" | "M" | "N" | "T" | "W1" | "M1" | "X";
  isNonCumulative: boolean;
  isScottish: boolean;
  isWelsh: boolean;
  isBR: boolean;
  isD0: boolean;
  isD1: boolean;
  isNT: boolean;
}

export function parseTaxCode(code: string): ParsedTaxCode {
  const upper = code.toUpperCase().trim();

  if (upper === "BR") return { allowance: 0, isNonCumulative: false, isScottish: false, isWelsh: false, isBR: true, isD0: false, isD1: false, isNT: false };
  if (upper === "D0") return { allowance: 0, isNonCumulative: false, isScottish: false, isWelsh: false, isBR: false, isD0: true, isD1: false, isNT: false };
  if (upper === "D1") return { allowance: 0, isNonCumulative: false, isScottish: false, isWelsh: false, isBR: false, isD0: false, isD1: true, isNT: false };
  if (upper === "NT") return { allowance: 0, isNonCumulative: false, isScottish: false, isWelsh: false, isBR: false, isD0: false, isD1: false, isNT: true };

  let prefix: "S" | "C" | "K" | undefined;
  let remaining = upper;

  if (remaining.startsWith("S")) { prefix = "S"; remaining = remaining.slice(1); }
  else if (remaining.startsWith("C")) { prefix = "C"; remaining = remaining.slice(1); }
  else if (remaining.startsWith("K")) { prefix = "K"; remaining = remaining.slice(1); }

  const isNonCumulative = remaining.includes("W1") || remaining.includes("M1") || remaining.includes("X");
  remaining = remaining.replace(/\s*(W1|M1|X)\s*/g, "");

  const numMatch = remaining.match(/(\d+)/);
  const numericPart = numMatch ? parseInt(numMatch[1]) : 0;
  const allowance = prefix === "K" ? -(numericPart * 10) : numericPart * 10;

  const suffixMatch = remaining.match(/[A-Z]+$/);
  const suffix = suffixMatch ? suffixMatch[0] as any : undefined;

  return { prefix, allowance, suffix, isNonCumulative, isScottish: prefix === "S", isWelsh: prefix === "C", isBR: false, isD0: false, isD1: false, isNT: false };
}

// ---------------------------------------------------------------------------
// Pay Frequency
// ---------------------------------------------------------------------------
export const UK_PAY_PERIODS: Record<string, number> = {
  weekly: 52,
  fortnightly: 26,
  four_weekly: 13,
  monthly: 12,
};

// ---------------------------------------------------------------------------
// Tax Year Helper (6 April – 5 April)
// ---------------------------------------------------------------------------
export const UK_TAX_YEAR_START_MONTH = 4;
export const UK_TAX_YEAR_START_DAY = 6;

export function getUKTaxYear(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (month > 4 || (month === 4 && day >= 6)) {
    return `${year}-${(year + 1).toString().slice(-2)}`;
  }
  return `${year - 1}-${year.toString().slice(-2)}`;
}

export function getUKTaxYearRange(taxYear: string): { start: Date; end: Date } {
  const startYear = parseInt(taxYear.split("-")[0]);
  return {
    start: new Date(startYear, 3, 6),
    end: new Date(startYear + 1, 3, 5),
  };
}
