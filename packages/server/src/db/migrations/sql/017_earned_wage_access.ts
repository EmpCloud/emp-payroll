// ============================================================================
// MIGRATION: Earned Wage Access / On-Demand Pay
// ============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // -------------------------------------------------------------------------
  // Earned Wage Settings (one row per org)
  // -------------------------------------------------------------------------
  await knex.schema.createTable("earned_wage_settings", (t) => {
    t.uuid("id").primary();
    t.bigInteger("empcloud_org_id").unsigned().notNullable().unique();
    t.boolean("is_enabled").notNullable().defaultTo(false);
    t.integer("max_percentage").notNullable().defaultTo(50); // max % of earned salary
    t.bigInteger("min_amount").notNullable().defaultTo(0);
    t.bigInteger("max_amount").notNullable().defaultTo(0); // 0 = no limit
    t.decimal("fee_percentage", 5, 2).notNullable().defaultTo(0);
    t.bigInteger("fee_flat").notNullable().defaultTo(0);
    t.bigInteger("auto_approve_below").notNullable().defaultTo(0); // 0 = no auto-approve
    t.boolean("requires_manager_approval").notNullable().defaultTo(true);
    t.integer("cooldown_days").notNullable().defaultTo(7);
    t.timestamps(true, true);
  });

  // -------------------------------------------------------------------------
  // Earned Wage Access Requests
  // -------------------------------------------------------------------------
  await knex.schema.createTable("earned_wage_access_requests", (t) => {
    t.uuid("id").primary();
    t.bigInteger("empcloud_org_id").unsigned().notNullable();
    t.bigInteger("employee_id").unsigned().notNullable();
    t.bigInteger("amount").notNullable(); // smallest currency unit
    t.string("currency", 3).notNullable().defaultTo("INR");
    t.string("status", 20).notNullable().defaultTo("pending"); // pending, approved, disbursed, rejected, repaid
    t.timestamp("requested_at").notNullable().defaultTo(knex.fn.now());
    t.bigInteger("approved_by").unsigned().nullable();
    t.timestamp("approved_at").nullable();
    t.timestamp("disbursed_at").nullable();
    t.timestamp("repaid_at").nullable();
    t.uuid("repayment_payroll_run_id").nullable(); // links to payroll run where deducted
    t.text("reason").nullable();
    t.bigInteger("max_available").notNullable().defaultTo(0); // snapshot of available at request time
    t.bigInteger("fee_amount").notNullable().defaultTo(0); // processing fee
    t.text("notes").nullable();
    t.timestamps(true, true);

    t.index(["empcloud_org_id", "status"]);
    t.index(["empcloud_org_id", "employee_id"]);
    t.index(["employee_id", "status"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("earned_wage_access_requests");
  await knex.schema.dropTableIfExists("earned_wage_settings");
}
