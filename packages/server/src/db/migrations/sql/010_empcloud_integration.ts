// ============================================================================
// MIGRATION: EmpCloud Integration
//
// Restructures the payroll database to reference the EmpCloud master database
// for user/organization identity. The payroll DB no longer owns employee or
// organization records — it stores payroll-specific extension data only.
//
// Changes:
// 1. Drops the old `employees` and `organizations` tables (payroll-owned)
// 2. Creates `organization_payroll_settings` — payroll config per org
// 3. Creates `employee_payroll_profiles` — payroll-specific employee data
// 4. Updates all FK references to use empcloud bigint IDs
// ============================================================================

import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // -------------------------------------------------------------------------
  // 1. Create organization_payroll_settings (replaces organizations table)
  //    Stores payroll-specific config; references empcloud org ID.
  // -------------------------------------------------------------------------
  await knex.schema.createTable("organization_payroll_settings", (t) => {
    t.uuid("id").primary();
    t.bigInteger("empcloud_org_id").unsigned().notNullable().unique();
    t.string("name", 255).notNullable();
    t.string("legal_name", 255).nullable();
    t.string("pan", 10).nullable();
    t.string("tan", 10).nullable();
    t.string("gstin", 15).nullable();
    t.string("pf_establishment_code", 50).nullable();
    t.string("esi_establishment_code", 50).nullable();
    t.string("pt_registration_number", 50).nullable();
    t.jsonb("registered_address").nullable();
    t.string("pay_frequency", 20).defaultTo("monthly");
    t.integer("financial_year_start").defaultTo(4);
    t.string("currency", 3).defaultTo("INR");
    t.string("country", 2).defaultTo("IN");
    t.string("state", 100).nullable();
    t.boolean("is_active").defaultTo(true);
    t.timestamps(true, true);

    t.index(["empcloud_org_id"]);
  });

  // -------------------------------------------------------------------------
  // 2. Create employee_payroll_profiles (replaces employees table for payroll)
  //    Stores bank details, tax info, PF/ESI — payroll-specific data.
  //    References empcloud user ID and org ID.
  // -------------------------------------------------------------------------
  await knex.schema.createTable("employee_payroll_profiles", (t) => {
    t.uuid("id").primary();
    t.bigInteger("empcloud_user_id").unsigned().notNullable().unique();
    t.bigInteger("empcloud_org_id").unsigned().notNullable();
    t.string("employee_code", 50).nullable();
    t.jsonb("address").nullable();
    t.jsonb("bank_details").nullable();
    t.jsonb("tax_info").nullable();
    t.jsonb("pf_details").nullable();
    t.jsonb("esi_details").nullable();
    t.boolean("is_active").defaultTo(true);
    t.timestamps(true, true);

    t.index(["empcloud_org_id", "is_active"]);
    t.index(["empcloud_user_id"]);
  });

  // -------------------------------------------------------------------------
  // 3. Add empcloud ID columns to existing payroll tables
  //    These replace the old UUID-based org_id / employee_id references.
  // -------------------------------------------------------------------------

  // salary_structures: add empcloud_org_id
  await knex.schema.alterTable("salary_structures", (t) => {
    t.bigInteger("empcloud_org_id").unsigned().nullable().after("org_id");
    t.index(["empcloud_org_id"]);
  });

  // employee_salaries: add empcloud_user_id
  await knex.schema.alterTable("employee_salaries", (t) => {
    t.bigInteger("empcloud_user_id").unsigned().nullable().after("employee_id");
    t.index(["empcloud_user_id"]);
  });

  // payroll_runs: add empcloud_org_id
  await knex.schema.alterTable("payroll_runs", (t) => {
    t.bigInteger("empcloud_org_id").unsigned().nullable().after("org_id");
    t.index(["empcloud_org_id"]);
  });

  // payslips: add empcloud_user_id
  await knex.schema.alterTable("payslips", (t) => {
    t.bigInteger("empcloud_user_id").unsigned().nullable().after("employee_id");
    t.index(["empcloud_user_id"]);
  });

  // tax_computations: add empcloud_user_id
  await knex.schema.alterTable("tax_computations", (t) => {
    t.bigInteger("empcloud_user_id").unsigned().nullable().after("employee_id");
  });

  // tax_declarations: add empcloud_user_id
  await knex.schema.alterTable("tax_declarations", (t) => {
    t.bigInteger("empcloud_user_id").unsigned().nullable().after("employee_id");
  });

  // attendance_summaries: add empcloud_user_id
  await knex.schema.alterTable("attendance_summaries", (t) => {
    t.bigInteger("empcloud_user_id").unsigned().nullable().after("employee_id");
  });

  // reimbursements: add empcloud_user_id
  await knex.schema.alterTable("reimbursements", (t) => {
    t.bigInteger("empcloud_user_id").unsigned().nullable().after("employee_id");
  });

  // audit_logs: add empcloud references
  await knex.schema.alterTable("audit_logs", (t) => {
    t.bigInteger("empcloud_user_id").unsigned().nullable().after("user_id");
    t.bigInteger("empcloud_org_id").unsigned().nullable().after("org_id");
  });

  // leave_balances (if exists)
  if (await knex.schema.hasTable("leave_balances")) {
    await knex.schema.alterTable("leave_balances", (t) => {
      t.bigInteger("empcloud_user_id").unsigned().nullable().after("employee_id");
    });
  }

  // loans (if exists)
  if (await knex.schema.hasTable("loans")) {
    await knex.schema.alterTable("loans", (t) => {
      t.bigInteger("empcloud_user_id").unsigned().nullable().after("employee_id");
    });
  }

  // leave_requests (if exists)
  if (await knex.schema.hasTable("leave_requests")) {
    await knex.schema.alterTable("leave_requests", (t) => {
      t.bigInteger("empcloud_user_id").unsigned().nullable().after("employee_id");
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  // Remove empcloud columns from existing tables
  const alterations: Array<[string, string[]]> = [
    ["salary_structures", ["empcloud_org_id"]],
    ["employee_salaries", ["empcloud_user_id"]],
    ["payroll_runs", ["empcloud_org_id"]],
    ["payslips", ["empcloud_user_id"]],
    ["tax_computations", ["empcloud_user_id"]],
    ["tax_declarations", ["empcloud_user_id"]],
    ["attendance_summaries", ["empcloud_user_id"]],
    ["reimbursements", ["empcloud_user_id"]],
    ["audit_logs", ["empcloud_user_id", "empcloud_org_id"]],
  ];

  for (const [table, cols] of alterations) {
    if (await knex.schema.hasTable(table)) {
      await knex.schema.alterTable(table, (t) => {
        for (const col of cols) t.dropColumn(col);
      });
    }
  }

  for (const t of ["leave_balances", "loans", "leave_requests"]) {
    if (await knex.schema.hasTable(t)) {
      const hasCol = await knex.schema.hasColumn(t, "empcloud_user_id");
      if (hasCol) {
        await knex.schema.alterTable(t, (tb) => tb.dropColumn("empcloud_user_id"));
      }
    }
  }

  await knex.schema.dropTableIfExists("employee_payroll_profiles");
  await knex.schema.dropTableIfExists("organization_payroll_settings");
}
