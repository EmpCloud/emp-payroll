// ============================================================================
// MIGRATION: Global Payroll / EOR (Employer of Record)
// Supports multi-country payroll, contractors, and compliance tracking
// ============================================================================

import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // -------------------------------------------------------------------------
  // Countries — reference data with compliance rules
  // -------------------------------------------------------------------------
  if (!(await knex.schema.hasTable("countries"))) {
    await knex.schema.createTable("countries", (t) => {
      t.uuid("id").primary();
      t.string("code", 3).notNullable().unique(); // ISO 3166-1 alpha-2
      t.string("name", 100).notNullable();
      t.string("currency", 3).notNullable();
      t.string("currency_symbol", 5).notNullable();
      t.string("region", 20).notNullable(); // asia, europe, americas, africa, oceania, middle_east
      t.bigInteger("min_wage_monthly").nullable(); // smallest currency unit
      t.string("payroll_frequency", 20).notNullable().defaultTo("monthly"); // monthly, biweekly, weekly
      t.string("tax_year_start", 5).notNullable().defaultTo("01-01"); // "01-01" or "04-01"
      t.boolean("has_social_security").defaultTo(true);
      t.boolean("has_pension").defaultTo(true);
      t.boolean("has_health_insurance").defaultTo(true);
      t.integer("notice_period_days").defaultTo(30);
      t.integer("probation_months").defaultTo(3);
      t.integer("max_work_hours_week").defaultTo(40);
      t.integer("annual_leave_days").defaultTo(20);
      t.integer("public_holidays").defaultTo(10);
      t.boolean("is_active").defaultTo(true);
      t.text("compliance_notes").nullable(); // JSON with tax/social security rates
      t.timestamps(true, true);
    });
  }

  // -------------------------------------------------------------------------
  // Global Employees — EOR, contractors, direct hires in any country
  // -------------------------------------------------------------------------
  if (!(await knex.schema.hasTable("global_employees"))) {
    await knex.schema.createTable("global_employees", (t) => {
      t.uuid("id").primary();
      t.bigInteger("empcloud_org_id").unsigned().notNullable();
      t.bigInteger("empcloud_user_id").unsigned().nullable(); // link to empcloud user if exists
      t.string("first_name", 100).notNullable();
      t.string("last_name", 100).notNullable();
      t.string("email", 128).notNullable();
      t.uuid("country_id").notNullable().references("id").inTable("countries").onDelete("RESTRICT");
      t.string("employment_type", 20).notNullable(); // eor, contractor, direct_hire
      t.string("contract_type", 20).notNullable(); // full_time, part_time, fixed_term
      t.string("job_title", 200).notNullable();
      t.string("department", 100).nullable();
      t.date("start_date").notNullable();
      t.date("end_date").nullable();
      t.bigInteger("salary_amount").notNullable(); // smallest currency unit
      t.string("salary_currency", 3).notNullable();
      t.string("salary_frequency", 20).notNullable().defaultTo("monthly"); // monthly, biweekly, weekly, annual
      t.string("status", 20).notNullable().defaultTo("onboarding"); // active, onboarding, offboarding, terminated
      t.string("tax_id", 50).nullable(); // local tax identifier
      t.string("bank_name", 100).nullable();
      t.string("bank_account", 50).nullable();
      t.string("bank_routing", 50).nullable();
      t.text("contract_document_url").nullable();
      t.text("notes").nullable();
      t.timestamps(true, true);

      t.index(["empcloud_org_id", "status"]);
      t.index(["empcloud_org_id", "country_id"]);
    });
  }

  // -------------------------------------------------------------------------
  // Global Payroll Runs — per country per month
  // -------------------------------------------------------------------------
  if (!(await knex.schema.hasTable("global_payroll_runs"))) {
    await knex.schema.createTable("global_payroll_runs", (t) => {
      t.uuid("id").primary();
      t.bigInteger("empcloud_org_id").unsigned().notNullable();
      t.uuid("country_id").notNullable().references("id").inTable("countries").onDelete("RESTRICT");
      t.integer("period_month").notNullable(); // 1-12
      t.integer("period_year").notNullable();
      t.string("status", 20).notNullable().defaultTo("draft"); // draft, processing, approved, paid, cancelled
      t.bigInteger("total_gross").defaultTo(0);
      t.bigInteger("total_deductions").defaultTo(0);
      t.bigInteger("total_employer_cost").defaultTo(0);
      t.bigInteger("total_net").defaultTo(0);
      t.string("currency", 3).notNullable();
      t.decimal("exchange_rate_to_base", 15, 6).defaultTo(1); // rate to org's base currency
      t.bigInteger("approved_by").unsigned().nullable();
      t.datetime("paid_at").nullable();
      t.timestamps(true, true);

      t.index(["empcloud_org_id", "period_year", "period_month"], "gpr_org_period_idx");
    });
  }

  // -------------------------------------------------------------------------
  // Global Payroll Items — per employee per run
  // -------------------------------------------------------------------------
  if (!(await knex.schema.hasTable("global_payroll_items"))) {
    await knex.schema.createTable("global_payroll_items", (t) => {
      t.uuid("id").primary();
      t.uuid("payroll_run_id")
        .notNullable()
        .references("id")
        .inTable("global_payroll_runs")
        .onDelete("CASCADE");
      t.bigInteger("empcloud_org_id").unsigned().notNullable();
      t.uuid("global_employee_id")
        .notNullable()
        .references("id")
        .inTable("global_employees")
        .onDelete("CASCADE");
      t.bigInteger("gross_salary").notNullable();
      t.bigInteger("tax_amount").defaultTo(0);
      t.bigInteger("social_security_employee").defaultTo(0);
      t.bigInteger("social_security_employer").defaultTo(0);
      t.bigInteger("pension_employee").defaultTo(0);
      t.bigInteger("pension_employer").defaultTo(0);
      t.bigInteger("health_insurance_employee").defaultTo(0);
      t.bigInteger("health_insurance_employer").defaultTo(0);
      t.bigInteger("other_deductions").defaultTo(0);
      t.bigInteger("net_salary").notNullable();
      t.bigInteger("total_employer_cost").notNullable(); // gross + employer contributions
      t.string("currency", 3).notNullable();
      t.text("notes").nullable();
      t.timestamp("created_at").defaultTo(knex.fn.now());

      t.index(["payroll_run_id"]);
      t.index(["empcloud_org_id", "global_employee_id"]);
    });
  }

  // -------------------------------------------------------------------------
  // Contractor Invoices
  // -------------------------------------------------------------------------
  if (!(await knex.schema.hasTable("contractor_invoices"))) {
    await knex.schema.createTable("contractor_invoices", (t) => {
      t.uuid("id").primary();
      t.bigInteger("empcloud_org_id").unsigned().notNullable();
      t.uuid("global_employee_id")
        .notNullable()
        .references("id")
        .inTable("global_employees")
        .onDelete("CASCADE");
      t.string("invoice_number", 50).notNullable();
      t.bigInteger("amount").notNullable();
      t.string("currency", 3).notNullable();
      t.text("description").nullable();
      t.date("period_start").notNullable();
      t.date("period_end").notNullable();
      t.string("status", 20).notNullable().defaultTo("pending"); // pending, approved, paid, rejected
      t.datetime("submitted_at").notNullable();
      t.bigInteger("approved_by").unsigned().nullable();
      t.datetime("paid_at").nullable();
      t.timestamps(true, true);

      t.index(["empcloud_org_id", "status"]);
      t.index(["global_employee_id"]);
    });
  }

  // -------------------------------------------------------------------------
  // Compliance Checklist — per global employee
  // -------------------------------------------------------------------------
  if (!(await knex.schema.hasTable("compliance_checklist"))) {
    await knex.schema.createTable("compliance_checklist", (t) => {
      t.uuid("id").primary();
      t.bigInteger("empcloud_org_id").unsigned().notNullable();
      t.uuid("global_employee_id")
        .notNullable()
        .references("id")
        .inTable("global_employees")
        .onDelete("CASCADE");
      t.string("item", 255).notNullable(); // "Employment contract signed", "Tax ID collected", etc.
      t.boolean("is_completed").defaultTo(false);
      t.datetime("completed_at").nullable();
      t.bigInteger("completed_by").unsigned().nullable();
      t.date("due_date").nullable();
      t.string("category", 20).notNullable(); // legal, tax, payroll, benefits, immigration
      t.timestamp("created_at").defaultTo(knex.fn.now());

      t.index(["empcloud_org_id", "global_employee_id"]);
    });
  }

  // -------------------------------------------------------------------------
  // Seed Countries (30 countries with compliance data)
  // -------------------------------------------------------------------------
  const countries = [
    {
      code: "IN",
      name: "India",
      currency: "INR",
      currency_symbol: "\u20B9",
      region: "asia",
      min_wage_monthly: 2100000, // ~21,000 INR (varies by state)
      payroll_frequency: "monthly",
      tax_year_start: "04-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: true,
      notice_period_days: 30,
      probation_months: 6,
      max_work_hours_week: 48,
      annual_leave_days: 15,
      public_holidays: 12,
      compliance_notes: JSON.stringify({
        income_tax: "Slab-based: 0-5L 0%, 5-10L 20%, 10L+ 30% (old regime)",
        epf_employer: 12,
        epf_employee: 12,
        esi_employer: 3.25,
        esi_employee: 0.75,
        esi_threshold: 2100000,
        professional_tax_max: 200000,
        gratuity: "4.81% of basic (after 5 yrs)",
      }),
    },
    {
      code: "US",
      name: "United States",
      currency: "USD",
      currency_symbol: "$",
      region: "americas",
      min_wage_monthly: 125800, // $1,258 (~$7.25/hr x 174 hrs)
      payroll_frequency: "biweekly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: false,
      has_health_insurance: false,
      notice_period_days: 0,
      probation_months: 3,
      max_work_hours_week: 40,
      annual_leave_days: 0,
      public_holidays: 11,
      compliance_notes: JSON.stringify({
        fica_employee: 7.65,
        fica_employer: 7.65,
        social_security_rate: 6.2,
        social_security_cap: 16020000,
        medicare_rate: 1.45,
        futa_rate: 0.6,
        futa_cap: 700000,
        federal_tax: "Progressive brackets: 10%, 12%, 22%, 24%, 32%, 35%, 37%",
        state_tax: "Varies by state: 0-13.3%",
      }),
    },
    {
      code: "GB",
      name: "United Kingdom",
      currency: "GBP",
      currency_symbol: "\u00A3",
      region: "europe",
      min_wage_monthly: 182933, // ~£1,829 (£10.42/hr x 175.5 hrs)
      payroll_frequency: "monthly",
      tax_year_start: "04-06",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: false,
      notice_period_days: 7,
      probation_months: 6,
      max_work_hours_week: 48,
      annual_leave_days: 28,
      public_holidays: 8,
      compliance_notes: JSON.stringify({
        ni_employer: 13.8,
        ni_employee: 12,
        ni_threshold: 124200,
        paye: "20% basic, 40% higher, 45% additional",
        pension_employer_min: 3,
        pension_employee_min: 5,
        student_loan: "9% above threshold (Plan 1: £22,015, Plan 2: £27,295)",
      }),
    },
    {
      code: "DE",
      name: "Germany",
      currency: "EUR",
      currency_symbol: "\u20AC",
      region: "europe",
      min_wage_monthly: 209200, // ~€2,092 (€12/hr)
      payroll_frequency: "monthly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: true,
      notice_period_days: 30,
      probation_months: 6,
      max_work_hours_week: 40,
      annual_leave_days: 20,
      public_holidays: 10,
      compliance_notes: JSON.stringify({
        income_tax: "Progressive: 14-45%",
        solidarity_surcharge: 5.5,
        health_insurance_employer: 7.3,
        health_insurance_employee: 7.3,
        pension_employer: 9.3,
        pension_employee: 9.3,
        unemployment_employer: 1.3,
        unemployment_employee: 1.3,
        care_insurance_employer: 1.525,
        care_insurance_employee: 1.525,
      }),
    },
    {
      code: "FR",
      name: "France",
      currency: "EUR",
      currency_symbol: "\u20AC",
      region: "europe",
      min_wage_monthly: 174715, // ~€1,747 SMIC
      payroll_frequency: "monthly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: true,
      notice_period_days: 30,
      probation_months: 4,
      max_work_hours_week: 35,
      annual_leave_days: 25,
      public_holidays: 11,
      compliance_notes: JSON.stringify({
        income_tax: "Progressive: 11%, 30%, 41%, 45%",
        employer_social_charges: 45,
        employee_social_charges: 22,
        csg: 9.2,
        crds: 0.5,
      }),
    },
    {
      code: "CA",
      name: "Canada",
      currency: "CAD",
      currency_symbol: "C$",
      region: "americas",
      min_wage_monthly: 266000, // ~C$2,660
      payroll_frequency: "biweekly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: false,
      notice_period_days: 14,
      probation_months: 3,
      max_work_hours_week: 40,
      annual_leave_days: 10,
      public_holidays: 9,
      compliance_notes: JSON.stringify({
        cpp_employer: 5.95,
        cpp_employee: 5.95,
        ei_employer: 2.282,
        ei_employee: 1.63,
        federal_tax: "Progressive: 15%, 20.5%, 26%, 29%, 33%",
        provincial_tax: "Varies by province",
      }),
    },
    {
      code: "AU",
      name: "Australia",
      currency: "AUD",
      currency_symbol: "A$",
      region: "oceania",
      min_wage_monthly: 389100, // ~A$3,891
      payroll_frequency: "monthly",
      tax_year_start: "07-01",
      has_social_security: false,
      has_pension: true,
      has_health_insurance: false,
      notice_period_days: 14,
      probation_months: 6,
      max_work_hours_week: 38,
      annual_leave_days: 20,
      public_holidays: 8,
      compliance_notes: JSON.stringify({
        income_tax: "Progressive: 19%, 32.5%, 37%, 45%",
        superannuation_employer: 11,
        medicare_levy: 2,
        payroll_tax: "Varies by state: 4.75-6.85%",
      }),
    },
    {
      code: "SG",
      name: "Singapore",
      currency: "SGD",
      currency_symbol: "S$",
      region: "asia",
      min_wage_monthly: null,
      payroll_frequency: "monthly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: false,
      notice_period_days: 30,
      probation_months: 6,
      max_work_hours_week: 44,
      annual_leave_days: 7,
      public_holidays: 11,
      compliance_notes: JSON.stringify({
        income_tax: "Progressive: 2-22%",
        cpf_employer: 17,
        cpf_employee: 20,
        cpf_cap_monthly: 600000,
        sdl: 0.25,
      }),
    },
    {
      code: "AE",
      name: "United Arab Emirates",
      currency: "AED",
      currency_symbol: "AED",
      region: "middle_east",
      min_wage_monthly: null,
      payroll_frequency: "monthly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: true,
      notice_period_days: 30,
      probation_months: 6,
      max_work_hours_week: 48,
      annual_leave_days: 30,
      public_holidays: 10,
      compliance_notes: JSON.stringify({
        income_tax: 0,
        pension_employer: 12.5,
        pension_employee: 5,
        pension_applies: "UAE nationals only",
        gratuity: "21 days salary per year (first 5 yrs), 30 days after",
        health_insurance: "Mandatory in Abu Dhabi and Dubai",
      }),
    },
    {
      code: "JP",
      name: "Japan",
      currency: "JPY",
      currency_symbol: "\u00A5",
      region: "asia",
      min_wage_monthly: 178200, // ~¥178,200
      payroll_frequency: "monthly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: true,
      notice_period_days: 30,
      probation_months: 3,
      max_work_hours_week: 40,
      annual_leave_days: 10,
      public_holidays: 16,
      compliance_notes: JSON.stringify({
        income_tax: "Progressive: 5%, 10%, 20%, 23%, 33%, 40%, 45%",
        health_insurance_employer: 4.99,
        health_insurance_employee: 4.99,
        pension_employer: 9.15,
        pension_employee: 9.15,
        employment_insurance_employer: 0.95,
        employment_insurance_employee: 0.6,
      }),
    },
    {
      code: "BR",
      name: "Brazil",
      currency: "BRL",
      currency_symbol: "R$",
      region: "americas",
      min_wage_monthly: 132000, // R$1,320
      payroll_frequency: "monthly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: false,
      notice_period_days: 30,
      probation_months: 3,
      max_work_hours_week: 44,
      annual_leave_days: 30,
      public_holidays: 12,
      compliance_notes: JSON.stringify({
        income_tax: "Progressive: 7.5%, 15%, 22.5%, 27.5%",
        inss_employee: "7.5-14% progressive",
        inss_employer: 20,
        fgts: 8,
        thirteenth_salary: "Mandatory 13th month",
        vacation_bonus: "1/3 of monthly salary",
      }),
    },
    {
      code: "MX",
      name: "Mexico",
      currency: "MXN",
      currency_symbol: "MX$",
      region: "americas",
      min_wage_monthly: 622800, // ~MX$6,228
      payroll_frequency: "biweekly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: true,
      notice_period_days: 0,
      probation_months: 3,
      max_work_hours_week: 48,
      annual_leave_days: 12,
      public_holidays: 7,
      compliance_notes: JSON.stringify({
        income_tax: "Progressive: 1.92-35%",
        imss_employer: 20.4,
        imss_employee: 2.775,
        infonavit: 5,
        retirement_savings: 2,
        christmas_bonus: "Minimum 15 days salary (Aguinaldo)",
        profit_sharing: "10% of pre-tax profits (PTU)",
      }),
    },
    {
      code: "KR",
      name: "South Korea",
      currency: "KRW",
      currency_symbol: "\u20A9",
      region: "asia",
      min_wage_monthly: 201580000, // ~KRW 2,015,800
      payroll_frequency: "monthly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: true,
      notice_period_days: 30,
      probation_months: 3,
      max_work_hours_week: 40,
      annual_leave_days: 15,
      public_holidays: 15,
      compliance_notes: JSON.stringify({
        income_tax: "Progressive: 6-45%",
        national_pension_employer: 4.5,
        national_pension_employee: 4.5,
        health_insurance_employer: 3.545,
        health_insurance_employee: 3.545,
        employment_insurance_employer: 1.15,
        employment_insurance_employee: 0.9,
        industrial_accident: 0.73,
      }),
    },
    {
      code: "NL",
      name: "Netherlands",
      currency: "EUR",
      currency_symbol: "\u20AC",
      region: "europe",
      min_wage_monthly: 199500, // ~€1,995
      payroll_frequency: "monthly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: true,
      notice_period_days: 30,
      probation_months: 2,
      max_work_hours_week: 40,
      annual_leave_days: 20,
      public_holidays: 8,
      compliance_notes: JSON.stringify({
        income_tax: "Box 1: 36.93% up to €73,031, 49.5% above",
        employer_social_security: 18.42,
        zvw_employer: 6.68,
        holiday_allowance: "8% of annual salary",
        "30_percent_ruling": "30% tax-free for qualifying expats",
      }),
    },
    {
      code: "ES",
      name: "Spain",
      currency: "EUR",
      currency_symbol: "\u20AC",
      region: "europe",
      min_wage_monthly: 108000, // ~€1,080
      payroll_frequency: "monthly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: true,
      notice_period_days: 15,
      probation_months: 6,
      max_work_hours_week: 40,
      annual_leave_days: 22,
      public_holidays: 14,
      compliance_notes: JSON.stringify({
        income_tax: "Progressive: 19%, 24%, 30%, 37%, 45%, 47%",
        employer_social_security: 29.9,
        employee_social_security: 6.35,
        extra_payments: "2 extra monthly payments (June and December)",
      }),
    },
    {
      code: "IT",
      name: "Italy",
      currency: "EUR",
      currency_symbol: "\u20AC",
      region: "europe",
      min_wage_monthly: null,
      payroll_frequency: "monthly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: true,
      notice_period_days: 30,
      probation_months: 6,
      max_work_hours_week: 40,
      annual_leave_days: 20,
      public_holidays: 12,
      compliance_notes: JSON.stringify({
        income_tax: "Progressive: 23%, 25%, 35%, 43%",
        employer_social_security: 30,
        employee_social_security: 9.49,
        tfr: "6.91% severance fund",
        thirteenth_month: "Mandatory 13th month (Tredicesima)",
        fourteenth_month: "Some sectors require 14th month",
      }),
    },
    {
      code: "SE",
      name: "Sweden",
      currency: "SEK",
      currency_symbol: "kr",
      region: "europe",
      min_wage_monthly: null,
      payroll_frequency: "monthly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: true,
      notice_period_days: 30,
      probation_months: 6,
      max_work_hours_week: 40,
      annual_leave_days: 25,
      public_holidays: 13,
      compliance_notes: JSON.stringify({
        income_tax: "~32% municipal + 20% state above SEK 598,500",
        employer_social_charges: 31.42,
        holiday_pay: "12% of annual gross",
      }),
    },
    {
      code: "CH",
      name: "Switzerland",
      currency: "CHF",
      currency_symbol: "CHF",
      region: "europe",
      min_wage_monthly: null,
      payroll_frequency: "monthly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: true,
      notice_period_days: 30,
      probation_months: 3,
      max_work_hours_week: 45,
      annual_leave_days: 20,
      public_holidays: 8,
      compliance_notes: JSON.stringify({
        income_tax: "Varies by canton: ~10-40%",
        ahv_employer: 5.3,
        ahv_employee: 5.3,
        pension_employer: "varies by plan, typically 7-18%",
        pension_employee: "varies by plan, typically 7-18%",
        accident_insurance: "Employer pays non-occupational",
        unemployment_employer: 1.1,
        unemployment_employee: 1.1,
      }),
    },
    {
      code: "IE",
      name: "Ireland",
      currency: "EUR",
      currency_symbol: "\u20AC",
      region: "europe",
      min_wage_monthly: 199120, // ~€1,991
      payroll_frequency: "monthly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: false,
      notice_period_days: 7,
      probation_months: 6,
      max_work_hours_week: 48,
      annual_leave_days: 20,
      public_holidays: 10,
      compliance_notes: JSON.stringify({
        income_tax: "20% standard, 40% higher",
        prsi_employer: 11.05,
        prsi_employee: 4,
        usc: "0.5%, 2%, 4%, 8% progressive",
      }),
    },
    {
      code: "PL",
      name: "Poland",
      currency: "PLN",
      currency_symbol: "z\u0142",
      region: "europe",
      min_wage_monthly: 360000, // PLN 3,600
      payroll_frequency: "monthly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: true,
      notice_period_days: 30,
      probation_months: 3,
      max_work_hours_week: 40,
      annual_leave_days: 20,
      public_holidays: 13,
      compliance_notes: JSON.stringify({
        income_tax: "12% up to PLN 120,000, 32% above",
        pension_employer: 9.76,
        pension_employee: 9.76,
        disability_employer: 6.5,
        disability_employee: 1.5,
        health_insurance: 9,
        accident_insurance: 1.67,
      }),
    },
    {
      code: "PH",
      name: "Philippines",
      currency: "PHP",
      currency_symbol: "\u20B1",
      region: "asia",
      min_wage_monthly: 1301100, // ~PHP 13,011
      payroll_frequency: "biweekly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: true,
      notice_period_days: 30,
      probation_months: 6,
      max_work_hours_week: 48,
      annual_leave_days: 5,
      public_holidays: 18,
      compliance_notes: JSON.stringify({
        income_tax: "Progressive: 0%, 15%, 20%, 25%, 30%, 32%, 35%",
        sss_employer: 9.5,
        sss_employee: 4.5,
        philhealth_employer: 2.25,
        philhealth_employee: 2.25,
        pagibig_employer: 2,
        pagibig_employee: 2,
        thirteenth_month: "Mandatory 13th month pay",
      }),
    },
    {
      code: "ID",
      name: "Indonesia",
      currency: "IDR",
      currency_symbol: "Rp",
      region: "asia",
      min_wage_monthly: 491785300, // ~IDR 4,917,853
      payroll_frequency: "monthly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: true,
      notice_period_days: 30,
      probation_months: 3,
      max_work_hours_week: 40,
      annual_leave_days: 12,
      public_holidays: 16,
      compliance_notes: JSON.stringify({
        income_tax: "Progressive: 5%, 15%, 25%, 30%, 35%",
        bpjs_health_employer: 4,
        bpjs_health_employee: 1,
        bpjs_employment_jht_employer: 3.7,
        bpjs_employment_jht_employee: 2,
        bpjs_pension_employer: 2,
        bpjs_pension_employee: 1,
        thr: "Mandatory religious holiday bonus (THR)",
      }),
    },
    {
      code: "MY",
      name: "Malaysia",
      currency: "MYR",
      currency_symbol: "RM",
      region: "asia",
      min_wage_monthly: 150000, // RM 1,500
      payroll_frequency: "monthly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: false,
      notice_period_days: 30,
      probation_months: 6,
      max_work_hours_week: 45,
      annual_leave_days: 8,
      public_holidays: 11,
      compliance_notes: JSON.stringify({
        income_tax: "Progressive: 0-30%",
        epf_employer: 13,
        epf_employee: 11,
        socso_employer: 1.75,
        socso_employee: 0.5,
        eis_employer: 0.2,
        eis_employee: 0.2,
      }),
    },
    {
      code: "TH",
      name: "Thailand",
      currency: "THB",
      currency_symbol: "\u0E3F",
      region: "asia",
      min_wage_monthly: 990000, // THB 9,900
      payroll_frequency: "monthly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: true,
      notice_period_days: 30,
      probation_months: 4,
      max_work_hours_week: 48,
      annual_leave_days: 6,
      public_holidays: 16,
      compliance_notes: JSON.stringify({
        income_tax: "Progressive: 5%, 10%, 15%, 20%, 25%, 30%, 35%",
        social_security_employer: 5,
        social_security_employee: 5,
        social_security_cap: 1500000,
        provident_fund: "2-15% voluntary",
      }),
    },
    {
      code: "VN",
      name: "Vietnam",
      currency: "VND",
      currency_symbol: "\u20AB",
      region: "asia",
      min_wage_monthly: 468000000, // VND 4,680,000
      payroll_frequency: "monthly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: true,
      notice_period_days: 30,
      probation_months: 2,
      max_work_hours_week: 48,
      annual_leave_days: 12,
      public_holidays: 11,
      compliance_notes: JSON.stringify({
        income_tax: "Progressive: 5%, 10%, 15%, 20%, 25%, 30%, 35%",
        social_insurance_employer: 17.5,
        social_insurance_employee: 8,
        health_insurance_employer: 3,
        health_insurance_employee: 1.5,
        unemployment_employer: 1,
        unemployment_employee: 1,
      }),
    },
    {
      code: "ZA",
      name: "South Africa",
      currency: "ZAR",
      currency_symbol: "R",
      region: "africa",
      min_wage_monthly: 467200, // ZAR 4,672
      payroll_frequency: "monthly",
      tax_year_start: "03-01",
      has_social_security: true,
      has_pension: false,
      has_health_insurance: false,
      notice_period_days: 30,
      probation_months: 3,
      max_work_hours_week: 45,
      annual_leave_days: 15,
      public_holidays: 12,
      compliance_notes: JSON.stringify({
        income_tax: "Progressive: 18%, 26%, 31%, 36%, 39%, 41%, 45%",
        uif_employer: 1,
        uif_employee: 1,
        sdl: 1,
        compensation_fund: "0.11-8.26% depending on industry",
      }),
    },
    {
      code: "NG",
      name: "Nigeria",
      currency: "NGN",
      currency_symbol: "\u20A6",
      region: "africa",
      min_wage_monthly: 3000000, // NGN 30,000
      payroll_frequency: "monthly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: true,
      notice_period_days: 30,
      probation_months: 6,
      max_work_hours_week: 40,
      annual_leave_days: 6,
      public_holidays: 11,
      compliance_notes: JSON.stringify({
        income_tax: "Progressive: 7%, 11%, 15%, 19%, 21%, 24%",
        pension_employer: 10,
        pension_employee: 8,
        nhf: 2.5,
        itf: 1,
      }),
    },
    {
      code: "KE",
      name: "Kenya",
      currency: "KES",
      currency_symbol: "KSh",
      region: "africa",
      min_wage_monthly: 1578000, // KES 15,780
      payroll_frequency: "monthly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: true,
      notice_period_days: 30,
      probation_months: 6,
      max_work_hours_week: 52,
      annual_leave_days: 21,
      public_holidays: 10,
      compliance_notes: JSON.stringify({
        income_tax: "Progressive: 10%, 25%, 30%, 32.5%, 35%",
        nssf_employer: 6,
        nssf_employee: 6,
        nhif: "Graduated scale based on gross salary",
        housing_levy: 1.5,
      }),
    },
    {
      code: "EG",
      name: "Egypt",
      currency: "EGP",
      currency_symbol: "E\u00A3",
      region: "middle_east",
      min_wage_monthly: 350000, // EGP 3,500
      payroll_frequency: "monthly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: true,
      notice_period_days: 60,
      probation_months: 3,
      max_work_hours_week: 48,
      annual_leave_days: 21,
      public_holidays: 13,
      compliance_notes: JSON.stringify({
        income_tax: "Progressive: 0%, 10%, 15%, 20%, 22.5%, 25%",
        social_insurance_employer: 18.75,
        social_insurance_employee: 11,
      }),
    },
    {
      code: "SA",
      name: "Saudi Arabia",
      currency: "SAR",
      currency_symbol: "SAR",
      region: "middle_east",
      min_wage_monthly: 400000, // SAR 4,000 (nationals)
      payroll_frequency: "monthly",
      tax_year_start: "01-01",
      has_social_security: true,
      has_pension: true,
      has_health_insurance: true,
      notice_period_days: 60,
      probation_months: 3,
      max_work_hours_week: 48,
      annual_leave_days: 21,
      public_holidays: 9,
      compliance_notes: JSON.stringify({
        income_tax: 0,
        gosi_employer: 12,
        gosi_employee: 10,
        gosi_applies: "Saudi nationals: 22% total; Expats: 2% employer only",
        eos: "Half-month salary per year (first 5 yrs), full month after",
        health_insurance: "Mandatory for all employees",
      }),
    },
  ];

  // Insert countries — skip if already seeded (handles partial migration reruns)
  const existingCount = await knex("countries").count("* as cnt").first();
  if (!existingCount || Number(existingCount.cnt) === 0) {
    for (const country of countries) {
      await knex("countries").insert({
        id: knex.raw("(UUID())"),
        ...country,
        is_active: true,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("compliance_checklist");
  await knex.schema.dropTableIfExists("contractor_invoices");
  await knex.schema.dropTableIfExists("global_payroll_items");
  await knex.schema.dropTableIfExists("global_payroll_runs");
  await knex.schema.dropTableIfExists("global_employees");
  await knex.schema.dropTableIfExists("countries");
}
