// =============================================================================
// MIGRATION 031 — Fix payroll_runs unique index for multi-tenancy
// -----------------------------------------------------------------------------
// payroll_runs inherited a UNIQUE (org_id, month, year) constraint from the
// pre-EmpCloud schema where `org_id` was the org's primary UUID. After the
// EmpCloud migration the real tenant key became `empcloud_org_id` (a bigint
// FK to EmpCloud's `organizations.id`), and `org_id` got demoted to a legacy
// nullable / placeholder column that createRun fills with the dummy UUID
// "00000000-0000-0000-0000-000000000000".
//
// Net effect: the unique key collapsed to a single value across the whole
// system. Org A creating its May 2026 run blocked Org B from creating ITS
// May 2026 run with ER_DUP_ENTRY on
// "00000000-0000-0000-0000-000000000000-5-2026". Multi-tenancy was broken
// the moment the second tenant started running payroll.
//
// Switch the unique key to the correct semantic identifier:
//   (empcloud_org_id, month, year)
//
// Mirrors migration 030 (which did the equivalent fix on `payslips`).
// =============================================================================

import type { Knex } from "knex";

const OLD_INDEX = "payroll_runs_org_id_month_year_unique";
const NEW_INDEX = "payroll_runs_empcloud_org_id_month_year_unique";

async function indexExists(knex: Knex, name: string): Promise<boolean> {
  const rows = (await knex.raw(`SHOW INDEX FROM payroll_runs WHERE Key_name = ?`, [name])) as any;
  return Array.isArray(rows?.[0]) ? rows[0].length > 0 : Array.isArray(rows) && rows.length > 0;
}

async function columnExists(knex: Knex, column: string): Promise<boolean> {
  return knex.schema.hasColumn("payroll_runs", column);
}

export async function up(knex: Knex): Promise<void> {
  if (!(await columnExists(knex, "empcloud_org_id"))) {
    // Earlier migration should have added this column already, but guard
    // anyway so this migration is safe to run on a partially-migrated DB.
    return;
  }

  // Add the new (empcloud_org_id, month, year) unique BEFORE dropping the
  // old one. No FK on payroll_runs.org_id today (migration 011 dropped the
  // legacy FK), so order is purely defensive — keep the table covered by
  // *some* unique-on-period at every point so a concurrent createRun can't
  // slip a duplicate through during the window.
  if (!(await indexExists(knex, NEW_INDEX))) {
    await knex.schema.alterTable("payroll_runs", (t) => {
      t.unique(["empcloud_org_id", "month", "year"], { indexName: NEW_INDEX });
    });
  }

  if (await indexExists(knex, OLD_INDEX)) {
    await knex.schema.alterTable("payroll_runs", (t) => {
      t.dropUnique(["org_id", "month", "year"], OLD_INDEX);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (!(await indexExists(knex, OLD_INDEX))) {
    await knex.schema.alterTable("payroll_runs", (t) => {
      t.unique(["org_id", "month", "year"], { indexName: OLD_INDEX });
    });
  }
  if (await indexExists(knex, NEW_INDEX)) {
    await knex.schema.alterTable("payroll_runs", (t) => {
      t.dropUnique(["empcloud_org_id", "month", "year"], NEW_INDEX);
    });
  }
}
