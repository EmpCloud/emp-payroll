// ============================================================================
// SOUTH AFRICA PAYROLL / TAX ENGINE  (SARS — tax year 1 Mar – end Feb)
// PAYE (progressive brackets + age rebates + medical credit + retirement
// deduction), UIF (capped, both sides), SDL (employer), and ETI (employer
// incentive). Works in RAND (major units); callers in cents must convert.
// ============================================================================

import {
  ZA_PAYE_BANDS,
  ZA_PRIMARY_REBATE,
  ZA_SECONDARY_REBATE,
  ZA_TERTIARY_REBATE,
  ZA_UIF_RATE,
  ZA_UIF_MONTHLY_CEILING,
  ZA_SDL_RATE,
  ZA_MTC_MAIN_MEMBER,
  ZA_MTC_FIRST_DEPENDANT,
  ZA_MTC_ADDITIONAL_DEPENDANT,
  ZA_RETIREMENT_DEDUCTION_RATE,
  ZA_RETIREMENT_ANNUAL_CAP,
  ZA_ETI_MIN_AGE,
  ZA_ETI_MAX_AGE,
  ZA_ETI_WAGE_CEILING,
  ZA_ETI_BAND1_MAX,
  ZA_ETI_BAND2_MAX,
  ZA_ETI_BAND1_RATE,
  ZA_ETI_BAND2_AMOUNT,
  ZA_ETI_BAND3_TAPER,
  ZA_ETI_FIRST_PERIOD_MONTHS,
  ZA_ETI_SECOND_PERIOD_MONTHS,
  ZA_MONTHS_PER_YEAR,
  type ZATaxBand,
} from "@emp-payroll/shared";

export interface ZAPayrollInput {
  employeeId: string;
  /** Gross monthly remuneration, in RAND. */
  grossMonthly: number;
  /** Age in years — drives the age-based rebates. Defaults to 30 (primary only). */
  age?: number;
  /** Total medical-scheme beneficiaries INCLUDING the main member. 0 = none. */
  medicalAidBeneficiaries?: number;
  /** Employee retirement-fund contribution per month, in RAND. Reduces taxable income. */
  retirementContributionMonthly?: number;
  /** Whether the employer's annual payroll exceeds the R500k SDL threshold. Defaults to true. */
  sdlApplicable?: boolean;
  /** ETI: number of qualifying months already claimed for this employee (0–24). */
  etiMonthsClaimed?: number;
  /** ETI: does the employee otherwise qualify (valid ID/asylum, not a connected person)? */
  etiEligible?: boolean;
}

