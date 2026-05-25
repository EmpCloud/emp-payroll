// =============================================================================
// MIGRATION 037 — Org setting: company logo for payslips
// -----------------------------------------------------------------------------
// Adds a per-organization logo, uploaded from payroll Settings and rendered at
// the top of every payslip. Stored as the relative upload path (e.g.
// `/uploads/<uuid>.png`); the payslip renderer inlines the file as a base64
// data URI so it survives "Save as PDF" / standalone HTML downloads.
//
// Column:
//   logo_path  varchar(500)  NULL
// =============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("organization_payroll_settings"))) return;
  if (await knex.schema.hasColumn("organization_payroll_settings", "logo_path")) {
    return;
  }
  await knex.schema.alterTable("organization_payroll_settings", (t) => {
    t.string("logo_path", 500).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("organization_payroll_settings"))) return;
  if (!(await knex.schema.hasColumn("organization_payroll_settings", "logo_path"))) {
    return;
  }
  await knex.schema.alterTable("organization_payroll_settings", (t) => {
    t.dropColumn("logo_path");
  });
}
