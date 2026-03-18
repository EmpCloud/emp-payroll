// ============================================================================
// UNIFIED TAX SERVICE
// Routes computation to the correct country engine.
// Add new countries by implementing a compute function and adding to the map.
// ============================================================================

import { computeIncomeTax } from "./india-tax.service";
import { computeUSPayroll, type USPayrollInput, type USPayrollResult } from "./us-tax.service";
import { computeUKPayroll, type UKPayrollInput, type UKPayrollResult } from "./uk-tax.service";

export type SupportedCountry = "IN" | "US" | "UK";

export const SUPPORTED_COUNTRIES: Record<SupportedCountry, string> = {
  IN: "India",
  US: "United States",
  UK: "United Kingdom",
};

export function isSupportedCountry(code: string): code is SupportedCountry {
  return code in SUPPORTED_COUNTRIES;
}

// Re-export all engines for direct access when needed
export { computeIncomeTax as computeIndiaTax } from "./india-tax.service";
export { computeUSPayroll } from "./us-tax.service";
export { computeUKPayroll } from "./uk-tax.service";

// Re-export types
export type { USPayrollInput, USPayrollResult } from "./us-tax.service";
export type { UKPayrollInput, UKPayrollResult } from "./uk-tax.service";
