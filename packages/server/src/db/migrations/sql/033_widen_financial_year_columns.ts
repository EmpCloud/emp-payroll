// =============================================================================
// MIGRATION 033 — Widen tax_declarations.financial_year + tax_computations.financial_year
// -----------------------------------------------------------------------------
// The original schema (001_initial_schema) sized the `financial_year` column
// at VARCHAR(7) so it could fit the short Indian FY shape "2026-27". The
// rest of the codebase (frontend MyDeclarationsPage, the tax engine
// currentFY(), Form-16 service, the API tests) however emit the long
// "2026-2027" form -- 9 chars, two too wide for the column.
//
// On MariaDB / MySQL with the default strict mode this overflows with
// ER_DATA_TOO_LONG, which surfaces to the user as a generic "Failed to
// submit declaration" toast (#372). On older non-strict deployments the
// value silently truncates to "2026-20", which then fails to match the
// FY filter used by getDeclarations / computeTax and the declaration
// disappears from the read path.
//
// Widen both columns to VARCHAR(10) -- mirrors leave_balances.financial_year
// which already used the wider definition. No data migration needed; the
// existing values fit untouched. Safe to re-run because we check the
// current type before altering.
// =============================================================================

import type { Knex } from "knex";

const TARGET_TABLES = ["tax_declarations", "tax_computations"] as const;

async function columnLength(knex: Knex, table: string, column: string): Promise<number | null> {
  // information_schema is portable across MySQL / MariaDB / PostgreSQL.
  // Fall through gracefully on dialects that don't expose CHARACTER_MAXIMUM_LENGTH.
  try {
    const [rows] = (await knex.raw(
      `SELECT CHARACTER_MAXIMUM_LENGTH AS len
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    )) as any;
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (row && row.len != null) return Number(row.len);
    return null;
  } catch {
    return null;
  }
}

export async function up(knex: Knex): Promise<void> {
  for (const table of TARGET_TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (!(await knex.schema.hasColumn(table, "financial_year"))) continue;
    const len = await columnLength(knex, table, "financial_year");
    // Already wide enough — nothing to do.
    if (len != null && len >= 10) continue;
    // MODIFY COLUMN is idempotent and preserves data; safe even when len
    // is unknown (PostgreSQL etc.) because the resulting type is still
    // compatible with everything that fits in the previous size.
    await knex.raw(`ALTER TABLE \`${table}\` MODIFY \`financial_year\` VARCHAR(10) NOT NULL`);
  }
}

export async function down(knex: Knex): Promise<void> {
  // Narrowing back risks data truncation on rows that legitimately stored
  // the long "2026-2027" form. Keep the column at VARCHAR(10) on rollback;
  // the wider type is a strict superset of the old one.
  return;
}
