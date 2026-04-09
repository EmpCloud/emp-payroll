// ============================================================================
// MIGRATION: Insurance Management
// ============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // -------------------------------------------------------------------------
  // Insurance Policies
  // -------------------------------------------------------------------------
  await knex.schema.createTable("insurance_policies", (t) => {
    t.uuid("id").primary();
    t.bigInteger("empcloud_org_id").unsigned().notNullable();
    t.string("name", 255).notNullable();
    t.string("policy_number", 100).nullable();
    t.string("provider", 255).notNullable();
    t.string("type", 30).notNullable(); // group_health, group_life, disability, accidental, travel
    t.bigInteger("premium_total").notNullable().defaultTo(0);
    t.bigInteger("premium_per_employee").notNullable().defaultTo(0);
    t.bigInteger("coverage_amount").notNullable().defaultTo(0);
    t.date("start_date").notNullable();
    t.date("end_date").nullable();
    t.date("renewal_date").nullable();
    t.string("status", 20).notNullable().defaultTo("active"); // active, expired, cancelled
    t.text("document_url").nullable();
    t.text("terms").nullable();
    t.timestamps(true, true);

    t.index(["empcloud_org_id", "status"]);
    t.index(["empcloud_org_id", "type"]);
  });

  // -------------------------------------------------------------------------
  // Employee Insurance (enrollments)
  // -------------------------------------------------------------------------
  await knex.schema.createTable("employee_insurance", (t) => {
    t.uuid("id").primary();
    t.bigInteger("empcloud_org_id").unsigned().notNullable();
    t.uuid("policy_id")
      .notNullable()
      .references("id")
      .inTable("insurance_policies")
      .onDelete("CASCADE");
    t.bigInteger("employee_id").unsigned().notNullable();
    t.string("status", 20).notNullable().defaultTo("active"); // active, inactive, claimed
    t.bigInteger("sum_insured").notNullable().defaultTo(0);
    t.bigInteger("premium_share").notNullable().defaultTo(0); // employee's share of premium
    t.string("nominee_name", 255).nullable();
    t.string("nominee_relationship", 50).nullable();
    t.date("enrolled_at").nullable();
    t.timestamps(true, true);

    t.index(["empcloud_org_id", "employee_id"]);
    t.index(["policy_id"]);
    t.index(["status"]);
  });

  // -------------------------------------------------------------------------
  // Insurance Claims
  // -------------------------------------------------------------------------
  await knex.schema.createTable("insurance_claims", (t) => {
    t.uuid("id").primary();
    t.bigInteger("empcloud_org_id").unsigned().notNullable();
    t.uuid("policy_id")
      .notNullable()
      .references("id")
      .inTable("insurance_policies")
      .onDelete("CASCADE");
    t.bigInteger("employee_id").unsigned().notNullable();
    t.string("claim_number", 20).notNullable().unique(); // CLM-YYYY-NNNN
    t.string("claim_type", 30).notNullable(); // hospitalization, outpatient, dental, vision, life, disability
    t.bigInteger("amount_claimed").notNullable();
    t.bigInteger("amount_approved").nullable();
    t.string("status", 20).notNullable().defaultTo("submitted"); // submitted, under_review, approved, rejected, settled
    t.text("description").nullable();
    t.jsonb("documents").nullable(); // array of file URLs
    t.timestamp("submitted_at").notNullable().defaultTo(knex.fn.now());
    t.bigInteger("reviewed_by").unsigned().nullable();
    t.timestamp("reviewed_at").nullable();
    t.timestamp("settled_at").nullable();
    t.text("rejection_reason").nullable();
    t.text("notes").nullable();
    t.timestamps(true, true);

    t.index(["empcloud_org_id", "status"]);
    t.index(["empcloud_org_id", "employee_id"]);
    t.index(["policy_id"]);
    t.index(["claim_number"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("insurance_claims");
  await knex.schema.dropTableIfExists("employee_insurance");
  await knex.schema.dropTableIfExists("insurance_policies");
}
