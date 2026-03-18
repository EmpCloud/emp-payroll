// ============================================================================
// INDIA TAX CALCULATION ENGINE
// Computes TDS based on projected annual income, regime, and declarations.
// ============================================================================

import {
  TAX_SLABS_OLD, TAX_SLABS_NEW,
  STANDARD_DEDUCTION_OLD, STANDARD_DEDUCTION_NEW,
  REBATE_87A_OLD_LIMIT, REBATE_87A_OLD_MAX,
  REBATE_87A_NEW_LIMIT, REBATE_87A_NEW_MAX,
  MARGINAL_RELIEF_THRESHOLD_NEW,
  SURCHARGE_SLABS, SURCHARGE_CAP_NEW_REGIME, CESS_RATE,
  SECTION_80C_LIMIT, SECTION_80CCD_1B_LIMIT,
  PF_EMPLOYEE_RATE, PF_WAGE_CEILING,
  TaxRegime, TaxComputation, TaxDeduction, TaxExemption,
} from "@emp-payroll/shared";

interface TaxInput {
  employeeId: string;
  financialYear: string;
  regime: TaxRegime;
  annualGross: number;
  basicAnnual: number;
  hraAnnual: number;
  rentPaidAnnual: number;
  isMetroCity: boolean;
  declarations: { section: string; amount: number }[];
  employeePfAnnual: number;
  monthsWorked: number; // months remaining in FY
  taxAlreadyPaid: number;
}

