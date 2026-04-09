import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("bank_update_requests"))) {
    await knex.schema.createTable("bank_update_requests", (t) => {
      t.uuid("id").primary();
      t.bigInteger("empcloud_user_id").unsigned().notNullable();
      t.bigInteger("empcloud_org_id").unsigned().notNullable();
      t.jsonb("current_details").notNullable(); // snapshot of current bank details
      t.jsonb("requested_details").notNullable(); // new bank details requested
      t.string("reason", 500).nullable();
      t.string("status", 20).notNullable().defaultTo("pending"); // pending, approved, rejected
      t.bigInteger("reviewed_by").unsigned().nullable();
      t.text("review_remarks").nullable();
      t.datetime("reviewed_at").nullable();
      t.timestamps(true, true);

      t.index(["empcloud_org_id", "status"]);
      t.index(["empcloud_user_id", "status"]);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("bank_update_requests");
}
