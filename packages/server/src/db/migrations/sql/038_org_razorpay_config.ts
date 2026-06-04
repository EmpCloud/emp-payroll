// =============================================================================
// MIGRATION 038 — Org setting: RazorpayX payouts integration (Phase 1A — config)
// -----------------------------------------------------------------------------
// Each org can connect their own RazorpayX account from payroll Settings. The
// API key secret + webhook secret are AES-256-GCM encrypted at rest with the
// server-side master key from `PAYROLL_SECRETS_KEY`.
//
// Phase 1A only stores the config + a "last verified" timestamp from the
// Test Connection button. Phase 1B will add the payouts table + per-employee
// fund-account cache.
// =============================================================================

import type { Knex } from "knex";

const T = "organization_payroll_settings";

const COLUMNS: Array<{ name: string; add: (t: Knex.AlterTableBuilder) => void }> = [
  {
    name: "razorpay_enabled",
    add: (t) => t.boolean("razorpay_enabled").notNullable().defaultTo(false),
  },
  { name: "razorpay_key_id", add: (t) => t.string("razorpay_key_id", 64).nullable() },
  {
    name: "razorpay_key_secret_enc",
    add: (t) => t.string("razorpay_key_secret_enc", 500).nullable(),
  },
  {
    name: "razorpay_account_number",
    add: (t) => t.string("razorpay_account_number", 64).nullable(),
  },
  {
    name: "razorpay_webhook_secret_enc",
    add: (t) => t.string("razorpay_webhook_secret_enc", 500).nullable(),
  },
  { name: "razorpay_default_mode", add: (t) => t.string("razorpay_default_mode", 16).nullable() },
  { name: "razorpay_verified_at", add: (t) => t.timestamp("razorpay_verified_at").nullable() },
];

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable(T))) return;
  for (const c of COLUMNS) {
    if (await knex.schema.hasColumn(T, c.name)) continue;
    await knex.schema.alterTable(T, (t) => c.add(t));
  }
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable(T))) return;
  for (const c of [...COLUMNS].reverse()) {
    if (!(await knex.schema.hasColumn(T, c.name))) continue;
    await knex.schema.alterTable(T, (t) => t.dropColumn(c.name));
  }
}
