// ============================================================================
// MIGRATION: Compensation Benchmarking
// ============================================================================

import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // -------------------------------------------------------------------------
  // Compensation Benchmarks (market data)
  // -------------------------------------------------------------------------
  await knex.schema.createTable("compensation_benchmarks", (t) => {
    t.uuid("id").primary();
    t.bigInteger("empcloud_org_id").unsigned().notNullable();
    t.string("job_title", 255).notNullable();
    t.string("department", 100).nullable();
    t.string("location", 255).nullable();
    t.decimal("market_p25", 15, 2).notNullable().defaultTo(0);
    t.decimal("market_p50", 15, 2).notNullable().defaultTo(0);
    t.decimal("market_p75", 15, 2).notNullable().defaultTo(0);
    t.string("source", 255).nullable(); // e.g., "Glassdoor 2026", "AmbitionBox"
    t.date("effective_date").notNullable();
    t.timestamps(true, true);

    t.index(["empcloud_org_id"]);
    t.index(["empcloud_org_id", "job_title"]);
    t.index(["empcloud_org_id", "department"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("compensation_benchmarks");
}
