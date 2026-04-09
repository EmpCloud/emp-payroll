import type { Knex } from "knex";

export async function up(knex: Knex) {
  const hasTable = await knex.schema.hasTable("employee_exits");
  if (hasTable) return;

  await knex.schema.createTable("employee_exits", (t) => {
    t.uuid("id").primary();
    t.integer("org_id").unsigned().notNullable();
    t.integer("employee_id").unsigned().notNullable();
    t.enum("exit_type", [
      "resignation",
      "termination",
      "retirement",
      "end_of_contract",
      "mutual_separation",
    ]).notNullable();
    t.date("resignation_date").nullable();
    t.date("last_working_date").nullable();
    t.string("reason", 500).nullable();
    t.text("exit_interview_notes").nullable();
    t.enum("status", [
      "initiated",
      "in_progress",
      "fnf_pending",
      "fnf_processed",
      "completed",
      "cancelled",
    ]).defaultTo("initiated");
    // Checklist tracking
    t.boolean("notice_served").defaultTo(false);
    t.boolean("handover_complete").defaultTo(false);
    t.boolean("assets_returned").defaultTo(false);
    t.boolean("access_revoked").defaultTo(false);
    t.boolean("fnf_calculated").defaultTo(false);
    t.boolean("fnf_paid").defaultTo(false);
    t.boolean("experience_letter_issued").defaultTo(false);
    t.boolean("relieving_letter_issued").defaultTo(false);
    // FnF details
    t.decimal("pending_salary", 12, 2).defaultTo(0);
    t.decimal("leave_encashment", 12, 2).defaultTo(0);
    t.decimal("gratuity", 12, 2).defaultTo(0);
    t.decimal("bonus_due", 12, 2).defaultTo(0);
    t.decimal("deductions", 12, 2).defaultTo(0);
    t.decimal("fnf_total", 12, 2).defaultTo(0);
    t.integer("initiated_by").unsigned().nullable();
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex) {
  await knex.schema.dropTableIfExists("employee_exits");
}
