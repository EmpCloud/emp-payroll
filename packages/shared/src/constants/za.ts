// ============================================================================
// SOUTH AFRICA PAYROLL CONSTANTS — Tax Year 2025/26 (1 March 2025 – 28 Feb 2026)
// PAYE (SARS), UIF, SDL, medical scheme tax credits, retirement deduction, ETI.
// Update annually when SARS publishes new tables (Budget, ~February).
// All monetary values are in RAND (major units), matching the za-tax engine.
// ============================================================================

export interface ZATaxBand {
  name: string;
  min: number; // annual taxable income, lower bound (exclusive of prior band)
  max: number; // annual taxable income, upper bound (inclusive); Infinity for top
  rate: number; // marginal percentage
}

// ---------------------------------------------------------------------------
// PAYE — annual income tax brackets (2025/26). Marginal rates.
// SARS publishes these as a cumulative table; the equivalent marginal bands are:
// ---------------------------------------------------------------------------
export const ZA_PAYE_BANDS: ZATaxBand[] = [
  { name: "18%", min: 0, max: 237100, rate: 18 },
  { name: "26%", min: 237100, max: 370500, rate: 26 },
  { name: "31%", min: 370500, max: 512800, rate: 31 },
  { name: "36%", min: 512800, max: 673000, rate: 36 },
  { name: "39%", min: 673000, max: 857900, rate: 39 },
  { name: "41%", min: 857900, max: 1817000, rate: 41 },
  { name: "45%", min: 1817000, max: Infinity, rate: 45 },
];

// ---------------------------------------------------------------------------
// Tax rebates (annual) — reduce PAYE. Age-based and cumulative.
//   Under 65  -> primary
//   65 to 74  -> primary + secondary
//   75+       -> primary + secondary + tertiary
// ---------------------------------------------------------------------------
export const ZA_PRIMARY_REBATE = 17235; // all taxpayers
export const ZA_SECONDARY_REBATE = 9444; // additional, age >= 65
export const ZA_TERTIARY_REBATE = 3145; // additional, age >= 75

// Tax thresholds (annual) — income below which no PAYE is due. Derived from the
// rebates (threshold = rebate / 18%); exposed for reporting / quick checks.
export const ZA_TAX_THRESHOLD_UNDER_65 = 95750;
export const ZA_TAX_THRESHOLD_65_TO_74 = 148217;
export const ZA_TAX_THRESHOLD_75_PLUS = 165689;

// ---------------------------------------------------------------------------
// UIF — Unemployment Insurance Fund. 1% employee + 1% employer, applied to
// remuneration capped at a monthly ceiling (so max R177.12 each side / month).
// ---------------------------------------------------------------------------
export const ZA_UIF_RATE = 1; // percent, each side
export const ZA_UIF_MONTHLY_CEILING = 17712; // remuneration cap (rand / month)
export const ZA_UIF_MAX_MONTHLY = 177.12; // = 1% of the ceiling, per side

// ---------------------------------------------------------------------------
// SDL — Skills Development Levy. 1% of total remuneration, employer only.
// Only payable when the employer's annual payroll exceeds R500,000.
// ---------------------------------------------------------------------------
export const ZA_SDL_RATE = 1; // percent (employer)
export const ZA_SDL_ANNUAL_PAYROLL_THRESHOLD = 500000;

// ---------------------------------------------------------------------------
// Medical scheme fees tax credit (MTC) — monthly, reduces PAYE (a credit, not
// a deduction). 2025/26 values.
// ---------------------------------------------------------------------------
export const ZA_MTC_MAIN_MEMBER = 364; // main member
export const ZA_MTC_FIRST_DEPENDANT = 364; // first dependant
export const ZA_MTC_ADDITIONAL_DEPENDANT = 246; // each further dependant

// ---------------------------------------------------------------------------
// Retirement fund contributions — deductible up to 27.5% of the greater of
// remuneration or taxable income, capped at R350,000 per tax year.
// ---------------------------------------------------------------------------
export const ZA_RETIREMENT_DEDUCTION_RATE = 27.5; // percent
export const ZA_RETIREMENT_ANNUAL_CAP = 350000; // rand / year

// ---------------------------------------------------------------------------
// ETI — Employment Tax Incentive (2025). Reduces the employer's PAYE liability
// to SARS (not the employee's PAYE) for qualifying employees aged 18–29 earning
// below the wage ceiling, for their first 24 qualifying months.
// ---------------------------------------------------------------------------
export const ZA_ETI_MIN_AGE = 18;
export const ZA_ETI_MAX_AGE = 29;
export const ZA_ETI_WAGE_CEILING = 6500; // monthly remuneration ceiling
export const ZA_ETI_MIN_MONTHLY_WAGE = 2000; // below this (with no min-wage) may disqualify
export const ZA_ETI_BAND1_MAX = 2499.99;
export const ZA_ETI_BAND2_MAX = 5499.99;
export const ZA_ETI_BAND1_RATE = 0.6; // 60% of remuneration (first 12 months)
export const ZA_ETI_BAND2_AMOUNT = 1500; // flat (first 12 months)
export const ZA_ETI_BAND3_TAPER = 0.75; // R1500 − 75% × (rem − 5500)
export const ZA_ETI_FIRST_PERIOD_MONTHS = 12;
export const ZA_ETI_SECOND_PERIOD_MONTHS = 24;

// Months in the SA tax year (1 March – end February).
export const ZA_MONTHS_PER_YEAR = 12;
