import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("leave_requests", (t) => {
    t.uuid("id").primary().defaultTo(knex.fn.uuid());
    t.uuid("employee_id").notNullable().references("id").inTable("employees").onDelete("CASCADE");
    t.uuid("org_id").notNullable().references("id").inTable("organizations").onDelete("CASCADE");
    t.string("leave_type", 30).notNullable(); // earned, casual, sick, privilege, maternity, paternity, comp_off
    t.date("start_date").notNullable();
    t.date("end_date").notNullable();
    t.decimal("days", 5, 1).notNullable();
    t.boolean("is_half_day").defaultTo(false);
    t.enum("half_day_period", ["first_half", "second_half"]).nullable();
    t.text("reason").notNullable();
    t.enum("status", ["pending", "approved", "rejected", "cancelled"]).defaultTo("pending");
    t.uuid("approved_by").nullable().references("id").inTable("employees");
    t.text("approver_remarks").nullable();
    t.timestamp("approved_at").nullable();
    t.timestamps(true, true);
    t.index(["employee_id", "status"]);
    t.index(["org_id", "status"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("leave_requests");
}
