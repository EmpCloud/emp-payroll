// ============================================================================
// UK TAX COMPUTATION ENGINE
// PAYE income tax, NIC (employee + employer), student loan, pension.
// Supports cumulative and non-cumulative (Week 1/Month 1) basis.
// ============================================================================

import {
  UK_PAYE_BANDS, UK_PA_TAPER_THRESHOLD, UK_PA_TAPER_RATE,
  NIC_EMPLOYEE_PRIMARY_THRESHOLD_MONTHLY, NIC_EMPLOYEE_UPPER_EARNINGS_LIMIT_MONTHLY,
  NIC_EMPLOYEE_RATE_MAIN, NIC_EMPLOYEE_RATE_ABOVE_UEL,
  NIC_EMPLOYER_SECONDARY_THRESHOLD_MONTHLY, NIC_EMPLOYER_RATE,
  UK_STUDENT_LOAN_PLANS,
  PENSION_QUALIFYING_EARNINGS_LOWER, PENSION_QUALIFYING_EARNINGS_UPPER,
  PENSION_EMPLOYEE_MIN_RATE, PENSION_EMPLOYER_MIN_RATE,
  UK_PAY_PERIODS, parseTaxCode,
  type UKTaxRegion, type PensionMethod,
} from "@emp-payroll/shared";

export interface UKPayrollInput {
  employeeId: string;
  grossPay: number;
  payFrequency: "weekly" | "fortnightly" | "four_weekly" | "monthly";
  taxCode: string;
  region: UKTaxRegion;
  nicCategory: string;
  studentLoanPlans: string[];
  pensionMethod: PensionMethod;
  pensionEmployeeRate: number;
  pensionEmployerRate: number;
  periodNumber: number;
  ytdGross: number;
  ytdTaxPaid: number;
  ytdNicPaid: number;
}

export interface UKPayrollResult {
  employeeId: string;
  grossPay: number;
  incomeTax: number;
  employeeNIC: number;
  employerNIC: number;
  studentLoanDeductions: { plan: string; amount: number }[];
  totalStudentLoan: number;
  employeePension: number;
  employerPension: number;
  pensionablePay: number;
  totalDeductions: number;
  netPay: number;
  totalEmployerCost: number;
}

function computePAYE(input: UKPayrollInput): number {
  const parsed = parseTaxCode(input.taxCode);
  const periods = UK_PAY_PERIODS[input.payFrequency];

  if (parsed.isNT) return 0;
  if (parsed.isBR) return Math.round(input.grossPay * 20 / 100 * 100) / 100;
  if (parsed.isD0) return Math.round(input.grossPay * 40 / 100 * 100) / 100;
  if (parsed.isD1) return Math.round(input.grossPay * 45 / 100 * 100) / 100;

  const region: UKTaxRegion = parsed.isScottish ? "scotland" : parsed.isWelsh ? "wales" : input.region;
  const bands = UK_PAYE_BANDS[region];

  if (parsed.isNonCumulative) {
    const periodAllowance = parsed.allowance / periods;
    const taxable = Math.max(0, input.grossPay - periodAllowance);
    return computePeriodBandTax(taxable, bands, periods);
  }

  let annualAllowance = parsed.allowance;
  const projectedAnnual = (input.ytdGross + input.grossPay) / input.periodNumber * periods;
  if (projectedAnnual > UK_PA_TAPER_THRESHOLD) {
    const reduction = Math.floor((projectedAnnual - UK_PA_TAPER_THRESHOLD) * UK_PA_TAPER_RATE);
    annualAllowance = Math.max(0, annualAllowance - reduction);
  }

  const cumulativeFreePay = (annualAllowance / periods) * input.periodNumber;
  const cumulativeTaxable = Math.max(0, input.ytdGross + input.grossPay - cumulativeFreePay);
  const cumulativeTaxDue = computeCumulativeBandTax(cumulativeTaxable, bands, periods, input.periodNumber);
  let thisPeriodTax = Math.max(0, Math.round((cumulativeTaxDue - input.ytdTaxPaid) * 100) / 100);

  if (parsed.prefix === "K") {
    thisPeriodTax = Math.min(thisPeriodTax, Math.round(input.grossPay * 50 / 100 * 100) / 100);
  }

  return thisPeriodTax;
}

function computePeriodBandTax(taxable: number, bands: { min: number; max: number; rate: number }[], periods: number): number {
  let tax = 0;
  let remaining = taxable;
  for (const band of bands) {
    if (band.rate === 0) continue;
    const periodWidth = band.max === Infinity ? Infinity : (band.max - band.min + 1) / periods;
    const inBand = band.max === Infinity ? remaining : Math.min(remaining, periodWidth);
    if (inBand <= 0) break;
    tax += inBand * band.rate / 100;
    remaining -= inBand;
  }
  return Math.round(tax * 100) / 100;
}

