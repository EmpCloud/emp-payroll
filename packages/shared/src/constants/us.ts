// ============================================================================
// US PAYROLL CONSTANTS — Tax Year 2025
// Federal income tax, FICA (Social Security + Medicare), FUTA
// ============================================================================

export type USFilingStatus =
  | "single"
  | "married_filing_jointly"
  | "married_filing_separately"
  | "head_of_household";

// ---------------------------------------------------------------------------
// Federal Income Tax Brackets — 2025
// ---------------------------------------------------------------------------
export const US_FED_BRACKETS_SINGLE = [
  { min: 0, max: 11925, rate: 10 },
  { min: 11926, max: 48475, rate: 12 },
  { min: 48476, max: 103350, rate: 22 },
  { min: 103351, max: 197300, rate: 24 },
  { min: 197301, max: 250525, rate: 32 },
  { min: 250526, max: 626350, rate: 35 },
  { min: 626351, max: Infinity, rate: 37 },
] as const;

export const US_FED_BRACKETS_MFJ = [
  { min: 0, max: 23850, rate: 10 },
  { min: 23851, max: 96950, rate: 12 },
  { min: 96951, max: 206700, rate: 22 },
  { min: 206701, max: 394600, rate: 24 },
  { min: 394601, max: 501050, rate: 32 },
  { min: 501051, max: 751600, rate: 35 },
  { min: 751601, max: Infinity, rate: 37 },
] as const;

export const US_FED_BRACKETS_HOH = [
  { min: 0, max: 17000, rate: 10 },
  { min: 17001, max: 64850, rate: 12 },
  { min: 64851, max: 103350, rate: 22 },
  { min: 103351, max: 197300, rate: 24 },
  { min: 197301, max: 250500, rate: 32 },
  { min: 250501, max: 626350, rate: 35 },
  { min: 626351, max: Infinity, rate: 37 },
] as const;

export const US_FED_BRACKETS: Record<
  USFilingStatus,
  readonly { min: number; max: number; rate: number }[]
> = {
  single: US_FED_BRACKETS_SINGLE,
  married_filing_jointly: US_FED_BRACKETS_MFJ,
  married_filing_separately: US_FED_BRACKETS_SINGLE,
  head_of_household: US_FED_BRACKETS_HOH,
};

// ---------------------------------------------------------------------------
// Standard Deduction — 2025
// ---------------------------------------------------------------------------
export const US_STANDARD_DEDUCTION: Record<USFilingStatus, number> = {
  single: 15000,
  married_filing_jointly: 30000,
  married_filing_separately: 15000,
  head_of_household: 22500,
};

export const US_ADDITIONAL_STD_DEDUCTION_SINGLE = 2000;
export const US_ADDITIONAL_STD_DEDUCTION_MARRIED = 1600;

// ---------------------------------------------------------------------------
// FICA — Social Security + Medicare
// ---------------------------------------------------------------------------
export const FICA_SS_EMPLOYEE_RATE = 6.2;
export const FICA_SS_EMPLOYER_RATE = 6.2;
export const FICA_SS_WAGE_BASE = 176100;

export const FICA_MEDICARE_EMPLOYEE_RATE = 1.45;
export const FICA_MEDICARE_EMPLOYER_RATE = 1.45;
export const FICA_MEDICARE_ADDITIONAL_RATE = 0.9;
export const FICA_MEDICARE_ADDITIONAL_THRESHOLD_SINGLE = 200000;
export const FICA_MEDICARE_ADDITIONAL_THRESHOLD_MFJ = 250000;

// ---------------------------------------------------------------------------
// FUTA — Federal Unemployment Tax (employer only)
// ---------------------------------------------------------------------------
export const FUTA_GROSS_RATE = 6.0;
export const FUTA_WAGE_BASE = 7000;
export const FUTA_STATE_CREDIT_MAX = 5.4;
export const FUTA_EFFECTIVE_RATE = 0.6;

// ---------------------------------------------------------------------------
// State Income Tax
// ---------------------------------------------------------------------------
export interface USStateTaxConfig {
  hasIncomeTax: boolean;
  type: "flat" | "progressive" | "none";
  flatRate?: number;
  brackets?: readonly { min: number; max: number; rate: number }[];
  standardDeduction?: number;
}

