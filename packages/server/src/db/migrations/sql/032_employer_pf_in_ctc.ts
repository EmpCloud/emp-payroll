// =============================================================================
// MIGRATION 032 — Org setting: Employer PF / ESI included in CTC
// -----------------------------------------------------------------------------
// HR keeps asking whether the org offer letter says CTC = Gross + Employer
// PF/ESI on top, OR CTC = Total Cost to Company (employer contributions
// already bundled into the negotiated CTC). The default behaviour today is
// "on top" -- the resolver allocates 100% of CTC to employee earnings and
// employer PF gets reported as additional cost. Many Indian IT employers
// run the opposite model where the offer letter "₹8.45L CTC" already
// includes the ~₹50K of employer PF/ESI, so the employee's gross is
// LOWER than the headline CTC.
//
// This migration adds the toggle. Default false = current behaviour (no
// regression). When true:
//   - The payroll run's `total_employer_cost` reports `gross_salary` only
//     (no additional employer PF / ESI on top — it's already inside CTC).
//   - The "Employer Cost (extra)" column on the run-detail page reads as
//     "(included in CTC)" instead of a rupee total.
//   - Salary Details preview still shows the breakdown so HR can verify
//     where the money is going, but with a clear "(part of CTC)" label.
// =============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("organization_payroll_settings"))) return;
  if (await knex.schema.hasColumn("organization_payroll_settings", "employer_pf_in_ctc")) return;
  await knex.schema.alterTable("organization_payroll_settings", (t) => {
    t.boolean("employer_pf_in_ctc").notNullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("organization_payroll_settings"))) return;
  if (!(await knex.schema.hasColumn("organization_payroll_settings", "employer_pf_in_ctc"))) return;
  await knex.schema.alterTable("organization_payroll_settings", (t) => {
    t.dropColumn("employer_pf_in_ctc");
  });
}