function computeCumulativeBandTax(cumulativeTaxable: number, bands: { min: number; max: number; rate: number }[], periods: number, periodNumber: number): number {
  let tax = 0;
  let remaining = cumulativeTaxable;
  for (const band of bands) {
    if (band.rate === 0) continue;
    const cumWidth = band.max === Infinity ? Infinity : ((band.max - band.min + 1) / periods) * periodNumber;
    const inBand = band.max === Infinity ? remaining : Math.min(remaining, cumWidth);
    if (inBand <= 0) break;
    tax += inBand * band.rate / 100;
    remaining -= inBand;
  }
  return tax;
}

function computeNIC(grossPay: number, nicCategory: string): { employee: number; employer: number } {
  if (nicCategory.toUpperCase() === "C") {
    const employerNIable = Math.max(0, grossPay - NIC_EMPLOYER_SECONDARY_THRESHOLD_MONTHLY);
    return { employee: 0, employer: Math.round(employerNIable * NIC_EMPLOYER_RATE / 100 * 100) / 100 };
  }

  let employeeNIC = 0;
  if (grossPay > NIC_EMPLOYEE_PRIMARY_THRESHOLD_MONTHLY) {
    const mainBand = Math.min(grossPay, NIC_EMPLOYEE_UPPER_EARNINGS_LIMIT_MONTHLY) - NIC_EMPLOYEE_PRIMARY_THRESHOLD_MONTHLY;
    employeeNIC += Math.max(0, mainBand) * NIC_EMPLOYEE_RATE_MAIN / 100;
    if (grossPay > NIC_EMPLOYEE_UPPER_EARNINGS_LIMIT_MONTHLY) {
      employeeNIC += (grossPay - NIC_EMPLOYEE_UPPER_EARNINGS_LIMIT_MONTHLY) * NIC_EMPLOYEE_RATE_ABOVE_UEL / 100;
    }
  }

  const employerNIable = Math.max(0, grossPay - NIC_EMPLOYER_SECONDARY_THRESHOLD_MONTHLY);
  const employerNIC = employerNIable * NIC_EMPLOYER_RATE / 100;

  return { employee: Math.round(employeeNIC * 100) / 100, employer: Math.round(employerNIC * 100) / 100 };
}

function computeStudentLoan(grossPay: number, plans: string[]): { plan: string; amount: number }[] {
  return plans.map((planKey) => {
    const plan = UK_STUDENT_LOAN_PLANS[planKey];
    if (!plan) return { plan: planKey, amount: 0 };
    const excess = Math.max(0, grossPay - plan.monthlyThreshold);
    return { plan: planKey, amount: Math.round(excess * plan.rate / 100 * 100) / 100 };
  }).filter((d) => d.amount > 0);
}

function computePension(grossPay: number, employeeRate: number, employerRate: number) {
  const lowerMonthly = PENSION_QUALIFYING_EARNINGS_LOWER / 12;
  const upperMonthly = PENSION_QUALIFYING_EARNINGS_UPPER / 12;
  const pensionablePay = Math.max(0, Math.min(grossPay, upperMonthly) - lowerMonthly);
  return {
    employee: Math.round(pensionablePay * employeeRate / 100 * 100) / 100,
    employer: Math.round(pensionablePay * employerRate / 100 * 100) / 100,
    pensionablePay: Math.round(pensionablePay * 100) / 100,
  };
}

export function computeUKPayroll(input: UKPayrollInput): UKPayrollResult {
  const incomeTax = computePAYE(input);
  const nic = computeNIC(input.grossPay, input.nicCategory);
  const studentLoanDeductions = computeStudentLoan(input.grossPay, input.studentLoanPlans);
  const totalStudentLoan = studentLoanDeductions.reduce((s, d) => s + d.amount, 0);
  const pension = computePension(
    input.grossPay,
    input.pensionEmployeeRate || PENSION_EMPLOYEE_MIN_RATE,
    input.pensionEmployerRate || PENSION_EMPLOYER_MIN_RATE,
  );
  const totalDeductions = incomeTax + nic.employee + totalStudentLoan + pension.employee;

  return {
    employeeId: input.employeeId,
    grossPay: input.grossPay,
    incomeTax,
    employeeNIC: nic.employee,
    employerNIC: nic.employer,
    studentLoanDeductions,
    totalStudentLoan,
    employeePension: pension.employee,
    employerPension: pension.employer,
    pensionablePay: pension.pensionablePay,
    totalDeductions,
    netPay: Math.round((input.grossPay - totalDeductions) * 100) / 100,
    totalEmployerCost: Math.round((input.grossPay + nic.employer + pension.employer) * 100) / 100,
  };
}
