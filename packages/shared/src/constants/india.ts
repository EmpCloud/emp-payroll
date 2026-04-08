// ============================================================================
// INDIA PAYROLL CONSTANTS — FY 2025-26
// Update these annually when the Union Budget is announced.
// ============================================================================

// ---------------------------------------------------------------------------
// Income Tax — Old Regime (FY 2025-26)
// ---------------------------------------------------------------------------
export const TAX_SLABS_OLD = [
  { min: 0, max: 250000, rate: 0 },
  { min: 250001, max: 500000, rate: 5 },
  { min: 500001, max: 1000000, rate: 20 },
  { min: 1000001, max: Infinity, rate: 30 },
] as const;

// Standard deduction under Old Regime
export const STANDARD_DEDUCTION_OLD = 75000;

// Rebate u/s 87A — Old Regime (taxable income <= 5L)
export const REBATE_87A_OLD_LIMIT = 500000;
export const REBATE_87A_OLD_MAX = 12500;

// ---------------------------------------------------------------------------
// Income Tax — New Regime (FY 2025-26, default from FY 2023-24)
// ---------------------------------------------------------------------------
export const TAX_SLABS_NEW = [
  { min: 0, max: 400000, rate: 0 },
  { min: 400001, max: 800000, rate: 5 },
  { min: 800001, max: 1200000, rate: 10 },
  { min: 1200001, max: 1600000, rate: 15 },
  { min: 1600001, max: 2000000, rate: 20 },
  { min: 2000001, max: 2400000, rate: 25 },
  { min: 2400001, max: Infinity, rate: 30 },
] as const;

// Standard deduction under New Regime
export const STANDARD_DEDUCTION_NEW = 75000;

// Rebate u/s 87A — New Regime (taxable income <= 12L)
export const REBATE_87A_NEW_LIMIT = 1200000;
export const REBATE_87A_NEW_MAX = 60000;

// Marginal relief threshold for new regime
export const MARGINAL_RELIEF_THRESHOLD_NEW = 1275000;

// ---------------------------------------------------------------------------
// Surcharge
// ---------------------------------------------------------------------------
export const SURCHARGE_SLABS = [
  { min: 0, max: 5000000, rate: 0 },
  { min: 5000001, max: 10000000, rate: 10 },
  { min: 10000001, max: 20000000, rate: 15 },
  { min: 20000001, max: 50000000, rate: 25 },
  { min: 50000001, max: Infinity, rate: 37 },
] as const;

// New regime surcharge cap
export const SURCHARGE_CAP_NEW_REGIME = 25;

// Health & Education Cess
export const CESS_RATE = 4;

// ---------------------------------------------------------------------------
// Section 80C / 80D / HRA Limits (Old Regime)
// ---------------------------------------------------------------------------
export const SECTION_80C_LIMIT = 150000;
export const SECTION_80CCD_1B_LIMIT = 50000; // NPS additional
export const SECTION_80D_SELF_LIMIT = 25000;
export const SECTION_80D_SELF_SENIOR = 50000;
export const SECTION_80D_PARENTS_LIMIT = 25000;
export const SECTION_80D_PARENTS_SENIOR = 50000;
export const SECTION_80TTA_LIMIT = 10000; // Savings interest

// HRA exemption: min of (actual HRA, rent - 10% basic, 50%/40% basic)
export const HRA_METRO_PERCENT = 50;
export const HRA_NON_METRO_PERCENT = 40;

// ---------------------------------------------------------------------------
// Provident Fund (PF / EPF)
// ---------------------------------------------------------------------------
export const PF_WAGE_CEILING = 15000; // monthly PF wage ceiling
export const PF_EMPLOYEE_RATE = 12; // % of PF wages
export const PF_EMPLOYER_EPF_RATE = 3.67; // employer EPF %
export const PF_EMPLOYER_EPS_RATE = 8.33; // employer EPS %
export const PF_ADMIN_CHARGES_RATE = 0.5; // admin charges %
export const PF_EDLI_CHARGES_RATE = 0.5; // EDLI charges %
export const PF_EPS_SALARY_CEILING = 15000; // EPS wage ceiling

