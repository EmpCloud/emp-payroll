// ============================================================================
// US TAX COMPUTATION ENGINE
// Federal income tax (W-4 based), FICA (SS + Medicare), state income tax.
// ============================================================================

import {
  US_FED_BRACKETS as US_FEDERAL_BRACKETS, US_STANDARD_DEDUCTION,
  FICA_SS_EMPLOYEE_RATE as SOCIAL_SECURITY_RATE_EMPLOYEE,
  FICA_SS_EMPLOYER_RATE as SOCIAL_SECURITY_RATE_EMPLOYER,
  FICA_SS_WAGE_BASE as SOCIAL_SECURITY_WAGE_BASE,
  FICA_MEDICARE_EMPLOYEE_RATE as MEDICARE_RATE_EMPLOYEE,
  FICA_MEDICARE_EMPLOYER_RATE as MEDICARE_RATE_EMPLOYER,
  FICA_MEDICARE_ADDITIONAL_RATE as MEDICARE_ADDITIONAL_RATE,
  FICA_MEDICARE_ADDITIONAL_THRESHOLD_SINGLE,
  FICA_MEDICARE_ADDITIONAL_THRESHOLD_MFJ,
  FUTA_EFFECTIVE_RATE, FUTA_WAGE_BASE,
  US_STATE_TAX as US_STATE_TAXES, US_PAY_PERIODS,
  type USFilingStatus,
} from "@emp-payroll/shared";

interface W4Info {
  filingStatus: USFilingStatus;
  otherIncome: number;
  deductions: number;
  dependentCredit: number;
  extraWithholding: number;
}

const MEDICARE_ADDITIONAL_THRESHOLDS: Record<USFilingStatus, number> = {
  single: FICA_MEDICARE_ADDITIONAL_THRESHOLD_SINGLE,
  married_filing_jointly: FICA_MEDICARE_ADDITIONAL_THRESHOLD_MFJ,
  married_filing_separately: 125000,
  head_of_household: FICA_MEDICARE_ADDITIONAL_THRESHOLD_SINGLE,
};

export interface USPayrollInput {
  employeeId: string;
  grossPay: number;
  payFrequency: "weekly" | "bi_weekly" | "semi_monthly" | "monthly";
  w4: W4Info;
  stateCode: string;
  ytdGross: number;
  ytdSocialSecurity: number;
  pretaxDeductions: number;
}

export interface USPayrollResult {
  employeeId: string;
  grossPay: number;
  federalTax: number;
  socialSecurity: number;
  medicare: number;
  additionalMedicare: number;
  stateTax: number;
  totalEmployeeDeductions: number;
  netPay: number;
  employerSocialSecurity: number;
  employerMedicare: number;
  employerFuta: number;
  totalEmployerTaxes: number;
}

function computeBracketTax(income: number, brackets: readonly { min: number; max: number; rate: number }[]): number {
  let tax = 0;
  let remaining = income;
  for (const bracket of brackets) {
    if (remaining <= 0) break;
    const width = bracket.max === Infinity ? remaining : Math.min(remaining, bracket.max - bracket.min + 1);
    tax += width * bracket.rate / 100;
    remaining -= width;
  }
  return Math.round(tax * 100) / 100;
}

function computeFederalWithholding(input: USPayrollInput): number {
  const { grossPay, payFrequency, w4, pretaxDeductions } = input;
  const periods = US_PAY_PERIODS[payFrequency];
  const annualGross = (grossPay - pretaxDeductions) * periods;
  const totalIncome = annualGross + w4.otherIncome;
  const standardDed = US_STANDARD_DEDUCTION[w4.filingStatus];
  const totalDeductions = Math.max(standardDed, standardDed + w4.deductions);
  const taxableIncome = Math.max(0, totalIncome - totalDeductions);
  const brackets = US_FEDERAL_BRACKETS[w4.filingStatus];
  let annualTax = computeBracketTax(taxableIncome, brackets);
  annualTax = Math.max(0, annualTax - w4.dependentCredit);
  const perPeriod = Math.round((annualTax / periods + w4.extraWithholding) * 100) / 100;
  return Math.max(0, perPeriod);
}

