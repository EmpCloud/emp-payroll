import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("loans", (t) => {
    t.uuid("id").primary();
    t.uuid("employee_id").notNullable().references("id").inTable("employees").onDelete("CASCADE");
    t.uuid("org_id").notNullable().references("id").inTable("organizations").onDelete("CASCADE");
    t.string("type", 30).notNullable(); // salary_advance, loan, emergency
    t.string("description", 255).notNullable();
    t.decimal("principal_amount", 15, 2).notNullable();
    t.decimal("outstanding_amount", 15, 2).notNullable();
    t.integer("tenure_months").notNullable();
    t.decimal("emi_amount", 15, 2).notNullable();
    t.decimal("interest_rate", 5, 2).defaultTo(0);
    t.string("status", 20).defaultTo("active"); // active, completed, cancelled
    t.date("start_date").notNullable();
    t.date("end_date").nullable();
    t.integer("installments_paid").defaultTo(0);
    t.uuid("approved_by").nullable().references("id").inTable("employees");
    t.timestamp("approved_at").nullable();
    t.text("notes").nullable();
    t.timestamps(true, true);

    t.index(["employee_id", "status"]);
    t.index(["org_id", "status"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("loans");
}
