// =============================================================================
// MIGRATION 024 — Add updated_at to global_payroll_items and audit_logs
//
// Same family of bug as #188 / migration 023: KnexAdapter.create() auto-
// stamps both created_at AND updated_at on every insert, but these two
// tables were created with only created_at, so any insert via the adapter
// crashes with ER_BAD_FIELD_ERROR: Unknown column 'updated_at'.
//
// - global_payroll_items: blocks "Create Run" on Global Payroll (#189) —
//   service inserts a row per employee for every payroll run.
// - audit_logs: would crash every audit-trail write through the adapter.
//
// (compliance_checklist had the same bug; fixed in migration 023.)
//
// Idempotent: skips columns that already exist.
// =============================================================================

import type { Knex } from "knex";

const TARGETS = ["global_payroll_items", "audit_logs"] as const;

export async function up(knex: Knex) {
  for (const table of TARGETS) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (await knex.schema.hasColumn(table, "updated_at")) continue;
    await knex.schema.alterTable(table, (t) => {
      t.timestamp("updated_at").defaultTo(knex.fn.now());
    });
  }
}

export async function down(knex: Knex) {
  for (const table of TARGETS) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (!(await knex.schema.hasColumn(table, "updated_at"))) continue;
    await knex.schema.alterTable(table, (t) => {
      t.dropColumn("updated_at");
    });
  }
}
