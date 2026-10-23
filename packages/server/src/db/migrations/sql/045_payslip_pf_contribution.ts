import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn("payslips", "pf_contribution"))) {
    await knex.schema.alterTable("payslips", (table) => {
      // Keep historical payroll intact; only newly computed runs capture the PF basis.
      table.jsonb("pf_contribution").nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn("payslips", "pf_contribution")) {
    await knex.schema.alterTable("payslips", (table) => {
      table.dropColumn("pf_contribution");
    });
  }
}
