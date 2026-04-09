import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Ad-hoc payroll adjustments (bonuses, arrears, incentives, deductions)
  await knex.schema.createTable("payroll_adjustments", (t) => {
    t.uuid("id").primary();
    t.uuid("org_id").notNullable().references("id").inTable("organizations");
    t.uuid("employee_id").notNullable().references("id").inTable("employees");
    t.uuid("payroll_run_id").nullable().references("id").inTable("payroll_runs");
    t.string("type", 30).notNullable(); // bonus, incentive, arrear, deduction, reimbursement
    t.string("description", 255).notNullable();
    t.decimal("amount", 12, 2).notNullable();
    t.boolean("is_taxable").defaultTo(true);
    t.boolean("is_recurring").defaultTo(false);
    t.integer("recurring_months").nullable();
    t.string("status", 20).defaultTo("pending"); // pending, applied, cancelled
    t.date("effective_month").nullable(); // which payroll month this applies to
    t.uuid("created_by").notNullable().references("id").inTable("employees");
    t.timestamps(true, true);
  });

  // Add proof_url column to tax_declarations if not exists
  const hasProofUrl = await knex.schema.hasColumn("tax_declarations", "proof_url");
  if (!hasProofUrl) {
    await knex.schema.alterTable("tax_declarations", (t) => {
      t.string("proof_url", 500).nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("payroll_adjustments");
}
