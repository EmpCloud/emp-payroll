// =============================================================================
// MIGRATION 023 — Add updated_at to compliance_checklist
//
// Migration 019 created compliance_checklist with only `created_at`. The
// shared KnexAdapter.create() auto-stamps both created_at AND updated_at on
// every insert, so adding a global employee crashes with
//   ER_BAD_FIELD_ERROR: Unknown column 'updated_at' in 'field list'
// (issue #188). Add the missing column so the auto-stamp succeeds and the
// table matches the rest of the schema.
// =============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex) {
  if (!(await knex.schema.hasTable("compliance_checklist"))) return;
  const hasCol = await knex.schema.hasColumn("compliance_checklist", "updated_at");
  if (hasCol) return;
  await knex.schema.alterTable("compliance_checklist", (t) => {
    t.timestamp("updated_at").defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex) {
  if (!(await knex.schema.hasTable("compliance_checklist"))) return;
  const hasCol = await knex.schema.hasColumn("compliance_checklist", "updated_at");
  if (!hasCol) return;
  await knex.schema.alterTable("compliance_checklist", (t) => {
    t.dropColumn("updated_at");
  });
}