export function computeIncomeTax(input: TaxInput): TaxComputation {
  const {
    regime, annualGross, basicAnnual, hraAnnual,
    rentPaidAnnual, isMetroCity, declarations,
    employeePfAnnual, monthsWorked, taxAlreadyPaid,
  } = input;

  let grossIncome = annualGross;
  const exemptions: TaxExemption[] = [];
  const deductions: TaxDeduction[] = [];

  // -----------------------------------------------------------------------
  // Step 1: Standard Deduction
  // -----------------------------------------------------------------------
  const stdDeduction = regime === TaxRegime.OLD ? STANDARD_DEDUCTION_OLD : STANDARD_DEDUCTION_NEW;
  exemptions.push({ code: "STD_DED", description: "Standard deduction", amount: stdDeduction });

  if (regime === TaxRegime.OLD) {
    // ---------------------------------------------------------------------
    // Step 2: HRA Exemption (Old Regime only)
    // ---------------------------------------------------------------------
    if (hraAnnual > 0 && rentPaidAnnual > 0) {
      const hraExempt = Math.min(
        hraAnnual,
        rentPaidAnnual - 0.1 * basicAnnual,
        (isMetroCity ? 0.5 : 0.4) * basicAnnual
      );
      if (hraExempt > 0) {
        exemptions.push({ code: "HRA", description: "HRA exemption", amount: Math.round(hraExempt) });
      }
    }

    // ---------------------------------------------------------------------
    // Step 3: Section 80C (Old Regime only)
    // ---------------------------------------------------------------------
    let total80C = employeePfAnnual; // EPF counts towards 80C
    const declared80C = declarations
      .filter((d) => d.section === "80C")
      .reduce((sum, d) => sum + d.amount, 0);
    total80C += declared80C;
    const allowed80C = Math.min(total80C, SECTION_80C_LIMIT);
    deductions.push({
      section: "80C",
      description: "Sec 80C (EPF + declared)",
      declaredAmount: total80C,
      maxAllowed: SECTION_80C_LIMIT,
      allowedAmount: allowed80C,
    });

    // 80CCD(1B) — NPS
    const nps = declarations.find((d) => d.section === "80CCD_1B");
    if (nps) {
      deductions.push({
        section: "80CCD(1B)",
        description: "NPS additional",
        declaredAmount: nps.amount,
        maxAllowed: SECTION_80CCD_1B_LIMIT,
        allowedAmount: Math.min(nps.amount, SECTION_80CCD_1B_LIMIT),
      });
    }

    // 80D — Medical Insurance
    const med = declarations.find((d) => d.section === "80D");
    if (med) {
      deductions.push({
        section: "80D",
        description: "Medical insurance",
        declaredAmount: med.amount,
        maxAllowed: 25000,
        allowedAmount: Math.min(med.amount, 25000),
      });
    }

    // Other declared sections (80E, 80G, 80TTA, etc.)
    const knownSections = ["80C", "80CCD_1B", "80D"];
    for (const decl of declarations.filter((d) => !knownSections.includes(d.section))) {
      deductions.push({
        section: decl.section,
        description: `Section ${decl.section}`,
        declaredAmount: decl.amount,
        maxAllowed: decl.amount,
        allowedAmount: decl.amount,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Step 4: Compute Taxable Income
  // -----------------------------------------------------------------------
  const totalExemptions = exemptions.reduce((s, e) => s + e.amount, 0);
  const totalDeductions = deductions.reduce((s, d) => s + d.allowedAmount, 0);
  const taxableIncome = Math.max(0, grossIncome - totalExemptions - totalDeductions);

  // -----------------------------------------------------------------------
  // Step 5: Compute Tax on Income
  // -----------------------------------------------------------------------
  const slabs = regime === TaxRegime.OLD ? TAX_SLABS_OLD : TAX_SLABS_NEW;
  let taxOnIncome = computeSlabTax(taxableIncome, slabs);

  // -----------------------------------------------------------------------
  // Step 6: Rebate u/s 87A
  // -----------------------------------------------------------------------
  if (regime === TaxRegime.OLD && taxableIncome <= REBATE_87A_OLD_LIMIT) {
    taxOnIncome = Math.max(0, taxOnIncome - REBATE_87A_OLD_MAX);
  } else if (regime === TaxRegime.NEW && taxableIncome <= REBATE_87A_NEW_LIMIT) {
    taxOnIncome = Math.max(0, taxOnIncome - REBATE_87A_NEW_MAX);
  }

  // Marginal relief for new regime (income between 12L and 12.75L)
  if (regime === TaxRegime.NEW && taxableIncome > REBATE_87A_NEW_LIMIT && taxableIncome <= MARGINAL_RELIEF_THRESHOLD_NEW) {
    const excessIncome = taxableIncome - REBATE_87A_NEW_LIMIT;
    if (taxOnIncome > excessIncome) {
      taxOnIncome = excessIncome;
    }
  }

  // -----------------------------------------------------------------------
  // Step 7: Surcharge
  // -----------------------------------------------------------------------
  let surcharge = 0;
  for (const slab of SURCHARGE_SLABS) {
    if (taxableIncome >= slab.min && taxableIncome <= slab.max) {
      surcharge = Math.round(taxOnIncome * slab.rate / 100);
      break;
    }
  }
  // Cap surcharge for new regime
  if (regime === TaxRegime.NEW) {
    surcharge = Math.min(surcharge, Math.round(taxOnIncome * SURCHARGE_CAP_NEW_REGIME / 100));
  }

  // -----------------------------------------------------------------------
  // Step 8: Health & Education Cess
  // -----------------------------------------------------------------------
  const cess = Math.round((taxOnIncome + surcharge) * CESS_RATE / 100);

  // -----------------------------------------------------------------------
  // Step 9: Total Tax and Monthly TDS
  // -----------------------------------------------------------------------
  const totalTax = taxOnIncome + surcharge + cess;
  const remainingTax = Math.max(0, totalTax - taxAlreadyPaid);
  const remainingMonths = Math.max(1, monthsWorked);
  const monthlyTds = Math.round(remainingTax / remainingMonths);

  return {
    id: "", // assigned by DB
    employeeId: input.employeeId,
    financialYear: input.financialYear,
    regime,
    grossIncome,
    exemptions,
    totalExemptions,
    deductions,
    totalDeductions,
    taxableIncome,
    taxOnIncome,
    surcharge,
    healthAndEducationCess: cess,
    totalTax,
    taxAlreadyPaid,
    remainingTax,
    monthlyTds,
    computedAt: new Date(),
  };
}

function computeSlabTax(income: number, slabs: readonly { min: number; max: number; rate: number }[]): number {
  let tax = 0;
  let remaining = income;

  for (const slab of slabs) {
    if (remaining <= 0) break;
    const slabWidth = slab.max === Infinity ? remaining : Math.min(remaining, slab.max - slab.min + 1);
    tax += Math.round(slabWidth * slab.rate / 100);
    remaining -= slabWidth;
  }

  return tax;
}