export interface ZAPayrollResult {
  employeeId: string;
  grossMonthly: number;
  /** Monthly taxable income after the retirement-fund deduction. */
  taxableMonthly: number;
  /** Annualised taxable income used for the bracket lookup. */
  annualTaxable: number;
  /** Monthly PAYE actually withheld (after rebates + medical credit, floored at 0). */
  paye: number;
  /** Monthly medical scheme fees tax credit applied against PAYE. */
  medicalTaxCredit: number;
  /** Monthly retirement-fund deduction allowed against taxable income. */
  retirementDeduction: number;
  uifEmployee: number;
  uifEmployer: number;
  /** Skills Development Levy (employer only). */
  sdl: number;
  /** Employment Tax Incentive — reduces the employer's PAYE remittance to SARS. */
  eti: number;
  totalEmployeeDeductions: number;
  netPay: number;
  /** UIF employer + SDL − ETI. */
  totalEmployerContributions: number;
  totalEmployerCost: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Cumulative annual PAYE on taxable income, before rebates. Marginal brackets. */
export function computeAnnualTaxBeforeRebate(
  annualTaxable: number,
  bands: ZATaxBand[] = ZA_PAYE_BANDS,
): number {
  let tax = 0;
  for (const band of bands) {
    if (annualTaxable <= band.min) break;
    const upper = band.max === Infinity ? annualTaxable : Math.min(annualTaxable, band.max);
    tax += ((upper - band.min) * band.rate) / 100;
  }
  return tax;
}

/** Age-based rebate (annual). Cumulative: 65+ adds secondary, 75+ adds tertiary. */
export function annualRebate(age: number): number {
  let rebate = ZA_PRIMARY_REBATE;
  if (age >= 65) rebate += ZA_SECONDARY_REBATE;
  if (age >= 75) rebate += ZA_TERTIARY_REBATE;
  return rebate;
}

/** Monthly medical scheme fees tax credit for a given number of beneficiaries. */
export function medicalTaxCredit(beneficiaries: number): number {
  if (!beneficiaries || beneficiaries <= 0) return 0;
  let credit = ZA_MTC_MAIN_MEMBER;
  if (beneficiaries >= 2) credit += ZA_MTC_FIRST_DEPENDANT;
  if (beneficiaries > 2) credit += (beneficiaries - 2) * ZA_MTC_ADDITIONAL_DEPENDANT;
  return credit;
}

/** Monthly retirement-fund deduction: min(contribution, 27.5% of gross, annual cap / 12). */
export function retirementDeduction(grossMonthly: number, contributionMonthly: number): number {
  if (!contributionMonthly || contributionMonthly <= 0) return 0;
  const pctCap = (grossMonthly * ZA_RETIREMENT_DEDUCTION_RATE) / 100;
  const annualCapMonthly = ZA_RETIREMENT_ANNUAL_CAP / ZA_MONTHS_PER_YEAR;
  return round2(Math.min(contributionMonthly, pctCap, annualCapMonthly));
}

/** UIF for one side (employee or employer): 1% of remuneration capped at the ceiling. */
export function uifContribution(grossMonthly: number): number {
  const base = Math.min(grossMonthly, ZA_UIF_MONTHLY_CEILING);
  return round2((base * ZA_UIF_RATE) / 100);
}

/** Employment Tax Incentive (monthly). 0 when the employee/period does not qualify. */
export function computeETI(
  grossMonthly: number,
  age: number,
  monthsClaimed: number,
  eligible: boolean,
): number {
  if (!eligible) return 0;
  if (age < ZA_ETI_MIN_AGE || age > ZA_ETI_MAX_AGE) return 0;
  if (grossMonthly <= 0 || grossMonthly > ZA_ETI_WAGE_CEILING) return 0;
  if (monthsClaimed >= ZA_ETI_SECOND_PERIOD_MONTHS) return 0;

  let amount: number;
  if (grossMonthly <= ZA_ETI_BAND1_MAX) {
    amount = grossMonthly * ZA_ETI_BAND1_RATE;
  } else if (grossMonthly <= ZA_ETI_BAND2_MAX) {
    amount = ZA_ETI_BAND2_AMOUNT;
  } else {
    amount = ZA_ETI_BAND2_AMOUNT - ZA_ETI_BAND3_TAPER * (grossMonthly - (ZA_ETI_BAND2_MAX + 0.01));
  }
  // Second 12 qualifying months pay half.
  if (monthsClaimed >= ZA_ETI_FIRST_PERIOD_MONTHS) amount /= 2;
  return round2(Math.max(0, amount));
}

/** Full SA monthly payroll computation. */
export function computeZAPayroll(input: ZAPayrollInput): ZAPayrollResult {
  const gross = input.grossMonthly;
  const age = input.age ?? 30;

  // 1. Retirement-fund deduction reduces taxable income.
  const retire = retirementDeduction(gross, input.retirementContributionMonthly ?? 0);
  const taxableMonthly = Math.max(0, gross - retire);

  // 2. Annualise, apply brackets, subtract the age rebate, de-annualise.
  const annualTaxable = taxableMonthly * ZA_MONTHS_PER_YEAR;
  const annualTaxBeforeRebate = computeAnnualTaxBeforeRebate(annualTaxable);
  const annualTaxAfterRebate = Math.max(0, annualTaxBeforeRebate - annualRebate(age));
  const monthlyTaxBeforeCredit = annualTaxAfterRebate / ZA_MONTHS_PER_YEAR;

  // 3. Medical scheme tax credit reduces PAYE (never below 0).
  const mtc = medicalTaxCredit(input.medicalAidBeneficiaries ?? 0);
  const paye = round2(Math.max(0, monthlyTaxBeforeCredit - mtc));

  // 4. UIF (capped, both sides) and SDL (employer, if applicable).
  const uifEmployee = uifContribution(gross);
  const uifEmployer = uifContribution(gross);
  const sdl = (input.sdlApplicable ?? true) ? round2((gross * ZA_SDL_RATE) / 100) : 0;

  // 5. ETI — employer PAYE incentive (does not change employee PAYE).
  const eti = computeETI(gross, age, input.etiMonthsClaimed ?? 0, input.etiEligible ?? false);

  const totalEmployeeDeductions = round2(paye + uifEmployee);
  const totalEmployerContributions = round2(uifEmployer + sdl - eti);

  return {
    employeeId: input.employeeId,
    grossMonthly: gross,
    taxableMonthly: round2(taxableMonthly),
    annualTaxable: round2(annualTaxable),
    paye,
    medicalTaxCredit: round2(mtc),
    retirementDeduction: retire,
    uifEmployee,
    uifEmployer,
    sdl,
    eti,
    totalEmployeeDeductions,
    netPay: round2(gross - totalEmployeeDeductions),
    totalEmployerContributions,
    totalEmployerCost: round2(gross + uifEmployer + sdl),
  };
}
