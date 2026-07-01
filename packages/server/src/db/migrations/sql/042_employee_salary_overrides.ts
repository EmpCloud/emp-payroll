// =============================================================================
// MIGRATION 042 — Per-employee salary component overrides
//
// Adds an `overrides` JSON column to employee_salaries so HR can pin specific
// components to a fixed monthly ₹ amount for an individual employee (e.g. a
// custom Basic that differs from the structure's % split). At resolve time the
// pinned components take the fixed amount and the remaining gross is
// redistributed across the non-pinned "% of gross" earnings, keeping gross
// exact. Shape: { "BASIC": 40000 } (component code → monthly amount).
// =============================================================================
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("employee_salaries"))) return;
  if (await knex.schema.hasColumn("employee_salaries", "overrides")) return;
  await knex.schema.alterTable("employee_salaries", (t) => {
    t.json("overrides").nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("employee_salaries"))) return;
  if (!(await knex.schema.hasColumn("employee_salaries", "overrides"))) return;
  await knex.schema.alterTable("employee_salaries", (t) => {
    t.dropColumn("overrides");
  });
}