// ---------------------------------------------------------------------------
// Employee State Insurance (ESI)
// ---------------------------------------------------------------------------
export const ESI_WAGE_CEILING = 21000; // monthly gross ceiling for eligibility
export const ESI_EMPLOYEE_RATE = 0.75; // %
export const ESI_EMPLOYER_RATE = 3.25; // %

// ---------------------------------------------------------------------------
// Professional Tax (PT) — State-wise slabs
// Monthly slabs. Add more states as needed.
// ---------------------------------------------------------------------------
export interface PTSlab {
  min: number;
  max: number;
  tax: number;
}

export const PT_SLABS: Record<string, PTSlab[]> = {
  // Karnataka
  KA: [
    { min: 0, max: 15000, tax: 0 },
    { min: 15001, max: Infinity, tax: 200 },
  ],
  // Maharashtra
  MH: [
    { min: 0, max: 7500, tax: 0 },
    { min: 7501, max: 10000, tax: 175 },
    { min: 10001, max: Infinity, tax: 200 }, // 300 in Feb
  ],
  // Tamil Nadu
  TN: [
    { min: 0, max: 21000, tax: 0 },
    { min: 21001, max: 30000, tax: 100 },
    { min: 30001, max: 45000, tax: 235 },
    { min: 45001, max: 60000, tax: 510 },
    { min: 60001, max: 75000, tax: 760 },
    { min: 75001, max: Infinity, tax: 1095 },
  ],
  // Telangana
  TS: [
    { min: 0, max: 15000, tax: 0 },
    { min: 15001, max: 20000, tax: 150 },
    { min: 20001, max: Infinity, tax: 200 },
  ],
  // West Bengal
  WB: [
    { min: 0, max: 10000, tax: 0 },
    { min: 10001, max: 15000, tax: 110 },
    { min: 15001, max: 25000, tax: 130 },
    { min: 25001, max: 40000, tax: 150 },
    { min: 40001, max: Infinity, tax: 200 },
  ],
  // Gujarat
  GJ: [
    { min: 0, max: 5999, tax: 0 },
    { min: 6000, max: 8999, tax: 80 },
    { min: 9000, max: 11999, tax: 150 },
    { min: 12000, max: Infinity, tax: 200 },
  ],
  // Andhra Pradesh
  AP: [
    { min: 0, max: 15000, tax: 0 },
    { min: 15001, max: 20000, tax: 150 },
    { min: 20001, max: Infinity, tax: 200 },
  ],
  // Kerala
  KL: [
    { min: 0, max: 11999, tax: 0 },
    { min: 12000, max: 17999, tax: 120 },
    { min: 18000, max: 24999, tax: 180 },
    { min: 25000, max: 29999, tax: 250 },
    { min: 30000, max: Infinity, tax: 250 },
  ],
  // Madhya Pradesh
  MP: [
    { min: 0, max: 18750, tax: 0 },
    { min: 18751, max: 25000, tax: 125 },
    { min: 25001, max: 33333, tax: 167 },
    { min: 33334, max: Infinity, tax: 208 },
  ],
  // Rajasthan
  RJ: [
    { min: 0, max: 12000, tax: 0 },
    { min: 12001, max: 15000, tax: 100 },
    { min: 15001, max: 25000, tax: 150 },
    { min: 25001, max: Infinity, tax: 200 },
  ],
  // Odisha
  OD: [
    { min: 0, max: 13304, tax: 0 },
    { min: 13305, max: 25000, tax: 125 },
    { min: 25001, max: Infinity, tax: 200 },
  ],
  // Punjab
  PB: [
    { min: 0, max: 12000, tax: 0 },
    { min: 12001, max: 15000, tax: 100 },
    { min: 15001, max: 25000, tax: 150 },
    { min: 25001, max: Infinity, tax: 200 },
  ],
  // Assam
  AS: [
    { min: 0, max: 10000, tax: 0 },
    { min: 10001, max: 15000, tax: 150 },
    { min: 15001, max: 25000, tax: 180 },
    { min: 25001, max: Infinity, tax: 208 },
  ],
  // Bihar
  BR: [
    { min: 0, max: 25000, tax: 0 },
    { min: 25001, max: 41666, tax: 100 },
    { min: 41667, max: 83333, tax: 167 },
    { min: 83334, max: Infinity, tax: 208 },
  ],
  // Jharkhand
  JH: [
    { min: 0, max: 25000, tax: 0 },
    { min: 25001, max: 41666, tax: 100 },
    { min: 41667, max: 83333, tax: 150 },
    { min: 83334, max: Infinity, tax: 200 },
  ],
  // Chhattisgarh
  CG: [
    { min: 0, max: 12500, tax: 0 },
    { min: 12501, max: 16666, tax: 125 },
    { min: 16667, max: 20833, tax: 150 },
    { min: 20834, max: Infinity, tax: 200 },
  ],
  // Meghalaya
  ML: [
    { min: 0, max: 12500, tax: 0 },
    { min: 12501, max: 16666, tax: 125 },
    { min: 16667, max: Infinity, tax: 200 },
  ],
  // Tripura
  TR: [
    { min: 0, max: 7500, tax: 0 },
    { min: 7501, max: 15000, tax: 100 },
    { min: 15001, max: Infinity, tax: 150 },
  ],
  // Manipur
  MN: [
    { min: 0, max: 8333, tax: 0 },
    { min: 8334, max: 16666, tax: 100 },
    { min: 16667, max: Infinity, tax: 200 },
  ],
  // Sikkim
  SK: [
    { min: 0, max: 20000, tax: 0 },
    { min: 20001, max: Infinity, tax: 200 },
  ],
  // Goa
  GA: [
    { min: 0, max: 15000, tax: 0 },
    { min: 15001, max: Infinity, tax: 200 },
  ],
  // Delhi (no PT)
  DL: [],
  // Haryana (no PT)
  HR: [],
  // Uttarakhand (no PT)
  UK: [],
  // Himachal Pradesh (no PT)
  HP: [],
  // Jammu & Kashmir (no PT)
  JK: [],
  // Uttar Pradesh (no PT)
  UP: [],
};

