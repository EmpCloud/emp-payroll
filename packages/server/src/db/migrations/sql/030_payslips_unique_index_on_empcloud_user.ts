// =============================================================================
// MIGRATION 030 — Fix payslips unique index
// -----------------------------------------------------------------------------
// The original payslips table inherited a UNIQUE (payroll_run_id, employee_id)
// constraint from the pre-EmpCloud schema. After the EmpCloud migration the
// `employee_id` column became a legacy / nullable placeholder and
// computePayroll inserts every row with the dummy UUID
// "00000000-0000-0000-0000-000000000000" -- so the second employee in any
// run hits a duplicate-key violation and the entire compute aborts. Net
// effect today: every payroll run has at most ONE payslip regardless of
// headcount.
//
// Switch the unique key to the correct semantic identifier:
//   (payroll_run_id, empcloud_user_id) -- one payslip per employee per run.
//
// Defensive: only swap the index if both the old key exists and adding the
// new one would not collide on existing data (caller is responsible for
// running the no-collisions check before deploying this migration).
// =============================================================================

import type { Knex } from "knex";

const OLD_INDEX = "payslips_payroll_run_id_employee_id_unique";
const NEW_INDEX = "payslips_payroll_run_id_empcloud_user_id_unique";

async function indexExists(knex: Knex, name: string): Promise<boolean> {
  const rows = (await knex.raw(`SHOW INDEX FROM payslips WHERE Key_name = ?`, [name])) as any;
  return Array.isArray(rows?.[0]) ? rows[0].length > 0 : Array.isArray(rows) && rows.length > 0;
}

export async function up(knex: Knex): Promise<void> {
  // Order matters: the existing FK payslips.payroll_run_id -> payroll_runs.id
  // is supported by the first column of OLD_INDEX. MySQL refuses to drop
  // that index until another one covers `payroll_run_id` as a leading
  // column. NEW_INDEX (payroll_run_id, empcloud_user_id) does cover it,
  // so add the new index first, then drop the old one.
  if (!(await indexExists(knex, NEW_INDEX))) {
    await knex.schema.alterTable("payslips", (t) => {
      t.unique(["payroll_run_id", "empcloud_user_id"], { indexName: NEW_INDEX });
    });
  }
  if (await indexExists(knex, OLD_INDEX)) {
    await knex.schema.alterTable("payslips", (t) => {
      t.dropUnique(["payroll_run_id", "employee_id"], OLD_INDEX);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  // Reverse: re-add the old index (still covers payroll_run_id leading)
  // before dropping the new one, for the same FK reason.
  if (!(await indexExists(knex, OLD_INDEX))) {
    await knex.schema.alterTable("payslips", (t) => {
      t.unique(["payroll_run_id", "employee_id"], { indexName: OLD_INDEX });
    });
  }
  if (await indexExists(knex, NEW_INDEX)) {
    await knex.schema.alterTable("payslips", (t) => {
      t.dropUnique(["payroll_run_id", "empcloud_user_id"], NEW_INDEX);
    });
  }
}
