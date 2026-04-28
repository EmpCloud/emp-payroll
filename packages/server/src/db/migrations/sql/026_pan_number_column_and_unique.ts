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
// We add a STORED GENERATED column kept in lockstep with `tax_info.pan`
// by the database engine. App code keeps writing to tax_info; the
// generated column updates automatically. The UNIQUE constraint then
// enforces "one PAN per org" at the storage layer.
//
// MySQL gotcha (the one this migration originally tripped on):
// `JSON_UNQUOTE(JSON_EXTRACT(... '$.pan'))` returns the LITERAL STRING
// `'null'` when the JSON value is `null`. Migration 025 sets invalid PANs
// to JSON null, so without the NULLIF wrapper every cleared row
// materialises as pan_number = 'null' and the UNIQUE index trips with
// "Duplicate entry '1-null'". NULLIF coerces the 'null' literal back to
// SQL NULL, and MySQL allows multiple SQL NULLs in a UNIQUE index.
//
// The migration is now self-healing: if a previous attempt left the
// column with the buggy expression (or left a partial index), this
// drops both and rebuilds from scratch. Idempotent on fresh DBs, on
// partially-applied DBs, and on already-fully-applied DBs.
//
// VARCHAR(32) gives headroom for 025's dedup suffix
// "BLAPH0001Z-DUP-aaaaaaaa" (23 chars).
//
// MySQL 8.0+ — generated columns of this shape are an 8.0 feature.
// =============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex) {
  if (!(await knex.schema.hasTable("employee_payroll_profiles"))) return;

  // Step 1 — drop the unique index if it landed somehow. Defensive: this
  // is a no-op on first run, but if a previous attempt got past the
  // column step and stalled at the index step (or vice-versa) we don't
  // want orphaned constraints stopping the rebuild.
  await knex
    .raw("DROP INDEX idx_emp_payroll_profiles_org_pan_uniq ON employee_payroll_profiles")
    .catch(() => {
      /* index didn't exist */
    });

  // Step 2 — drop the pan_number column if it exists. We always rebuild
  // because the GENERATED expression itself is what we want to control.
  // ALTER TABLE … MODIFY COLUMN can't reliably swap a STORED GENERATED
  // expression across MySQL versions — drop+add is portable.
  if (await knex.schema.hasColumn("employee_payroll_profiles", "pan_number")) {
    await knex.raw("ALTER TABLE employee_payroll_profiles DROP COLUMN pan_number");
  }

  // Step 3 — re-create the column. The expression has to map every shape
  // of "no PAN" to SQL NULL so the unique index doesn't see them as
  // duplicates. We've now seen three failure modes in production:
  //   - JSON null  → JSON_UNQUOTE returns the string 'null'
  //   - ""         → JSON_UNQUOTE returns the empty string
  //   - "   "      → whitespace-only entries from CSV imports
  // CASE handles all of them and leaves real PAN values untouched.
  // NULLIF(TRIM(...), '') folded into the single CASE for readability.
  await knex.raw(`
    ALTER TABLE employee_payroll_profiles
    ADD COLUMN pan_number VARCHAR(32)
    GENERATED ALWAYS AS (
      CASE
        WHEN JSON_EXTRACT(tax_info, '$.pan') IS NULL THEN NULL
        WHEN JSON_TYPE(JSON_EXTRACT(tax_info, '$.pan')) = 'NULL' THEN NULL
        WHEN TRIM(JSON_UNQUOTE(JSON_EXTRACT(tax_info, '$.pan'))) = '' THEN NULL
        WHEN TRIM(JSON_UNQUOTE(JSON_EXTRACT(tax_info, '$.pan'))) IN ('null', 'NULL', 'Null') THEN NULL
        ELSE TRIM(JSON_UNQUOTE(JSON_EXTRACT(tax_info, '$.pan')))
      END
    ) STORED
  `);

  // Step 4 — add the unique index. Multiple SQL NULLs are permitted —
  // employees who haven't entered a PAN don't collide; they go through
  // the Section 206AA branch in the tax engine.
  await knex.raw(`
    CREATE UNIQUE INDEX idx_emp_payroll_profiles_org_pan_uniq
      ON employee_payroll_profiles (empcloud_org_id, pan_number)
  `);
}

export async function down(knex: Knex) {
  if (!(await knex.schema.hasTable("employee_payroll_profiles"))) return;

  // Index must be dropped before the generated column it references.
  await knex
    .raw("DROP INDEX idx_emp_payroll_profiles_org_pan_uniq ON employee_payroll_profiles")
    .catch(() => {});

  if (await knex.schema.hasColumn("employee_payroll_profiles", "pan_number")) {
    await knex.raw("ALTER TABLE employee_payroll_profiles DROP COLUMN pan_number");
  }
}
