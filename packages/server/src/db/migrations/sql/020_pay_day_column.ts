import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const hasCol = await knex.schema.hasColumn("organization_payroll_settings", "pay_day");
  if (!hasCol) {
    await knex.schema.alterTable("organization_payroll_settings", (t) => {
      // Day of month when salary is paid (1-28). Default: 7th of each month.
      t.integer("pay_day").notNullable().defaultTo(7);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasCol = await knex.schema.hasColumn("organization_payroll_settings", "pay_day");
  if (hasCol) {
    await knex.schema.alterTable("organization_payroll_settings", (t) => {
      t.dropColumn("pay_day");
    });
  }
}
