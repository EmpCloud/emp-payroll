// ============================================================================
// UNIFIED TAX SERVICE
// Routes computation to the correct country engine.
// Add new countries by implementing a compute function and adding to the map.
// ============================================================================

import { computeIncomeTax } from "./india-tax.service";
import { computeUSPayroll, type USPayrollInput, type USPayrollResult } from "./us-tax.service";
import { computeUKPayroll, type UKPayrollInput, type UKPayrollResult } from "./uk-tax.service";
import { computeZAPayroll, type ZAPayrollInput, type ZAPayrollResult } from "./za-tax.service";
import { COUNTRY_CONFIGS } from "./country-configs";

// Countries with a dedicated engine. NOTE: use the ISO code the countries table
// stores — the UK row is "GB" (was previously mismatched as "UK" here, so the
// registry never matched the real country row).
export type DedicatedEngineCountry = "IN" | "US" | "GB" | "ZA";

export const DEDICATED_ENGINE_COUNTRIES: Record<DedicatedEngineCountry, string> = {
  IN: "India",
  US: "United States",
  GB: "United Kingdom",
  ZA: "South Africa",
};

/** Every country the payroll system can compute for — dedicated engines + config-driven. */
export function isSupportedCountry(code: string): boolean {
  const c = code.toUpperCase();
  return c in DEDICATED_ENGINE_COUNTRIES || c in COUNTRY_CONFIGS;
}

export const SUPPORTED_COUNTRY_CODES: string[] = [
  ...Object.keys(DEDICATED_ENGINE_COUNTRIES),
  ...Object.keys(COUNTRY_CONFIGS),
];

// Re-export all engines for direct access when needed
export { computeIncomeTax as computeIndiaTax } from "./india-tax.service";
export { computeUSPayroll } from "./us-tax.service";
export { computeUKPayroll } from "./uk-tax.service";
export { computeZAPayroll } from "./za-tax.service";

// Re-export types
export type { USPayrollInput, USPayrollResult } from "./us-tax.service";
export type { UKPayrollInput, UKPayrollResult } from "./uk-tax.service";
export type { ZAPayrollInput, ZAPayrollResult } from "./za-tax.service";
