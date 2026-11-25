// ============================================================================
// INDIA STATUTORY CONTRIBUTIONS — PF, ESI, Professional Tax
// ============================================================================

import {
  computeIndiaPF,
  type ComputeIndiaPFParams,
  ESI_WAGE_CEILING,
  ESI_EMPLOYEE_RATE,
  ESI_EMPLOYER_RATE,
  professionalTaxAmount,
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
  // employer's PF / ESI / EDLI / admin contributions. Payroll allocates
  // regular gross inside that budget before computing employee deductions.
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
export function computePF(params: ComputeIndiaPFParams): PFContribution {
  return computeIndiaPF(params);
}

// ---------------------------------------------------------------------------
// Employee State Insurance (ESI)
// ---------------------------------------------------------------------------
export function computeESI(params: {
  employeeId: string;
  month: number;
  year: number;
  grossSalary: number;
  eligibilityWages?: number;
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
  if ((params.eligibilityWages ?? grossSalary) > ceiling) {
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

  const taxAmount = professionalTaxAmount(state, grossSalary, month, year);

  return { employeeId, month, year, state, grossSalary, taxAmount };
}
