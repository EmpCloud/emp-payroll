// ============================================================================
// MIGRATION: Benefits Enrollment & Administration
// ============================================================================

import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // -------------------------------------------------------------------------
  // Benefit Plans
  // -------------------------------------------------------------------------
  await knex.schema.createTable("benefit_plans", (t) => {
    t.uuid("id").primary();
    t.bigInteger("empcloud_org_id").unsigned().notNullable();
    t.string("name", 100).notNullable();
    t.string("type", 30).notNullable(); // health, dental, vision, life, disability, retirement
    t.string("provider", 255).nullable();
    t.text("description").nullable();
    t.decimal("premium_amount", 15, 2).notNullable().defaultTo(0);
    t.decimal("employer_contribution", 15, 2).notNullable().defaultTo(0);
    t.jsonb("coverage_details").nullable();
    t.date("enrollment_period_start").nullable();
    t.date("enrollment_period_end").nullable();
    t.boolean("is_active").defaultTo(true);
    t.timestamps(true, true);

    t.index(["empcloud_org_id", "is_active"]);
    t.index(["empcloud_org_id", "type"]);
  });

  // -------------------------------------------------------------------------
  // Employee Benefits (enrollments)
  // -------------------------------------------------------------------------
  await knex.schema.createTable("employee_benefits", (t) => {
    t.uuid("id").primary();
    t.bigInteger("empcloud_org_id").unsigned().notNullable();
    t.bigInteger("empcloud_user_id").unsigned().notNullable();
    t.uuid("plan_id").notNullable().references("id").inTable("benefit_plans").onDelete("CASCADE");
    t.string("status", 20).notNullable().defaultTo("pending"); // enrolled, pending, cancelled
    t.string("coverage_type", 30).notNullable().defaultTo("individual"); // individual, family, individual_plus_spouse
    t.date("start_date").notNullable();
    t.date("end_date").nullable();
    t.decimal("premium_employee_share", 15, 2).notNullable().defaultTo(0);
    t.decimal("premium_employer_share", 15, 2).notNullable().defaultTo(0);
    t.timestamps(true, true);

    t.index(["empcloud_org_id", "empcloud_user_id"]);
    t.index(["plan_id"]);
    t.index(["status"]);
  });

  // -------------------------------------------------------------------------
  // Benefit Dependents
  // -------------------------------------------------------------------------
  await knex.schema.createTable("benefit_dependents", (t) => {
    t.uuid("id").primary();
    t.uuid("enrollment_id")
      .notNullable()
      .references("id")
      .inTable("employee_benefits")
      .onDelete("CASCADE");
    t.bigInteger("empcloud_org_id").unsigned().notNullable();
    t.string("name", 255).notNullable();
    t.string("relationship", 50).notNullable(); // spouse, child, parent
    t.date("date_of_birth").nullable();
    t.timestamps(true, true);

    t.index(["enrollment_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("benefit_dependents");
  await knex.schema.dropTableIfExists("employee_benefits");
  await knex.schema.dropTableIfExists("benefit_plans");
}
