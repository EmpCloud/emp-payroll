import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("employee_notes", (t) => {
    t.uuid("id").primary();
    t.uuid("org_id").notNullable().references("id").inTable("organizations");
    t.uuid("employee_id").notNullable().references("id").inTable("employees");
    t.uuid("author_id").notNullable().references("id").inTable("employees");
    t.text("content").notNullable();
    t.string("category", 50).defaultTo("general"); // general, performance, hr, finance
    t.boolean("is_private").defaultTo(false);
    t.timestamps(true, true);
  });

  await knex.schema.createTable("employee_documents", (t) => {
    t.uuid("id").primary();
    t.uuid("org_id").notNullable().references("id").inTable("organizations");
    t.uuid("employee_id").notNullable().references("id").inTable("employees");
    t.string("name", 255).notNullable();
    t.string("type", 50).notNullable(); // aadhaar, pan, offer_letter, payslip, other
    t.string("file_url", 500).nullable();
    t.string("mime_type", 100).nullable();
    t.date("expiry_date").nullable();
    t.boolean("is_verified").defaultTo(false);
    t.uuid("uploaded_by").notNullable().references("id").inTable("employees");
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("employee_documents");
  await knex.schema.dropTableIfExists("employee_notes");
}
