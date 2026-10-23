import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const columns: Record<string, string[]> = {
    global_employees: ["uae_profile", "uae_profile_history"],
    global_payroll_runs: ["uae_inputs", "uae_employer", "uae_schedule"],
    employee_exits: ["uae_settlement"],
    global_payroll_items: [
      "uae_profile",
      "uae_calculation",
      "uae_input",
      "uae_employee",
      "uae_payment",
    ],
  };
  for (const [table, names] of Object.entries(columns)) {
    for (const name of names) {
      if (!(await knex.schema.hasColumn(table, name)))
        await knex.schema.alterTable(table, (t) => t.json(name).nullable());
    }
  }
  if (!(await knex.schema.hasColumn("global_payroll_runs", "uae_period_key"))) {
    await knex.schema.alterTable("global_payroll_runs", (t) => {
      t.string("uae_period_key", 120).nullable().unique();
      t.integer("uae_revision").notNullable().defaultTo(0);
    });
  }
  if (!(await knex.schema.hasColumn("global_payroll_items", "updated_at"))) {
    await knex.schema.alterTable("global_payroll_items", (t) =>
      t.timestamp("updated_at").defaultTo(knex.fn.now()),
    );
  }
  if (!(await knex.schema.hasColumn("global_payroll_items", "uae_empcloud_user_id"))) {
    await knex.schema.alterTable("global_payroll_items", (t) => {
      t.bigInteger("uae_empcloud_user_id").unsigned().nullable();
      t.index(["empcloud_org_id", "uae_empcloud_user_id"], "uae_payslip_owner_idx");
    });
  }
  if (!(await knex.schema.hasTable("uae_payroll_events"))) {
    await knex.schema.createTable("uae_payroll_events", (t) => {
      t.uuid("id").primary();
      t.bigInteger("empcloud_org_id").unsigned().notNullable();
      t.uuid("payroll_run_id").notNullable();
      t.string("kind", 40).notNullable();
      t.string("actor_id", 100).notNullable();
      t.json("payload").notNullable();
      t.timestamps(true, true);
      t.index(["empcloud_org_id", "payroll_run_id"]);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("uae_payroll_events");
  for (const [table, names] of Object.entries({
    global_employees: ["uae_profile", "uae_profile_history"],
    global_payroll_runs: [
      "uae_inputs",
      "uae_employer",
      "uae_schedule",
      "uae_period_key",
      "uae_revision",
    ],
    employee_exits: ["uae_settlement"],
    global_payroll_items: [
      "uae_profile",
      "uae_calculation",
      "uae_input",
      "uae_employee",
      "uae_payment",
      "uae_empcloud_user_id",
    ],
  })) {
    for (const name of names)
      if (await knex.schema.hasColumn(table, name))
        await knex.schema.alterTable(table, (t) => t.dropColumn(name));
  }
}