export const US_STATE_TAX: Record<string, USStateTaxConfig> = {
  // No income tax
  AK: { hasIncomeTax: false, type: "none" },
  FL: { hasIncomeTax: false, type: "none" },
  NV: { hasIncomeTax: false, type: "none" },
  SD: { hasIncomeTax: false, type: "none" },
  TX: { hasIncomeTax: false, type: "none" },
  WA: { hasIncomeTax: false, type: "none" },
  WY: { hasIncomeTax: false, type: "none" },
  NH: { hasIncomeTax: false, type: "none" },
  TN: { hasIncomeTax: false, type: "none" },

  // Flat rate
  CO: { hasIncomeTax: true, type: "flat", flatRate: 4.4 },
  IL: { hasIncomeTax: true, type: "flat", flatRate: 4.95 },
  IN: { hasIncomeTax: true, type: "flat", flatRate: 3.05 },
  KY: { hasIncomeTax: true, type: "flat", flatRate: 4.0 },
  MA: { hasIncomeTax: true, type: "flat", flatRate: 5.0 },
  MI: { hasIncomeTax: true, type: "flat", flatRate: 4.25 },
  NC: { hasIncomeTax: true, type: "flat", flatRate: 4.5 },
  PA: { hasIncomeTax: true, type: "flat", flatRate: 3.07 },
  UT: { hasIncomeTax: true, type: "flat", flatRate: 4.65 },
  AZ: { hasIncomeTax: true, type: "flat", flatRate: 2.5 },

  // Progressive
  CA: {
    hasIncomeTax: true, type: "progressive", standardDeduction: 5540,
    brackets: [
      { min: 0, max: 10412, rate: 1 }, { min: 10413, max: 24684, rate: 2 },
      { min: 24685, max: 38959, rate: 4 }, { min: 38960, max: 54081, rate: 6 },
      { min: 54082, max: 68350, rate: 8 }, { min: 68351, max: 349137, rate: 9.3 },
      { min: 349138, max: 418961, rate: 10.3 }, { min: 418962, max: 698271, rate: 11.3 },
      { min: 698272, max: Infinity, rate: 12.3 },
    ],
  },
  NY: {
    hasIncomeTax: true, type: "progressive", standardDeduction: 8000,
    brackets: [
      { min: 0, max: 8500, rate: 4 }, { min: 8501, max: 11700, rate: 4.5 },
      { min: 11701, max: 13900, rate: 5.25 }, { min: 13901, max: 80650, rate: 5.5 },
      { min: 80651, max: 215400, rate: 6 }, { min: 215401, max: 1077550, rate: 6.85 },
      { min: 1077551, max: 5000000, rate: 9.65 }, { min: 5000001, max: 25000000, rate: 10.3 },
      { min: 25000001, max: Infinity, rate: 10.9 },
    ],
  },
  NJ: {
    hasIncomeTax: true, type: "progressive",
    brackets: [
      { min: 0, max: 20000, rate: 1.4 }, { min: 20001, max: 35000, rate: 1.75 },
      { min: 35001, max: 40000, rate: 3.5 }, { min: 40001, max: 75000, rate: 5.525 },
      { min: 75001, max: 500000, rate: 6.37 }, { min: 500001, max: 1000000, rate: 8.97 },
      { min: 1000001, max: Infinity, rate: 10.75 },
    ],
  },
  GA: {
    hasIncomeTax: true, type: "progressive", standardDeduction: 5400,
    brackets: [
      { min: 0, max: 750, rate: 1 }, { min: 751, max: 2250, rate: 2 },
      { min: 2251, max: 3750, rate: 3 }, { min: 3751, max: 5250, rate: 4 },
      { min: 5251, max: 7000, rate: 5 }, { min: 7001, max: Infinity, rate: 5.49 },
    ],
  },
};

// ---------------------------------------------------------------------------
// W-4 Config (2020+ form)
// ---------------------------------------------------------------------------
export interface W4Config {
  filingStatus: USFilingStatus;
  multipleJobsOrSpouseWorks: boolean;
  dependentCredit: number;
  otherIncome: number;
  deductions: number;
  extraWithholding: number;
}

// ---------------------------------------------------------------------------
// Pay Periods
// ---------------------------------------------------------------------------
export const US_PAY_PERIODS = { weekly: 52, bi_weekly: 26, semi_monthly: 24, monthly: 12 } as const;
export type USPayPeriod = keyof typeof US_PAY_PERIODS;
