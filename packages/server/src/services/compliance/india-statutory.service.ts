// ============================================================================
// INDIA STATUTORY CONTRIBUTIONS — PF, ESI, Professional Tax
// ============================================================================

import {
  PF_WAGE_CEILING, PF_EMPLOYEE_RATE, PF_EMPLOYER_EPF_RATE,
  PF_EMPLOYER_EPS_RATE, PF_ADMIN_CHARGES_RATE, PF_EDLI_CHARGES_RATE,
  PF_EPS_SALARY_CEILING,
  ESI_WAGE_CEILING, ESI_EMPLOYEE_RATE, ESI_EMPLOYER_RATE,
  PT_SLABS,
  PFContribution, ESIContribution, ProfessionalTax,
} from "@emp-payroll/shared";

// ---------------------------------------------------------------------------
// Provident Fund
// ---------------------------------------------------------------------------
export function computePF(params: {
  employeeId: string;
  month: number;
  year: number;
  basicSalary: number;
  daAmount?: number;
  isVoluntaryPF?: boolean;
  vpfRate?: number;
  contributionRate?: number;
}): PFContribution {
  const {
    employeeId, month, year, basicSalary,
    daAmount = 0, isVoluntaryPF = false, vpfRate = 0,
    contributionRate = PF_EMPLOYEE_RATE,
  } = params;

  // PF wages = Basic + DA, capped at ceiling (or actual if employer opts for full)
  const pfWages = Math.min(basicSalary + daAmount, PF_WAGE_CEILING);
  const epsWages = Math.min(basicSalary + daAmount, PF_EPS_SALARY_CEILING);

  const employeeEPF = Math.round(pfWages * contributionRate / 100);
  const employerEPS = Math.round(epsWages * PF_EMPLOYER_EPS_RATE / 100);
  const employerEPF = Math.round(pfWages * PF_EMPLOYER_EPF_RATE / 100);
  const adminCharges = Math.round(pfWages * PF_ADMIN_CHARGES_RATE / 100);
  const edliCharges = Math.round(pfWages * PF_EDLI_CHARGES_RATE / 100);

  const employeeVPF = isVoluntaryPF
    ? Math.round((basicSalary + daAmount) * vpfRate / 100)
    : 0;

  return {
    employeeId,
    month,
    year,
    pfWages,
    employeeEPF,
    employerEPF,
    employerEPS,
    employeeVPF,
    adminCharges,
    edliCharges,
    totalEmployer: employerEPF + employerEPS + adminCharges + edliCharges,
    totalEmployee: employeeEPF + employeeVPF,
  };
}

// ---------------------------------------------------------------------------
// Employee State Insurance (ESI)
// ---------------------------------------------------------------------------
export function computeESI(params: {
  employeeId: string;
  month: number;
  year: number;
  grossSalary: number;
}): ESIContribution | null {
  const { employeeId, month, year, grossSalary } = params;

  // ESI applicable only if gross <= ceiling
  if (grossSalary > ESI_WAGE_CEILING) {
    return null;
  }

  const employeeContribution = Math.round(grossSalary * ESI_EMPLOYEE_RATE / 100);
  const employerContribution = Math.round(grossSalary * ESI_EMPLOYER_RATE / 100);

  return {
    employeeId,
    month,
    year,
    esiWages: grossSalary,
    employeeContribution,
    employerContribution,
    total: employeeContribution + employerContribution,
  };
}

// ---------------------------------------------------------------------------
// Professional Tax (PT)
// ---------------------------------------------------------------------------
export function computeProfessionalTax(params: {
  employeeId: string;
  month: number;
  year: number;
  state: string;
  grossSalary: number;
}): ProfessionalTax {
  const { employeeId, month, year, state, grossSalary } = params;

  const slabs = PT_SLABS[state.toUpperCase()];
  let taxAmount = 0;

  if (slabs && slabs.length > 0) {
    for (const slab of slabs) {
      if (grossSalary >= slab.min && grossSalary <= slab.max) {
        taxAmount = slab.tax;
        break;
      }
    }

    // Maharashtra: Feb month has ₹300 for highest slab
    if (state.toUpperCase() === "MH" && month === 2 && grossSalary > 10000) {
      taxAmount = 300;
    }
  }

  return { employeeId, month, year, state, grossSalary, taxAmount };
}
