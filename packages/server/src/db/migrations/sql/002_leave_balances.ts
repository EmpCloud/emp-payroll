import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("leave_balances", (t) => {
    t.uuid("id").primary();
    t.uuid("employee_id").notNullable().references("id").inTable("employees").onDelete("CASCADE");
    t.string("leave_type", 30).notNullable(); // earned, casual, sick, privilege, maternity, paternity
    t.string("financial_year", 7).notNullable();
    t.decimal("opening_balance", 5, 1).defaultTo(0);
    t.decimal("accrued", 5, 1).defaultTo(0);
    t.decimal("used", 5, 1).defaultTo(0);
    t.decimal("lapsed", 5, 1).defaultTo(0);
    t.decimal("closing_balance", 5, 1).defaultTo(0);
    t.timestamps(true, true);

    t.unique(["employee_id", "leave_type", "financial_year"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("leave_balances");
}
