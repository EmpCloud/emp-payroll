// =============================================================================
// MIGRATION 039 — Per-employee Razorpay cache (Phase 1B)
// -----------------------------------------------------------------------------
// Razorpay requires a `contact` + `fund_account` per payee. Both are created
// once and reused, so we cache the resulting ids on the employee's payroll
// profile. `razorpay_bank_fingerprint` is a sha-256 of the bank-details JSON;
// when the employee edits their bank details the fingerprint changes and we
// know to create a fresh fund_account on next disburse (the old one becomes
// stale but Razorpay just leaves it; no cleanup needed).
// =============================================================================

import type { Knex } from "knex";

const T = "employee_payroll_profiles";

const COLUMNS: Array<{ name: string; add: (t: Knex.AlterTableBuilder) => void }> = [
  { name: "razorpay_contact_id", add: (t) => t.string("razorpay_contact_id", 64).nullable() },
  {
    name: "razorpay_fund_account_id",
    add: (t) => t.string("razorpay_fund_account_id", 64).nullable(),
  },
  {
    name: "razorpay_bank_fingerprint",
    add: (t) => t.string("razorpay_bank_fingerprint", 128).nullable(),
  },
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