function computeFICA(input: USPayrollInput) {
  const { grossPay, w4, ytdGross } = input;
  const ssWagesRemaining = Math.max(0, SOCIAL_SECURITY_WAGE_BASE - Math.min(ytdGross, SOCIAL_SECURITY_WAGE_BASE));
  const ssWages = Math.min(grossPay, ssWagesRemaining);
  const socialSecurity = Math.round(ssWages * SOCIAL_SECURITY_RATE_EMPLOYEE / 100 * 100) / 100;
  const employerSS = Math.round(ssWages * SOCIAL_SECURITY_RATE_EMPLOYER / 100 * 100) / 100;
  const medicare = Math.round(grossPay * MEDICARE_RATE_EMPLOYEE / 100 * 100) / 100;
  const employerMedicare = Math.round(grossPay * MEDICARE_RATE_EMPLOYER / 100 * 100) / 100;
  const threshold = MEDICARE_ADDITIONAL_THRESHOLDS[w4.filingStatus];
  let additionalMedicare = 0;
  if (ytdGross + grossPay > threshold) {
    const wagesAbove = Math.max(0, (ytdGross + grossPay) - threshold) - Math.max(0, ytdGross - threshold);
    additionalMedicare = Math.round(wagesAbove * MEDICARE_ADDITIONAL_RATE / 100 * 100) / 100;
  }
  return { socialSecurity, medicare, additionalMedicare, employerSS, employerMedicare };
}

function computeStateTax(input: USPayrollInput): number {
  const stateTax = US_STATE_TAXES[input.stateCode.toUpperCase()];
  if (!stateTax || !stateTax.hasIncomeTax) return 0;
  const periods = US_PAY_PERIODS[input.payFrequency];
  const annualGross = (input.grossPay - input.pretaxDeductions) * periods;
  const taxable = Math.max(0, annualGross - (stateTax.standardDeduction || 0));
  let rate: number;
  if (stateTax.type === "flat" && stateTax.flatRate) { rate = stateTax.flatRate; }
  else if (stateTax.brackets && stateTax.brackets.length > 0) { rate = stateTax.brackets[stateTax.brackets.length - 1].rate * 0.7; }
  else { return 0; }
  return Math.round(taxable * rate / 100 / periods * 100) / 100;
}

function computeFUTA(grossPay: number, ytdGross: number): number {
  const remaining = Math.max(0, FUTA_WAGE_BASE - ytdGross);
  return Math.round(Math.min(grossPay, remaining) * FUTA_EFFECTIVE_RATE / 100 * 100) / 100;
}

export function computeUSPayroll(input: USPayrollInput): USPayrollResult {
  const federalTax = computeFederalWithholding(input);
  const fica = computeFICA(input);
  const stateTax = computeStateTax(input);
  const futa = computeFUTA(input.grossPay, input.ytdGross);
  const totalEmployeeDeductions = federalTax + fica.socialSecurity + fica.medicare + fica.additionalMedicare + stateTax + input.pretaxDeductions;
  return {
    employeeId: input.employeeId,
    grossPay: input.grossPay,
    federalTax,
    socialSecurity: fica.socialSecurity,
    medicare: fica.medicare,
    additionalMedicare: fica.additionalMedicare,
    stateTax,
    totalEmployeeDeductions,
    netPay: Math.round((input.grossPay - totalEmployeeDeductions) * 100) / 100,
    employerSocialSecurity: fica.employerSS,
    employerMedicare: fica.employerMedicare,
    employerFuta: futa,
    totalEmployerTaxes: fica.employerSS + fica.employerMedicare + futa,
  };
}
