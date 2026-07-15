// ============================================================================
// CONFIG-DRIVEN COUNTRY PAYROLL ENGINE
// A single compute kernel driven by a per-country CountryPayrollConfig — real
// income-tax brackets, mandatory contribution funds (the local equivalents of
// India's PF/ESIC), and payroll levies. Countries with genuinely bespoke logic
// (IN, US, UK, ZA) keep their dedicated services; everything else is data.
//
// All config monetary values are in the country's MAJOR currency unit (e.g. EUR,
// not cents). computeCountryPayroll works in major units; callers holding the
// smallest unit convert via subunitDivisor (100 normally, 1 for JPY/KRW).
// ============================================================================

export interface TaxBand {
  /** Annual lower bound (exclusive of prior band), in major currency units. */
  min: number;
  /** Annual upper bound (inclusive); Infinity for the top band. */
  max: number;
  /** Marginal percentage. */
  rate: number;
}

export type FundPurpose =
  | "pension"
  | "health"
  | "unemployment"
  | "disability"
  | "general"
  | "training"
  | "housing";

export interface ContributionFund {
  name: string;
  purpose: FundPurpose;
  /** Percent of the (capped) contribution base. */
  employeeRate: number;
  employerRate: number;
  /** Monthly contribution-base ceiling in major units; undefined = uncapped. */
  monthlyCap?: number;
  /** Monthly contribution-base floor in major units. */
  monthlyFloor?: number;
  /** Fixed monthly amounts on top of the rate (major units). */
  employeeFlatMonthly?: number;
  employerFlatMonthly?: number;
}

export interface PayrollLevy {
  name: string;
  rate: number; // percent
  paidBy: "employee" | "employer";
  /** Base the rate applies to: gross pay, or the computed income tax (surcharge/cess-style). */
  base: "gross" | "income_tax";
}

export interface CountryPayrollConfig {
  code: string;
  name: string;
  currency: string;
  /** 100 for currencies with a minor unit; 1 for JPY / KRW etc. */
  subunitDivisor: number;
  taxYear: string;
  incomeTax: {
    system: "progressive" | "flat" | "none";
    /** Annual marginal brackets, in major units. Empty for flat/none. */
    annualBands: TaxBand[];
    /** Annual tax-free allowance / standard deduction (major units). */
    annualAllowance?: number;
    /** Flat annual tax credit subtracted after the bands (major units). */
    annualRebate?: number;
    /** Flat-rate percentage, when system === "flat". */
    flatRate?: number;
  };
  funds: ContributionFund[];
  levies?: PayrollLevy[];
  notes?: string;
}

export interface CountryPayrollResult {
  code: string;
  grossMonthly: number;
  incomeTaxMonthly: number;
  employeeContribMonthly: number;
  employerContribMonthly: number;
  leviesEmployeeMonthly: number;
  leviesEmployerMonthly: number;
  totalEmployeeDeductions: number;
  netPay: number;
  totalEmployerCost: number;
  fundBreakdown: { name: string; employee: number; employer: number }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Marginal tax on an annual amount over the given bands. */
export function marginalTax(annual: number, bands: TaxBand[]): number {
  let tax = 0;
  for (const b of bands) {
    if (annual <= b.min) break;
    const upper = b.max === Infinity ? annual : Math.min(annual, b.max);
    tax += ((upper - b.min) * b.rate) / 100;
  }
  return tax;
}

export function computeIncomeTaxMonthly(cfg: CountryPayrollConfig, grossMonthly: number): number {
  const it = cfg.incomeTax;
  if (it.system === "none") return 0;
  if (it.system === "flat" && it.flatRate != null) {
    const monthlyAllowance = (it.annualAllowance ?? 0) / 12;
    return round2(Math.max(0, grossMonthly - monthlyAllowance) * (it.flatRate / 100));
  }
  // progressive — annualise, apply bands, subtract rebate, de-annualise
  const annualTaxable = Math.max(0, grossMonthly * 12 - (it.annualAllowance ?? 0));
  const annualTax = Math.max(
    0,
    marginalTax(annualTaxable, it.annualBands) - (it.annualRebate ?? 0),
  );
  return round2(annualTax / 12);
}

export function computeCountryPayroll(
  cfg: CountryPayrollConfig,
  grossMonthly: number,
): CountryPayrollResult {
  const incomeTaxMonthly = computeIncomeTaxMonthly(cfg, grossMonthly);

  let employeeContribMonthly = 0;
  let employerContribMonthly = 0;
  const fundBreakdown: { name: string; employee: number; employer: number }[] = [];
  for (const f of cfg.funds) {
    const capped = Math.min(f.monthlyCap ?? Infinity, grossMonthly);
    const base = Math.max(f.monthlyFloor ?? 0, capped);
    const ee = round2((base * f.employeeRate) / 100 + (f.employeeFlatMonthly ?? 0));
    const er = round2((base * f.employerRate) / 100 + (f.employerFlatMonthly ?? 0));
    employeeContribMonthly += ee;
    employerContribMonthly += er;
    fundBreakdown.push({ name: f.name, employee: ee, employer: er });
  }

  let leviesEmployeeMonthly = 0;
  let leviesEmployerMonthly = 0;
  for (const l of cfg.levies ?? []) {
    const base = l.base === "income_tax" ? incomeTaxMonthly : grossMonthly;
    const amt = round2((base * l.rate) / 100);
    if (l.paidBy === "employee") leviesEmployeeMonthly += amt;
    else leviesEmployerMonthly += amt;
  }

  const totalEmployeeDeductions = round2(
    incomeTaxMonthly + employeeContribMonthly + leviesEmployeeMonthly,
  );
  return {
    code: cfg.code,
    grossMonthly,
    incomeTaxMonthly,
    employeeContribMonthly: round2(employeeContribMonthly),
    employerContribMonthly: round2(employerContribMonthly),
    leviesEmployeeMonthly: round2(leviesEmployeeMonthly),
    leviesEmployerMonthly: round2(leviesEmployerMonthly),
    totalEmployeeDeductions,
    netPay: round2(grossMonthly - totalEmployeeDeductions),
    totalEmployerCost: round2(grossMonthly + employerContribMonthly + leviesEmployerMonthly),
    fundBreakdown,
  };
}

// ---------------------------------------------------------------------------
// Adapter for the global-payroll engine, which works in the smallest currency
// unit and expects a { tax_amount, social_security_*, ... } shape.
// ---------------------------------------------------------------------------
export interface ConfigDeductionResult {
  tax_amount: number;
  social_security_employee: number;
  social_security_employer: number;
  pension_employee: number;
  pension_employer: number;
  health_insurance_employee: number;
  health_insurance_employer: number;
  other_deductions: number;
}

export function deductionsFromConfig(
  cfg: CountryPayrollConfig,
  grossMonthlyMinor: number,
): ConfigDeductionResult {
  const grossMajor = grossMonthlyMinor / cfg.subunitDivisor;
  const r = computeCountryPayroll(cfg, grossMajor);
  const m = cfg.subunitDivisor;
  return {
    tax_amount: Math.round((r.incomeTaxMonthly + r.leviesEmployeeMonthly) * m),
    social_security_employee: Math.round(r.employeeContribMonthly * m),
    social_security_employer: Math.round((r.employerContribMonthly + r.leviesEmployerMonthly) * m),
    pension_employee: 0,
    pension_employer: 0,
    health_insurance_employee: 0,
    health_insurance_employer: 0,
    other_deductions: 0,
  };
}
