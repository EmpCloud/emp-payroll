// =============================================================================
// MIGRATION 035 — Org setting: include weekends in payroll working days
// -----------------------------------------------------------------------------
// computePayroll derives the run's working-days denominator as the count of
// weekdays (Mon–Fri) in the month, minus weekday holidays. Organisations
// that operate on weekends — retail, manufacturing, hospitality — want
// Saturdays/Sundays counted as working days too, so present-days / paid-days
// pro-rate against the full calendar instead.
//
// This migration adds the opt-in toggle. Default FALSE = the existing
// weekday-only behaviour, so no org sees a change unless they opt in. When
// TRUE, computePayroll counts every calendar day as a working day and
// subtracts holidays regardless of which day they fall on.
//
// Column:
//   include_weekends_in_working_days  bool  NOT NULL DEFAULT false
// =============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("organization_payroll_settings"))) return;
  if (
    await knex.schema.hasColumn("organization_payroll_settings", "include_weekends_in_working_days")
  ) {
    return;
  }
  await knex.schema.alterTable("organization_payroll_settings", (t) => {
    t.boolean("include_weekends_in_working_days").notNullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("organization_payroll_settings"))) return;
  if (
    !(await knex.schema.hasColumn(
      "organization_payroll_settings",
      "include_weekends_in_working_days",
    ))
  ) {
    return;
  }
  await knex.schema.alterTable("organization_payroll_settings", (t) => {
    t.dropColumn("include_weekends_in_working_days");
  });
}
