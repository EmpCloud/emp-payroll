// =============================================================================
// MIGRATION 044 — Add China (CNY), Russia (RUB) and Turkiye (TRY) to the
// global-payroll countries reference table.
//
// These three already have full config-driven tax engines in
// services/tax/country-configs.ts (CN/RU/TR), but they were never seeded into
// the `countries` table (migration 019 only seeds on an empty table), so they
// never appeared in the Global Payroll -> Employees country/currency dropdown.
// Adding the rows makes them selectable; the existing engine then computes real
// payroll for them, closing the gap between "selectable" and "computable".
//
// Idempotent: skips any code that is already present, and no-ops entirely when
// the countries table does not exist (installs that never ran migration 019).
// =============================================================================

import type { Knex } from "knex";

const COUNTRIES = [
  {
    code: "CN",
    name: "China",
    currency: "CNY",
    currency_symbol: "¥", // yuan sign
    region: "asia",
    min_wage_monthly: 269000, // Shanghai ~CNY 2,690/mo (2025), highest regional minimum, in cents
    payroll_frequency: "monthly",
    tax_year_start: "01-01",
    has_social_security: true,
    has_pension: true,
    has_health_insurance: true,
    notice_period_days: 30,
    probation_months: 6,
    max_work_hours_week: 40,
    annual_leave_days: 5, // statutory minimum (5-15 by length of service)
    public_holidays: 11,
    compliance_notes: JSON.stringify({
      income_tax: "Progressive IIT: 3%, 10%, 20%, 25%, 30%, 35%, 45%",
      pension_employee: 8,
      pension_employer: 16,
      medical_employee: 2,
      medical_employer: 9,
      unemployment_employee: 0.5,
      unemployment_employer: 0.5,
      work_injury_employer: 0.2,
      housing_fund_employee: 7,
      housing_fund_employer: 7,
      social_insurance_base: "Shanghai 2025: floor CNY 7,460/mo, ceiling CNY 37,302/mo",
    }),
  },
  {
    code: "RU",
    name: "Russia",
    currency: "RUB",
    currency_symbol: "₽", // ruble sign
    region: "europe",
    min_wage_monthly: 2244000, // RUB 22,440/mo (2025 federal minimum), in cents
    payroll_frequency: "monthly",
    tax_year_start: "01-01",
    has_social_security: true,
    has_pension: true,
    has_health_insurance: true,
    notice_period_days: 14, // 2 weeks (employee resignation); redundancy differs
    probation_months: 3,
    max_work_hours_week: 40,
    annual_leave_days: 28, // 28 calendar days
    public_holidays: 14,
    compliance_notes: JSON.stringify({
      income_tax: "NDFL progressive: 13%, 15%, 18%, 20%, 22% (residents, 2025)",
      unified_social_contribution_employer: 30, // capped, covers pension/medical/social
      occupational_injury_employer: "0.2%-8.5% by industry risk class",
      contribution_base_note: "Unified 30% up to the annual cumulative base ceiling",
    }),
  },
  {
    code: "TR",
    name: "Türkiye",
    currency: "TRY",
    currency_symbol: "₺", // lira sign
    region: "europe",
    min_wage_monthly: 2600550, // gross TRY 26,005.50/mo (2025), in cents
    payroll_frequency: "monthly",
    tax_year_start: "01-01",
    has_social_security: true,
    has_pension: true,
    has_health_insurance: true,
    notice_period_days: 30, // graduated 2-8 weeks by tenure; 30 as a representative default
    probation_months: 2,
    max_work_hours_week: 45,
    annual_leave_days: 14, // 14-26 days by length of service
    public_holidays: 15,
    compliance_notes: JSON.stringify({
      income_tax: "Progressive: 15%, 20%, 27%, 35%, 40%",
      sgk_employee: 14, // 9% pension + 5% general health
      unemployment_employee: 1,
      sgk_employer: 20.5, // 20.5% (incl. 2% short-term) + 2% employer unemployment
      unemployment_employer: 2,
      stamp_tax_employee: 0.759,
      min_wage_income_tax_exempt: "Minimum-wage portion of salary is income- and stamp-tax exempt",
    }),
  },
];

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("countries"))) return;

  for (const country of COUNTRIES) {
    const existing = await knex("countries").where({ code: country.code }).first();
    if (existing) continue; // already present — no-op

    await knex("countries").insert({
      id: knex.raw("(UUID())"),
      ...country,
      is_active: true,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("countries"))) return;
  await knex("countries").whereIn("code", ["CN", "RU", "TR"]).del();
}
