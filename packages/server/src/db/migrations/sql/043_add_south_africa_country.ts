// =============================================================================
// MIGRATION 043 — Add South Africa (ZAR) to global-payroll countries
//
// The countries reference table (migration 019) seeds 30 countries but only on
// a fresh/empty table, so existing installs never picked up later additions.
// This migration idempotently inserts South Africa (ZA / ZAR / R) so it shows
// up in the Global Payroll → Employees country/currency dropdown.
//
// Currency on the client is derived from the country row (label "Name (ZAR)"
// and country_currency_symbol), so adding this row is all that's needed for the
// "South Africa (ZAR)" option and the R symbol to appear.
// =============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Table may not exist on installs that never ran the global-payroll migration.
  if (!(await knex.schema.hasTable("countries"))) return;

  const existing = await knex("countries").where({ code: "ZA" }).first();
  if (existing) return; // already present — no-op

  await knex("countries").insert({
    id: knex.raw("(UUID())"),
    code: "ZA",
    name: "South Africa",
    currency: "ZAR",
    currency_symbol: "R",
    region: "africa",
    // National minimum wage 2025 ≈ R28.79/hr → ~R5,600/month, stored in cents.
    min_wage_monthly: 560000,
    payroll_frequency: "monthly",
    // SA tax year runs 1 March – end February.
    tax_year_start: "03-01",
    has_social_security: true, // UIF
    has_pension: false, // no mandatory occupational/state payroll pension
    has_health_insurance: false, // private medical aid, not statutory
    notice_period_days: 30, // 4 weeks (BCEA, >1yr service)
    probation_months: 3,
    max_work_hours_week: 45, // BCEA ordinary hours
    annual_leave_days: 15, // 21 consecutive days = 15 working days (BCEA)
    public_holidays: 12,
    is_active: true,
    compliance_notes: JSON.stringify({
      income_tax: "Progressive: 18%, 26%, 31%, 36%, 39%, 41%, 45%",
      uif_employer: 1, // %
      uif_employee: 1, // %
      uif_monthly_ceiling: 1771200, // R17,712 in cents — UIF contribution cap
      sdl_employer: 1, // Skills Development Levy (payroll > R500,000/yr)
      paye: "PAYE monthly withholding; tax year 1 Mar – end Feb",
      coida: "Employer-funded workplace injury compensation (COIDA)",
    }),
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  });
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("countries"))) return;
  await knex("countries").where({ code: "ZA" }).del();
}
