// =============================================================================
// MIGRATION 026 — PAN number column + UNIQUE(empcloud_org_id, pan_number)
//
// Pre-req: migration 025 has cleaned the dataset (no duplicates, no
// invalid-format PANs).
//
// PAN was previously stored only inside the `tax_info` JSONB blob, which
// can't carry a UNIQUE constraint or a CHECK. Two real production bugs:
//   - EmpCloud/EmpCloud#1656: three employees in one org with PAN
//     BLAPH256H — illegal under Indian income-tax rules.
//   - EmpCloud/EmpCloud#1657: TDS deducted on employees with no PAN at
//     standard rate instead of Section 206AA flat 20%.
//
// We add a STORED GENERATED column that's always kept in lockstep with
// `tax_info.pan` by the database engine. App code keeps writing to
// tax_info; the generated column updates automatically. The UNIQUE
// constraint then enforces "one PAN per org" at the storage layer
// without any dual-write logic in services.
//
// VARCHAR(32) gives headroom for the migration-025 dedup suffix
// "BLAPH0001Z-DUP-aaaaaaaa" (23 chars).
//
// MySQL-only — generated columns of this shape are an 8.0+ feature.
// Idempotent: skips if column / index already exist.
// =============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex) {
  if (!(await knex.schema.hasTable("employee_payroll_profiles"))) return;

  if (!(await knex.schema.hasColumn("employee_payroll_profiles", "pan_number"))) {
    await knex.raw(`
      ALTER TABLE employee_payroll_profiles
      ADD COLUMN pan_number VARCHAR(32)
      GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(tax_info, '$.pan'))) STORED
    `);
  }

  // Unique index on (empcloud_org_id, pan_number). MySQL allows multiple
  // NULLs in a UNIQUE index, so employees who haven't entered a PAN don't
  // collide — they go through the Section 206AA branch in the tax engine.
  const idx = await knex.raw(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
       WHERE table_schema = DATABASE()
         AND table_name = 'employee_payroll_profiles'
         AND index_name = 'idx_emp_payroll_profiles_org_pan_uniq'`,
  );
  // mysql2 returns [rows, fields]; rows is empty if the index doesn't exist
  const exists = Array.isArray(idx[0]) && idx[0].length > 0;
  if (!exists) {
    await knex.raw(`
      CREATE UNIQUE INDEX idx_emp_payroll_profiles_org_pan_uniq
        ON employee_payroll_profiles (empcloud_org_id, pan_number)
    `);
  }
}

export async function down(knex: Knex) {
  if (!(await knex.schema.hasTable("employee_payroll_profiles"))) return;

  // Index must be dropped before the generated column it references.
  await knex
    .raw(`DROP INDEX idx_emp_payroll_profiles_org_pan_uniq ON employee_payroll_profiles`)
    .catch(() => {});

  if (await knex.schema.hasColumn("employee_payroll_profiles", "pan_number")) {
    await knex.schema.alterTable("employee_payroll_profiles", (t) => {
      t.dropColumn("pan_number");
    });
  }
}
