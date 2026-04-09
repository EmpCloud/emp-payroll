// ============================================================================
// MIGRATION: GL/Accounting Integration
// ============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // -------------------------------------------------------------------------
  // GL Mappings (pay component -> GL account)
  // -------------------------------------------------------------------------
  await knex.schema.createTable("gl_mappings", (t) => {
    t.uuid("id").primary();
    t.bigInteger("empcloud_org_id").unsigned().notNullable();
    t.string("pay_component", 50).notNullable();
    t.string("gl_account_code", 50).notNullable();
    t.string("gl_account_name", 255).notNullable();
    t.text("description").nullable();
    t.timestamps(true, true);

    t.unique(["empcloud_org_id", "pay_component"]);
    t.index(["empcloud_org_id"]);
  });

  // -------------------------------------------------------------------------
  // GL Journal Entries (one per payroll run)
  // -------------------------------------------------------------------------
  await knex.schema.createTable("gl_journal_entries", (t) => {
    t.uuid("id").primary();
    t.bigInteger("empcloud_org_id").unsigned().notNullable();
    t.uuid("payroll_run_id")
      .notNullable()
      .references("id")
      .inTable("payroll_runs")
      .onDelete("CASCADE");
    t.date("entry_date").notNullable();
    t.decimal("total_debit", 15, 2).notNullable().defaultTo(0);
    t.decimal("total_credit", 15, 2).notNullable().defaultTo(0);
    t.string("status", 20).notNullable().defaultTo("draft"); // draft, posted, exported
    t.timestamp("exported_at").nullable();
    t.string("export_format", 30).nullable(); // tally, quickbooks, zoho
    t.timestamps(true, true);

    t.index(["empcloud_org_id"]);
    t.index(["payroll_run_id"]);
    t.index(["status"]);
  });

  // -------------------------------------------------------------------------
  // GL Journal Lines (individual debit/credit lines)
  // -------------------------------------------------------------------------
  await knex.schema.createTable("gl_journal_lines", (t) => {
    t.uuid("id").primary();
    t.uuid("journal_id")
      .notNullable()
      .references("id")
      .inTable("gl_journal_entries")
      .onDelete("CASCADE");
    t.bigInteger("empcloud_org_id").unsigned().notNullable();
    t.string("gl_account_code", 50).notNullable();
    t.string("description", 255).nullable();
    t.decimal("debit_amount", 15, 2).notNullable().defaultTo(0);
    t.decimal("credit_amount", 15, 2).notNullable().defaultTo(0);
    t.timestamps(true, true);

    t.index(["journal_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("gl_journal_lines");
  await knex.schema.dropTableIfExists("gl_journal_entries");
  await knex.schema.dropTableIfExists("gl_mappings");
}
