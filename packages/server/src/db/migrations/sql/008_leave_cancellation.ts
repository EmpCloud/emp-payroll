import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("leave_requests", (t) => {
    t.text("cancellation_reason").nullable();
    t.timestamp("cancellation_requested_at").nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("leave_requests", (t) => {
    t.dropColumn("cancellation_reason");
    t.dropColumn("cancellation_requested_at");
  });
}
