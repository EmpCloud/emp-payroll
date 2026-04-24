// =============================================================================
// MIGRATION 022 — Drop emp-payroll's local announcements table
//
// EmpCloud is now the single source of truth for company announcements.
// The payroll Announcements page reads them via the cross-DB query in
// announcement.service.ts (PR #190). This local table is no longer used.
//
// DESTRUCTIVE: any rows previously created via the payroll UI are dropped.
// They were not synced anywhere, so this is a one-way operation.
// =============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex) {
  if (await knex.schema.hasTable("announcements")) {
    await knex.schema.dropTable("announcements");
  }
}

export async function down(knex: Knex) {
  // Recreate the original schema (mirrors migration 012) so down-migrate
  // works, but rows are gone for good.
  if (await knex.schema.hasTable("announcements")) return;
  await knex.schema.createTable("announcements", (t) => {
    t.uuid("id").primary();
    t.integer("org_id").unsigned().notNullable();
    t.string("title", 255).notNullable();
    t.text("content").notNullable();
    t.enum("priority", ["low", "normal", "high", "urgent"]).defaultTo("normal");
    t.enum("category", ["general", "hr", "policy", "event", "holiday", "maintenance"]).defaultTo(
      "general",
    );
    t.integer("author_id").unsigned().notNullable();
    t.boolean("is_pinned").defaultTo(false);
    t.boolean("is_active").defaultTo(true);
    t.datetime("publish_at").nullable();
    t.datetime("expires_at").nullable();
    t.timestamps(true, true);
  });
}
