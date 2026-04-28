// =============================================================================
// MIGRATION 028 — Mark obviously-bad existing payslips as 'disputed'
//
// Reported as #268: production payslips show Gross ₹0 and a hugely
// negative Net Pay (deductions applied against an empty earnings base).
// PR #288 added a runtime guard so future runs refuse to generate
// payslips when the salary structure is empty, but historical rows
// already in the table are unaffected — admins still see them in
// dashboards, the YTD aggregator (PR #289) still pulls them in, and
// employees still receive nonsense slips.
//
// This migration sweeps the existing data: any payslip with
// gross_earnings <= 0 AND a non-zero total_deductions is flipped to
// status='disputed' so:
//   - the Payslips list visibly tags them for HR review,
//   - the YTD aggregator (which filters on status IN ('processed',
//     'paid')) excludes them automatically,
//   - the rows survive for audit / forensic purposes — we don't
//     delete history.
//
// Idempotent — re-running on a clean dataset matches no rows.
//
// Logged loudly so the operator running the migration sees exactly
// what got flipped and can spot unexpected matches before pushing
// further work.
// =============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("payslips"))) return;

  // Find candidates first so we can log + count before the UPDATE.
  // The condition: gross was 0 (or somehow negative) yet deductions
  // STILL fired — the exact shape the negative-net-pay bug produces.
  // Skip rows already marked 'disputed' so re-runs are no-ops.
  const candidates: Array<{
    id: string;
    employee_id: string;
    payroll_run_id: string;
    gross_earnings: string | number;
    net_pay: string | number;
    status: string;
  }> = await knex("payslips")
    .where("gross_earnings", "<=", 0)
    .andWhere("total_deductions", ">", 0)
    .andWhereNot("status", "disputed")
    .select("id", "employee_id", "payroll_run_id", "gross_earnings", "net_pay", "status");

  if (candidates.length === 0) return;

  for (const row of candidates) {
    // eslint-disable-next-line no-console
    console.warn(
      `[migration 028] Flipping bad payslip id=${row.id} run=${row.payroll_run_id} ` +
        `employee=${row.employee_id} gross=${row.gross_earnings} net=${row.net_pay} ` +
        `(was status='${row.status}')`,
    );
  }

  await knex("payslips")
    .whereIn(
      "id",
      candidates.map((r) => r.id),
    )
    .update({ status: "disputed", updated_at: new Date() });
}

export async function down(_knex: Knex): Promise<void> {
  // No-op. Restoring nonsense data to a 'processed' state would put
  // the YTD aggregator back into a broken state and re-show nonsense
  // in the UI. If a row was wrongly flipped, the operator can edit
  // its status by hand.
}
