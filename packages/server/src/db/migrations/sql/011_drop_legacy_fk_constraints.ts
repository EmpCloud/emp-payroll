// ============================================================================
// MIGRATION: Drop legacy FK constraints that reference the old organizations
// and employees tables. These columns now use empcloud_org_id / empcloud_user_id
// for lookups. The old UUID columns are kept for backward compat but the FK
// constraints must be removed since data now lives in the EmpCloud database.
// ============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Helper: drop FK if it exists (MySQL-specific)
  async function dropFK(table: string, constraint: string) {
    const [rows] = (await knex.raw(
      `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
      [table, constraint],
    )) as any;
    if (rows && rows.length > 0) {
      await knex.schema.alterTable(table, (t) => {
        t.dropForeign([], constraint);
      });
    }
  }

  // Drop ALL FK constraints that reference old organizations/employees tables.
  // Gather every FK in the database pointing to `organizations` or `employees`.
  const [fkRows] = (await knex.raw(
    `SELECT TABLE_NAME, CONSTRAINT_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE()
       AND (REFERENCED_TABLE_NAME = 'organizations' OR REFERENCED_TABLE_NAME = 'employees')
       AND REFERENCED_TABLE_NAME IS NOT NULL`,
  )) as any;

  for (const row of fkRows || []) {
    try {
      await knex.schema.alterTable(row.TABLE_NAME, (t) => {
        t.dropForeign([], row.CONSTRAINT_NAME);
      });
    } catch {
      // FK may already be dropped — skip
    }
  }

  // Make the old UUID columns nullable so they don't block inserts
  const columnsToNullify: [string, string][] = [
    ["payroll_runs", "org_id"],
    ["salary_structures", "org_id"],
    ["employee_salaries", "employee_id"],
    ["payslips", "employee_id"],
    ["attendance_summaries", "employee_id"],
  ];

  for (const [table, col] of columnsToNullify) {
    const hasCol = await knex.schema.hasColumn(table, col);
    if (hasCol) {
      await knex.raw(`ALTER TABLE \`${table}\` MODIFY \`${col}\` varchar(36) NULL`);
    }
  }

  // Make employee_notes org_id and employee_id nullable
  if (await knex.schema.hasTable("employee_notes")) {
    const hasOrgId = await knex.schema.hasColumn("employee_notes", "org_id");
    if (hasOrgId) {
      await knex.raw("ALTER TABLE `employee_notes` MODIFY `org_id` varchar(36) NULL");
    }
    const hasEmpId = await knex.schema.hasColumn("employee_notes", "employee_id");
    if (hasEmpId) {
      await knex.raw("ALTER TABLE `employee_notes` MODIFY `employee_id` varchar(36) NULL");
    }
  }
}

export async function down(_knex: Knex): Promise<void> {
  // Reversing FK drops is complex — skip for now
}
