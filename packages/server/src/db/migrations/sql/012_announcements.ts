import { Knex } from "knex";

export async function up(knex: Knex) {
  const hasTable = await knex.schema.hasTable("announcements");
  if (hasTable) return;

  await knex.schema.createTable("announcements", (t) => {
    t.uuid("id").primary();
    t.integer("org_id").unsigned().notNullable();
    t.string("title", 255).notNullable();
    t.text("content").notNullable();
    t.enum("priority", ["low", "normal", "high", "urgent"]).defaultTo("normal");
    t.enum("category", ["general", "hr", "policy", "event", "holiday", "maintenance"]).defaultTo(
      "general",
    );
    t.integer("author_id").unsigned().notNullable();
    t.boolean("is_pinned").defaultTo(false);
    t.boolean("is_active").defaultTo(true);
    t.datetime("publish_at").nullable();
    t.datetime("expires_at").nullable();
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex) {
  await knex.schema.dropTableIfExists("announcements");
}
