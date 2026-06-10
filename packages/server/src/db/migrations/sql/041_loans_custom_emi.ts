// =============================================================================
// MIGRATION 041 — loans.custom_emi_amount
// -----------------------------------------------------------------------------
// HR sometimes wants to round up the monthly deduction so the loan settles in
// fewer, cleaner instalments — e.g. a ₹28,734 loan over 3 months at the
// default ₹9,578/month becomes 2 × ₹10,000 + 1 × ₹8,734. Until now the EMI
// stored on the loan row was the only knob, and editing it caused the
// tenure-derived schedule to drift.
//
// This column lets HR set an explicit per-month deduction that overrides
// the default `emi_amount` at payroll time. The engine caps the deduction
// at the current outstanding so the last month auto-settles whatever's left
// without over-collecting, which means HR doesn't have to manually edit the
// loan before the final month.
//
// Nullable: when NULL the engine falls back to the existing `emi_amount`
// (default tenure-based calc). Existing loans are unaffected.
// =============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("loans"))) return;
  if (await knex.schema.hasColumn("loans", "custom_emi_amount")) return;
  await knex.schema.alterTable("loans", (t) => {
    t.decimal("custom_emi_amount", 15, 2).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("loans"))) return;
  if (!(await knex.schema.hasColumn("loans", "custom_emi_amount"))) return;
  await knex.schema.alterTable("loans", (t) => {
    t.dropColumn("custom_emi_amount");
  });
}
