import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const hasLockDate = await knex.schema.hasColumn("organizations", "payroll_lock_date");
  if (!hasLockDate) {
    await knex.schema.alterTable("organizations", (t) => {
      t.date("payroll_lock_date").nullable(); // Payroll data before this date is locked
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("organizations", (t) => {
    t.dropColumn("payroll_lock_date");
  });
}
