// =============================================================================
// MIGRATION 034 — Org setting: toggle EDLI / PF Admin employer charges
// -----------------------------------------------------------------------------
// EDLI (0.5%) and PF Admin (0.5%) are employer-side EPF charges that the
// engine always tacked on whenever PF applied — there was no way to switch
// them off short of opting the employee out of PF entirely (all-or-nothing).
// Some orgs model their CTC without these charges, or run exempted/
// trust-managed PF setups where one or both don't apply.
//
// This migration adds two independent boolean toggles. Both default TRUE =
// current behaviour (charges included), so orgs that don't opt out see no
// change. When a flag is false, computePF returns 0 for that charge and it
// drops out of the employer-contribution roll-up + the Salary Revision
// preview.
//
// Columns:
//   pf_edli_enabled    bool  NOT NULL DEFAULT true  -- include EDLI (0.5%)
//   pf_admin_enabled   bool  NOT NULL DEFAULT true  -- include PF Admin (0.5%)
// =============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("organization_payroll_settings"))) return;
  const cols = await Promise.all([
    knex.schema.hasColumn("organization_payroll_settings", "pf_edli_enabled"),
    knex.schema.hasColumn("organization_payroll_settings", "pf_admin_enabled"),
  ]);
  await knex.schema.alterTable("organization_payroll_settings", (t) => {
    if (!cols[0]) t.boolean("pf_edli_enabled").notNullable().defaultTo(true);
    if (!cols[1]) t.boolean("pf_admin_enabled").notNullable().defaultTo(true);
  });
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("organization_payroll_settings"))) return;
  const cols = await Promise.all([
    knex.schema.hasColumn("organization_payroll_settings", "pf_edli_enabled"),
    knex.schema.hasColumn("organization_payroll_settings", "pf_admin_enabled"),
  ]);
  await knex.schema.alterTable("organization_payroll_settings", (t) => {
    if (cols[0]) t.dropColumn("pf_edli_enabled");
    if (cols[1]) t.dropColumn("pf_admin_enabled");
  });
}
