// =============================================================================
// MIGRATION 040 — payroll_payouts (Phase 1B)
// -----------------------------------------------------------------------------
// One row per (payslip, attempt). Idempotency_key is set to the payslip id so
// a retried "Disburse" never double-creates a payout at Razorpay.
//
// Lifecycle:
//   queued  → processing → processed | failed | reversed | rejected
//   Status mirrors Razorpay payout states. Phase 2 webhook keeps this in sync.
// =============================================================================

import type { Knex } from "knex";

const T = "payroll_payouts";

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable(T)) return;
  await knex.schema.createTable(T, (t) => {
    t.uuid("id").primary();
    t.uuid("payslip_id").notNullable();
    t.uuid("payroll_run_id").notNullable();
    t.integer("empcloud_user_id").unsigned().notNullable();
    t.integer("empcloud_org_id").unsigned().notNullable();
    t.string("razorpay_payout_id", 64).nullable();
    t.string("idempotency_key", 64).notNullable();
    t.integer("amount_paise").notNullable();
    t.string("mode", 16).nullable(); // IMPS / NEFT / RTGS
    t.string("status", 24).notNullable().defaultTo("queued");
    t.string("failure_reason", 500).nullable();
    t.timestamp("attempted_at").notNullable().defaultTo(knex.fn.now());
    t.timestamp("settled_at").nullable();
    t.json("response").nullable(); // last Razorpay response (truncated to essentials)
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    t.index(["payroll_run_id"], "idx_payouts_run");
    t.index(["empcloud_org_id", "payroll_run_id"], "idx_payouts_org_run");
    // Razorpay payout ids are unique once issued; lookup path for webhooks.
    t.index(["razorpay_payout_id"], "idx_payouts_rzp");
  });
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable(T))) return;
  await knex.schema.dropTable(T);
}
