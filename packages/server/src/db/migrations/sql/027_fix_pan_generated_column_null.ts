// =============================================================================
// MIGRATION 027 — Fix PAN generated column to map JSON null → SQL NULL
//
// Migration 026 added pan_number as:
//   GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(tax_info, '$.pan'))) STORED
//
// MySQL gotcha: JSON_UNQUOTE on JSON null returns the literal string 'null',
// not SQL NULL. Migration 025 clears invalid PANs to JSON null, so every
// such row materialises as pan_number = 'null'. The unique index then
// chokes on N rows all sharing pan_number = 'null':
//
//   CREATE UNIQUE INDEX idx_emp_payroll_profiles_org_pan_uniq
//     ON employee_payroll_profiles (empcloud_org_id, pan_number)
//   - Duplicate entry '1-null' for key '...idx_emp_payroll_profiles_org_pan_uniq'
//
// Prod's 026 failed at the index step on first deploy (the column was
// created with the bad expression but the unique index never landed). On
// fresh boxes 026 hasn't run at all.
//
// This migration converges both states:
//   1. Drop the index if it exists (defensive — usually doesn't on prod).
//   2. Drop the pan_number column if it exists (the bad-expression one
//      from 026, or any older shape).
//   3. Re-create the column with NULLIF wrapping JSON_UNQUOTE so JSON null
//      maps to SQL NULL — multiple NULLs are then permitted by the unique
//      index, exactly as 026's comment intended.
//   4. Create the unique index.
//
// Rebuilding a STORED GENERATED column re-materialises all rows in one
// pass; safe for the row counts we have.
// =============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex) {
  if (!(await knex.schema.hasTable("employee_payroll_profiles"))) return;

  // Step 1 — drop the unique index if it landed somehow (it shouldn't on
  // boxes where 026 failed mid-way, but a re-run might have created it).
  await knex
    .raw("DROP INDEX idx_emp_payroll_profiles_org_pan_uniq ON employee_payroll_profiles")
    .catch(() => {
      /* index didn't exist — fine */
    });

  // Step 2 — drop the pan_number column. We rebuild it because the
  // expression itself needs to change; ALTER TABLE … MODIFY COLUMN can't
  // change the GENERATED expression in place reliably across MySQL
  // versions, and dropping is portable.
  if (await knex.schema.hasColumn("employee_payroll_profiles", "pan_number")) {
    await knex.raw("ALTER TABLE employee_payroll_profiles DROP COLUMN pan_number");
  }

  // Step 3 — recreate with NULLIF so the literal string 'null' (which
  // JSON_UNQUOTE returns for JSON null) becomes SQL NULL. Length stays
  // VARCHAR(32) to match 026 (room for the migration-025 dedup suffix
  // "BLAPH0001Z-DUP-aaaaaaaa").
  await knex.raw(`
    ALTER TABLE employee_payroll_profiles
    ADD COLUMN pan_number VARCHAR(32)
    GENERATED ALWAYS AS (
      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(tax_info, '$.pan')), 'null')
    ) STORED
  `);

  // Step 4 — create the unique index. Multiple SQL NULLs are now
  // permitted; only real PAN strings will collide.
  await knex.raw(`
    CREATE UNIQUE INDEX idx_emp_payroll_profiles_org_pan_uniq
      ON employee_payroll_profiles (empcloud_org_id, pan_number)
  `);
}

export async function down(knex: Knex) {
  if (!(await knex.schema.hasTable("employee_payroll_profiles"))) return;

  await knex
    .raw("DROP INDEX idx_emp_payroll_profiles_org_pan_uniq ON employee_payroll_profiles")
    .catch(() => {});

  if (await knex.schema.hasColumn("employee_payroll_profiles", "pan_number")) {
    await knex.raw("ALTER TABLE employee_payroll_profiles DROP COLUMN pan_number");
  }
}
