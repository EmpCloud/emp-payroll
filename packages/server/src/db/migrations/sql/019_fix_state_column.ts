import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("organization_payroll_settings", (t) => {
    t.string("state", 100).nullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("organization_payroll_settings", (t) => {
    t.string("state", 5).nullable().alter();
  });
}
