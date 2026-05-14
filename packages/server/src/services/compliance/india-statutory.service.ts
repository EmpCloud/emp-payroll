// ============================================================================
// INDIA STATUTORY CONTRIBUTIONS — PF, ESI, Professional Tax
// ============================================================================

import {
  PF_WAGE_CEILING,
  PF_EMPLOYEE_RATE,
  PF_EMPLOYER_EPF_RATE,
  PF_EMPLOYER_EPS_RATE,
  PF_ADMIN_CHARGES_RATE,
  PF_EDLI_CHARGES_RATE,
  PF_EPS_SALARY_CEILING,
  ESI_WAGE_CEILING,
  ESI_EMPLOYEE_RATE,
  ESI_EMPLOYER_RATE,
  PT_SLABS,
  PFContribution,
  ESIContribution,
  ProfessionalTax,
} from "@emp-payroll/shared";

// ---------------------------------------------------------------------------
// Org-level statutory overrides (migration 029).
// Every field is optional. NULL/undefined => fall back to the global
// India constants imported above. Pass a plain object loaded from the
// `organization_payroll_settings` row (snake_case mapped to camelCase
// where applicable).
// ---------------------------------------------------------------------------
export interface OrgStatutoryOverrides {
  pfApplyFullBasic?: boolean | null;
  pfMaxEmployeeContribution?: number | null;
  pfDefaultEmployeeRate?: number | null;
  esiWageCeiling?: number | null;
  roundingPolicy?: "none" | "nearest_1" | "nearest_10" | "nearest_100" | string | null;
  // Migration 034 — independent on/off switches for the two employer-side
  // EPF charges. NULL/undefined => enabled (the long-standing default).
  // Only an explicit `false` zeroes the charge out.
  pfEdliEnabled?: boolean | null;
  pfAdminEnabled?: boolean | null;
  // Migration 032 — when true, the offer-letter CTC already includes the
  // employer's PF / ESI / EDLI / admin contributions, so payroll reports
  // total_employer_cost = gross_salary instead of gross + employer cost
  // on top. Doesn't change the math the engine returns -- the employer
  // contribution numbers are still accurate per row -- it just changes
  // how the payroll-run roll-up frames "Total Cost to Company".
  employerPfInCtc?: boolean | null;
}

/**
 * Round a monetary amount according to an org-level rounding policy.
 * Default ("none" or unset) preserves the existing per-line Math.round
 * behaviour so this is a no-op until the org opts in.
 */
export function applyRounding(amount: number, policy?: string | null): number {
  if (!Number.isFinite(amount)) return 0;
  switch (policy) {
    case "nearest_100":
      return Math.round(amount / 100) * 100;
    case "nearest_10":
      return Math.round(amount / 10) * 10;
    case "nearest_1":
      return Math.round(amount);
    case "none":
    case "":
    case null:
    case undefined:
    default:
      return amount;
  }
}

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
  orgOverrides?: OrgStatutoryOverrides;
}): PFContribution {
  const {
    employeeId,
    month,
    year,
    basicSalary,
    daAmount = 0,
    isVoluntaryPF = false,
    vpfRate = 0,
    orgOverrides,
  } = params;

  // Effective contribution rate resolution order (most specific first):
  //   1. explicit per-employee rate passed in (employee profile)
  //   2. org-level default rate (migration 029)
  //   3. India constant (12%)
  // This lets HR set an org-wide default (e.g. 12% for everyone) and still
  // allow per-employee VPF overrides on top.
  const effectiveRate =
    typeof params.contributionRate === "number"
      ? params.contributionRate
      : typeof orgOverrides?.pfDefaultEmployeeRate === "number"
        ? orgOverrides.pfDefaultEmployeeRate
        : PF_EMPLOYEE_RATE;

  // PF wages = Basic + DA. Org may opt to apply the rate to actual basic+DA
  // (true) instead of capping at PF_WAGE_CEILING (₹15,000, the default).
  // EPS wages always cap at PF_EPS_SALARY_CEILING regardless -- that ceiling
  // is mandated by the EPS scheme itself, not configurable per employer.
  const pfWages = orgOverrides?.pfApplyFullBasic
    ? basicSalary + daAmount
    : Math.min(basicSalary + daAmount, PF_WAGE_CEILING);
  const epsWages = Math.min(basicSalary + daAmount, PF_EPS_SALARY_CEILING);

  let employeeEPF = Math.round((pfWages * effectiveRate) / 100);
  // Hard ₹ cap on the employee's monthly EPF deduction. Common request:
  // "cap at ₹1,800 even if basic × rate would be higher" -- e.g. an org
  // with apply-full-basic=true and a basic of ₹50,000 would otherwise
  // deduct ₹6,000 at 12%. The cap protects the employee's take-home and
  // keeps the org compliant with its stated PF policy.
  if (
    typeof orgOverrides?.pfMaxEmployeeContribution === "number" &&
    orgOverrides.pfMaxEmployeeContribution >= 0 &&
    employeeEPF > orgOverrides.pfMaxEmployeeContribution
  ) {
    employeeEPF = Math.round(orgOverrides.pfMaxEmployeeContribution);
  }
  const employerEPS = Math.round((epsWages * PF_EMPLOYER_EPS_RATE) / 100);
  const employerEPF = Math.round((pfWages * PF_EMPLOYER_EPF_RATE) / 100);
  // EDLI / PF Admin are employer-side charges the org can switch off
  // independently (migration 034). NULL/undefined keeps them on -- only an
  // explicit `false` zeroes the charge, so existing orgs see no change.
  const adminCharges =
    orgOverrides?.pfAdminEnabled === false
      ? 0
      : Math.round((pfWages * PF_ADMIN_CHARGES_RATE) / 100);
  const edliCharges =
    orgOverrides?.pfEdliEnabled === false ? 0 : Math.round((pfWages * PF_EDLI_CHARGES_RATE) / 100);

  const employeeVPF = isVoluntaryPF ? Math.round(((basicSalary + daAmount) * vpfRate) / 100) : 0;

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
  orgOverrides?: OrgStatutoryOverrides;
}): ESIContribution | null {
  const { employeeId, month, year, grossSalary, orgOverrides } = params;

  // Org may override the eligibility ceiling (some employers still use the
  // older ₹25k threshold or a custom one). Falls back to the India default
  // (ESI_WAGE_CEILING = 21000) when not set.
  const ceiling =
    typeof orgOverrides?.esiWageCeiling === "number" && orgOverrides.esiWageCeiling > 0
      ? orgOverrides.esiWageCeiling
      : ESI_WAGE_CEILING;

  // ESI applicable only if gross <= effective ceiling
  if (grossSalary > ceiling) {
    return null;
  }

  const employeeContribution = Math.round((grossSalary * ESI_EMPLOYEE_RATE) / 100);
  const employerContribution = Math.round((grossSalary * ESI_EMPLOYER_RATE) / 100);

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
