// =============================================================================
// MIGRATION 036 — Org setting: disable Professional Tax for all employees
// -----------------------------------------------------------------------------
// Professional Tax (PT) is a state-levied payroll deduction. Today it's gated
// per-employee via `tax_info.deductPT` (default true). Some orgs operate in
// states with no PT (e.g. Delhi, Haryana, UP) or simply don't want PT withheld
// at all, and toggling every employee individually is tedious and error-prone.
//
// This migration adds an org-level kill-switch. Default FALSE = the existing
// behaviour (PT computes per the per-employee gate + state slab), so no org
// sees a change unless they opt in. When TRUE, computePayroll skips PT for
// EVERY employee in the org regardless of the per-employee deductPT flag.
//
// Column:
//   pt_disabled  bool  NOT NULL DEFAULT false
// =============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("organization_payroll_settings"))) return;
  if (await knex.schema.hasColumn("organization_payroll_settings", "pt_disabled")) {
    return;
  }
  await knex.schema.alterTable("organization_payroll_settings", (t) => {
    t.boolean("pt_disabled").notNullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("organization_payroll_settings"))) return;
  if (!(await knex.schema.hasColumn("organization_payroll_settings", "pt_disabled"))) {
    return;
  }
  await knex.schema.alterTable("organization_payroll_settings", (t) => {
    t.dropColumn("pt_disabled");
  });
}