// ---------------------------------------------------------------------------
// Working Days / Calendar
// ---------------------------------------------------------------------------
export const DEFAULT_WORKING_DAYS_PER_MONTH = 26;
export const DEFAULT_WORKING_DAYS_PER_YEAR = 312;

// ---------------------------------------------------------------------------
// Payslip Component Codes (standardized)
// ---------------------------------------------------------------------------
export const COMPONENT_CODES = {
  // Earnings
  BASIC: "BASIC",
  HRA: "HRA",
  SPECIAL_ALLOWANCE: "SA",
  CONVEYANCE: "CA",
  MEDICAL: "MA",
  LTA: "LTA",
  BONUS: "BONUS",
  INCENTIVE: "INCENTIVE",
  OVERTIME: "OT",
  ARREARS: "ARREARS",

  // Deductions
  PF_EMPLOYEE: "PF_EE",
  ESI_EMPLOYEE: "ESI_EE",
  PROFESSIONAL_TAX: "PT",
  TDS: "TDS",
  LOP: "LOP",
  ADVANCE_RECOVERY: "ADV_REC",
  VPF: "VPF",

  // Employer contributions (not deducted from salary, shown separately)
  PF_EMPLOYER: "PF_ER",
  ESI_EMPLOYER: "ESI_ER",
  GRATUITY: "GRATUITY",
} as const;

// ---------------------------------------------------------------------------
// Financial Year Helper
// ---------------------------------------------------------------------------
export const FY_START_MONTH = 4; // April

export function getFinancialYear(date: Date): string {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  if (month >= FY_START_MONTH) {
    return `${year}-${(year + 1).toString().slice(-2)}`;
  }
  return `${year - 1}-${year.toString().slice(-2)}`;
}

export function getFinancialYearRange(fy: string): { start: Date; end: Date } {
  const startYear = parseInt(fy.split("-")[0]);
  return {
    start: new Date(startYear, FY_START_MONTH - 1, 1), // April 1
    end: new Date(startYear + 1, FY_START_MONTH - 1, 0), // March 31
  };
}
