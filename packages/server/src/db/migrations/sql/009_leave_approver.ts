import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("leave_requests", (t) => {
    t.uuid("assigned_to").nullable().references("id").inTable("employees");
  });

  // Populate assigned_to from the employee's current reporting_manager_id
  await knex.raw(`
    UPDATE leave_requests lr
    JOIN employees e ON lr.employee_id = e.id
    SET lr.assigned_to = e.reporting_manager_id
    WHERE e.reporting_manager_id IS NOT NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("leave_requests", (t) => {
    t.dropColumn("assigned_to");
  });
}
