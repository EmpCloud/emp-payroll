// =============================================================================
// MIGRATION 029 — Org-level statutory overrides
// -----------------------------------------------------------------------------
// Tier 1 of the payroll-improvements work. Adds five nullable columns to
// `organization_payroll_settings` so HR can override the hardcoded India
// statutory defaults (kept in packages/shared/src/constants/india.ts) on
// a per-org basis without touching code.
//
// Every column is nullable; a NULL value means "fall back to the global
// constant", so this migration is a strict superset of today's behaviour
// for orgs that don't opt in.
//
// Columns:
//   pf_apply_full_basic           bool    -- true = compute PF on actual
//                                            basic+DA, false (default) =
//                                            cap at PF_WAGE_CEILING (15000)
//   pf_max_employee_contribution  decimal -- hard ₹ cap on the employee's
//                                            EPF deduction even if rate ×
//                                            wages would exceed it. Common
//                                            value: 1800 (12% of 15000).
//   pf_default_employee_rate      decimal -- org-wide default % when the
//                                            employee profile has no
//                                            contributionRate set. Falls
//                                            back to PF_EMPLOYEE_RATE (12)
//                                            if NULL.
//   esi_wage_ceiling              int     -- gross-salary ceiling for ESI
//                                            eligibility. Default
//                                            ESI_WAGE_CEILING (21000).
//   rounding_policy               string  -- 'none' | 'nearest_1' |
//                                            'nearest_10' | 'nearest_100'
//                                            applied to earnings + deductions
//                                            in the payslip totals.
// =============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const cols = await Promise.all([
    knex.schema.hasColumn("organization_payroll_settings", "pf_apply_full_basic"),
    knex.schema.hasColumn("organization_payroll_settings", "pf_max_employee_contribution"),
    knex.schema.hasColumn("organization_payroll_settings", "pf_default_employee_rate"),
    knex.schema.hasColumn("organization_payroll_settings", "esi_wage_ceiling"),
    knex.schema.hasColumn("organization_payroll_settings", "rounding_policy"),
  ]);
  await knex.schema.alterTable("organization_payroll_settings", (t) => {
    if (!cols[0]) t.boolean("pf_apply_full_basic").nullable();
    if (!cols[1]) t.decimal("pf_max_employee_contribution", 10, 2).nullable();
    if (!cols[2]) t.decimal("pf_default_employee_rate", 5, 2).nullable();
    if (!cols[3]) t.integer("esi_wage_ceiling").nullable();
    if (!cols[4]) t.string("rounding_policy", 20).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  const cols = await Promise.all([
    knex.schema.hasColumn("organization_payroll_settings", "pf_apply_full_basic"),
    knex.schema.hasColumn("organization_payroll_settings", "pf_max_employee_contribution"),
    knex.schema.hasColumn("organization_payroll_settings", "pf_default_employee_rate"),
    knex.schema.hasColumn("organization_payroll_settings", "esi_wage_ceiling"),
    knex.schema.hasColumn("organization_payroll_settings", "rounding_policy"),
  ]);
  await knex.schema.alterTable("organization_payroll_settings", (t) => {
    if (cols[0]) t.dropColumn("pf_apply_full_basic");
    if (cols[1]) t.dropColumn("pf_max_employee_contribution");
    if (cols[2]) t.dropColumn("pf_default_employee_rate");
    if (cols[3]) t.dropColumn("esi_wage_ceiling");
    if (cols[4]) t.dropColumn("rounding_policy");
  });
}
