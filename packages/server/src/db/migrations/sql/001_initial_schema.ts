// ============================================================================
// MIGRATION: Initial payroll schema
// Works with both MySQL and PostgreSQL via Knex
// ============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // -------------------------------------------------------------------------
  // Organizations
  // -------------------------------------------------------------------------
  await knex.schema.createTable("organizations", (t) => {
    t.uuid("id").primary();
    t.string("name", 255).notNullable();
    t.string("legal_name", 255).notNullable();
    t.string("pan", 10).notNullable();
    t.string("tan", 10).notNullable();
    t.string("gstin", 15).nullable();
    t.string("pf_establishment_code", 50).nullable();
    t.string("esi_establishment_code", 50).nullable();
    t.string("pt_registration_number", 50).nullable();
    t.jsonb("registered_address").notNullable();
    t.string("pay_frequency", 20).defaultTo("monthly");
    t.integer("financial_year_start").defaultTo(4);
    t.string("currency", 3).defaultTo("INR");
    t.string("country", 2).defaultTo("IN");
    t.string("state", 5).notNullable();
    t.boolean("is_active").defaultTo(true);
    t.timestamps(true, true);
  });

  // -------------------------------------------------------------------------
  // Employees
  // -------------------------------------------------------------------------
  await knex.schema.createTable("employees", (t) => {
    t.uuid("id").primary();
    t.uuid("org_id").notNullable().references("id").inTable("organizations").onDelete("CASCADE");
    t.string("employee_code", 50).notNullable();
    t.string("first_name", 100).notNullable();
    t.string("last_name", 100).notNullable();
    t.string("email", 255).notNullable();
    t.string("phone", 20).nullable();
    t.date("date_of_birth").notNullable();
    t.string("gender", 10).notNullable();
    t.date("date_of_joining").notNullable();
    t.date("date_of_exit").nullable();
    t.string("employment_type", 20).defaultTo("full_time");
    t.string("department", 100).notNullable();
    t.string("designation", 100).notNullable();
    t.uuid("reporting_manager_id").nullable().references("id").inTable("employees");
    t.jsonb("address").nullable();
    t.jsonb("bank_details").notNullable();
    t.jsonb("tax_info").notNullable();
    t.jsonb("pf_details").notNullable();
    t.jsonb("esi_details").nullable();
    t.string("role", 20).defaultTo("employee");
    t.string("password_hash", 255).nullable();
    t.boolean("is_active").defaultTo(true);
    t.timestamps(true, true);

    t.unique(["org_id", "employee_code"]);
    t.unique(["email"]);
    t.index(["org_id", "is_active"]);
    t.index(["org_id", "department"]);
  });

  // -------------------------------------------------------------------------
  // Salary Structures (templates)
  // -------------------------------------------------------------------------
  await knex.schema.createTable("salary_structures", (t) => {
    t.uuid("id").primary();
    t.uuid("org_id").notNullable().references("id").inTable("organizations").onDelete("CASCADE");
    t.string("name", 100).notNullable();
    t.text("description").nullable();
    t.boolean("is_default").defaultTo(false);
    t.boolean("is_active").defaultTo(true);
    t.timestamps(true, true);

    t.index(["org_id", "is_active"]);
  });

  // -------------------------------------------------------------------------
  // Salary Components (belong to a structure)
  // -------------------------------------------------------------------------
  await knex.schema.createTable("salary_components", (t) => {
    t.uuid("id").primary();
    t.uuid("structure_id")
      .notNullable()
      .references("id")
      .inTable("salary_structures")
      .onDelete("CASCADE");
    t.string("name", 100).notNullable();
    t.string("code", 20).notNullable();
    t.string("type", 20).notNullable(); // earning, deduction, reimbursement, benefit
    t.string("calculation_type", 20).notNullable(); // fixed, percentage, formula
    t.decimal("value", 15, 2).defaultTo(0);
    t.string("percentage_of", 20).nullable(); // code of component to calc % of
    t.text("formula").nullable();
    t.boolean("is_taxable").defaultTo(true);
    t.boolean("is_statutory").defaultTo(false);
    t.boolean("is_proratable").defaultTo(true);
    t.boolean("is_active").defaultTo(true);
    t.integer("sort_order").defaultTo(0);
    t.timestamps(true, true);

    t.unique(["structure_id", "code"]);
  });

  // -------------------------------------------------------------------------
  // Employee Salaries (assigned structure + amounts)
  // -------------------------------------------------------------------------
  await knex.schema.createTable("employee_salaries", (t) => {
    t.uuid("id").primary();
    t.uuid("employee_id").notNullable().references("id").inTable("employees").onDelete("CASCADE");
    t.uuid("structure_id").notNullable().references("id").inTable("salary_structures");
    t.decimal("ctc", 15, 2).notNullable();
    t.decimal("gross_salary", 15, 2).notNullable();
    t.decimal("net_salary", 15, 2).notNullable();
    t.jsonb("components").notNullable(); // EmployeeSalaryComponent[]
    t.date("effective_from").notNullable();
    t.date("effective_to").nullable();
    t.boolean("is_active").defaultTo(true);
    t.timestamps(true, true);

    t.index(["employee_id", "is_active"]);
  });

  // -------------------------------------------------------------------------
  // Payroll Runs
  // -------------------------------------------------------------------------
  await knex.schema.createTable("payroll_runs", (t) => {
    t.uuid("id").primary();
    t.uuid("org_id").notNullable().references("id").inTable("organizations").onDelete("CASCADE");
    t.string("name", 100).notNullable();
    t.integer("month").notNullable();
    t.integer("year").notNullable();
    t.date("pay_date").notNullable();
    t.string("status", 20).defaultTo("draft");
    t.decimal("total_gross", 15, 2).defaultTo(0);
    t.decimal("total_deductions", 15, 2).defaultTo(0);
    t.decimal("total_net", 15, 2).defaultTo(0);
    t.decimal("total_employer_contributions", 15, 2).defaultTo(0);
    t.integer("employee_count").defaultTo(0);
    t.uuid("processed_by").nullable().references("id").inTable("employees");
    t.uuid("approved_by").nullable().references("id").inTable("employees");
    t.timestamp("approved_at").nullable();
    t.text("notes").nullable();
    t.timestamps(true, true);

    t.unique(["org_id", "month", "year"]);
    t.index(["org_id", "status"]);
  });

  // -------------------------------------------------------------------------
  // Payslips
  // -------------------------------------------------------------------------
  await knex.schema.createTable("payslips", (t) => {
    t.uuid("id").primary();
    t.uuid("payroll_run_id")
      .notNullable()
      .references("id")
      .inTable("payroll_runs")
      .onDelete("CASCADE");
    t.uuid("employee_id").notNullable().references("id").inTable("employees");
    t.integer("month").notNullable();
    t.integer("year").notNullable();
    t.decimal("paid_days", 5, 1).notNullable();
    t.integer("total_days").notNullable();
    t.decimal("lop_days", 5, 1).defaultTo(0);
    t.jsonb("earnings").notNullable();
    t.jsonb("deductions").notNullable();
    t.jsonb("employer_contributions").notNullable();
    t.jsonb("reimbursements").notNullable();
    t.decimal("gross_earnings", 15, 2).notNullable();
    t.decimal("total_deductions", 15, 2).notNullable();
    t.decimal("net_pay", 15, 2).notNullable();
    t.decimal("total_employer_cost", 15, 2).notNullable();
    t.decimal("ytd_gross", 15, 2).defaultTo(0);
    t.decimal("ytd_deductions", 15, 2).defaultTo(0);
    t.decimal("ytd_net_pay", 15, 2).defaultTo(0);
    t.decimal("ytd_tax_paid", 15, 2).defaultTo(0);
    t.string("status", 20).defaultTo("generated");
    t.timestamp("generated_at").defaultTo(knex.fn.now());
    t.timestamp("sent_at").nullable();
    t.timestamps(true, true);

    t.unique(["payroll_run_id", "employee_id"]);
    t.index(["employee_id", "year", "month"]);
  });

  // -------------------------------------------------------------------------
  // Tax Computations
  // -------------------------------------------------------------------------
  await knex.schema.createTable("tax_computations", (t) => {
    t.uuid("id").primary();
    t.uuid("employee_id").notNullable().references("id").inTable("employees").onDelete("CASCADE");
    t.string("financial_year", 7).notNullable();
    t.string("regime", 5).notNullable();
    t.decimal("gross_income", 15, 2).notNullable();
    t.jsonb("exemptions").notNullable();
    t.decimal("total_exemptions", 15, 2).notNullable();
    t.jsonb("deductions").notNullable();
    t.decimal("total_deductions", 15, 2).notNullable();
    t.decimal("taxable_income", 15, 2).notNullable();
    t.decimal("tax_on_income", 15, 2).notNullable();
    t.decimal("surcharge", 15, 2).defaultTo(0);
    t.decimal("health_and_education_cess", 15, 2).notNullable();
    t.decimal("total_tax", 15, 2).notNullable();
    t.decimal("tax_already_paid", 15, 2).defaultTo(0);
    t.decimal("remaining_tax", 15, 2).notNullable();
    t.decimal("monthly_tds", 15, 2).notNullable();
    t.timestamp("computed_at").defaultTo(knex.fn.now());
    t.timestamps(true, true);

    t.index(["employee_id", "financial_year"]);
  });

  // -------------------------------------------------------------------------
  // Tax Declarations
  // -------------------------------------------------------------------------
  await knex.schema.createTable("tax_declarations", (t) => {
    t.uuid("id").primary();
    t.uuid("employee_id").notNullable().references("id").inTable("employees").onDelete("CASCADE");
    t.string("financial_year", 7).notNullable();
    t.string("section", 20).notNullable();
    t.string("description", 255).notNullable();
    t.decimal("declared_amount", 15, 2).notNullable();
    t.boolean("proof_submitted").defaultTo(false);
    t.string("proof_url", 500).nullable();
    t.decimal("approved_amount", 15, 2).defaultTo(0);
    t.string("approval_status", 20).defaultTo("pending");
    t.uuid("approved_by").nullable().references("id").inTable("employees");
    t.timestamp("approved_at").nullable();
    t.timestamps(true, true);

    t.index(["employee_id", "financial_year"]);
  });

  // -------------------------------------------------------------------------
  // Attendance Summaries (synced from EmpMonitor or imported)
  // -------------------------------------------------------------------------
  await knex.schema.createTable("attendance_summaries", (t) => {
    t.uuid("id").primary();
    t.uuid("employee_id").notNullable().references("id").inTable("employees").onDelete("CASCADE");
    t.integer("month").notNullable();
    t.integer("year").notNullable();
    t.integer("total_days").notNullable();
    t.decimal("present_days", 5, 1).notNullable();
    t.decimal("absent_days", 5, 1).defaultTo(0);
    t.decimal("half_days", 5, 1).defaultTo(0);
    t.decimal("paid_leave", 5, 1).defaultTo(0);
    t.decimal("unpaid_leave", 5, 1).defaultTo(0);
    t.integer("holidays").defaultTo(0);
    t.integer("weekoffs").defaultTo(0);
    t.decimal("lop_days", 5, 1).defaultTo(0);
    t.decimal("overtime_hours", 7, 2).defaultTo(0);
    t.decimal("overtime_rate", 10, 2).defaultTo(0);
    t.decimal("overtime_amount", 15, 2).defaultTo(0);
    t.timestamps(true, true);

    t.unique(["employee_id", "month", "year"]);
  });

  // -------------------------------------------------------------------------
  // Reimbursement Claims
  // -------------------------------------------------------------------------
  await knex.schema.createTable("reimbursements", (t) => {
    t.uuid("id").primary();
    t.uuid("employee_id").notNullable().references("id").inTable("employees").onDelete("CASCADE");
    t.string("category", 50).notNullable(); // medical, travel, food, etc.
    t.string("description", 500).notNullable();
    t.decimal("amount", 15, 2).notNullable();
    t.string("receipt_url", 500).nullable();
    t.date("expense_date").notNullable();
    t.string("status", 20).defaultTo("pending"); // pending, approved, rejected, paid
    t.uuid("approved_by").nullable().references("id").inTable("employees");
    t.timestamp("approved_at").nullable();
    t.integer("paid_in_month").nullable();
    t.integer("paid_in_year").nullable();
    t.timestamps(true, true);

    t.index(["employee_id", "status"]);
  });

  // -------------------------------------------------------------------------
  // Audit Log
  // -------------------------------------------------------------------------
  await knex.schema.createTable("audit_logs", (t) => {
    t.uuid("id").primary();
    t.uuid("org_id").notNullable();
    t.uuid("user_id").notNullable();
    t.string("action", 50).notNullable(); // payroll.created, payslip.sent, etc.
    t.string("entity_type", 50).notNullable();
    t.uuid("entity_id").nullable();
    t.jsonb("old_value").nullable();
    t.jsonb("new_value").nullable();
    t.string("ip_address", 50).nullable();
    t.timestamp("created_at").defaultTo(knex.fn.now());

    t.index(["org_id", "created_at"]);
    t.index(["entity_type", "entity_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  const tables = [
    "audit_logs",
    "reimbursements",
    "attendance_summaries",
    "tax_declarations",
    "tax_computations",
    "payslips",
    "payroll_runs",
    "employee_salaries",
    "salary_components",
    "salary_structures",
    "employees",
    "organizations",
  ];
  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
}
