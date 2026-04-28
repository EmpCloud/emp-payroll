// =============================================================================
// MIGRATION 025 — Clean up duplicate / invalid PAN values
//
// Tenants in production hit two PAN-data problems documented as
// EmpCloud/EmpCloud#1656 and #1657:
//   - Multiple employees in the same org sharing the same PAN
//     (BLAPH256H × 3 in one report).
//   - PAN values that don't match the Indian format [A-Z]{5}[0-9]{4}[A-Z]
//     (e.g. "xgfx234bh", "jskcs5453t").
//
// A follow-up migration will denormalize `tax_info.pan` to a top-level
// `pan_number` column with UNIQUE(empcloud_org_id, pan_number) plus a
// CHECK on the regex; that migration cannot succeed against the current
// dirty data. This prerequisite cleans the dataset:
//
//   - PANs that don't match the regex are cleared to null. Admins must
//     re-enter the correct value; we don't try to "auto-fix" garbage.
//   - Duplicate PANs within an org keep the oldest row (by created_at);
//     newer rows get their pan suffixed with "-DUP-<short-uuid>" so an
//     admin sees the row, recognises it as a collision, and corrects it.
//
// Idempotent: re-running this against an already-clean dataset matches
// no rows and is a no-op.
// =============================================================================

import type { Knex } from "knex";

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

type ProfileRow = {
  id: string;
  empcloud_org_id: number;
  tax_info: unknown;
  created_at: Date | string;
};

function parseTaxInfo(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === "object" ? v : {};
    } catch {
      return {};
    }
  }
  return {};
}

export async function up(knex: Knex) {
  if (!(await knex.schema.hasTable("employee_payroll_profiles"))) return;

  const rows: ProfileRow[] = await knex("employee_payroll_profiles")
    .whereNotNull("tax_info")
    .select("id", "empcloud_org_id", "tax_info", "created_at");
  if (rows.length === 0) return;

  // Parse once up front so we don't re-parse on every comparison.
  type Parsed = {
    id: string;
    empcloud_org_id: number;
    created_at: Date | string;
    tax_info: Record<string, unknown>;
    pan: string | null;
  };
  const parsed: Parsed[] = rows.map((r) => {
    const ti = parseTaxInfo(r.tax_info);
    const pan = typeof ti.pan === "string" ? (ti.pan as string).trim() : null;
    return {
      id: r.id,
      empcloud_org_id: r.empcloud_org_id,
      created_at: r.created_at,
      tax_info: ti,
      pan: pan || null,
    };
  });

  // Pass 1 — clear invalid-format PANs (anything non-empty that doesn't
  // match the Indian regex). Empty / null pan is left alone.
  for (const row of parsed) {
    if (row.pan && !PAN_RE.test(row.pan)) {
      const next = { ...row.tax_info, pan: null };
      await knex("employee_payroll_profiles")
        .where({ id: row.id })
        .update({ tax_info: JSON.stringify(next), updated_at: new Date() });
      row.tax_info = next;
      row.pan = null;
    }
  }

  // Pass 2 — dedupe valid PANs per org. Keep the oldest by created_at,
  // suffix the rest. Only valid (regex-passing) PANs are considered, so
  // we don't waste work on rows already nulled in pass 1.
  const groups = new Map<string, Parsed[]>();
  for (const row of parsed) {
    if (!row.pan) continue;
    const key = `${row.empcloud_org_id}|${row.pan}`;
    const arr = groups.get(key);
    if (arr) arr.push(row);
    else groups.set(key, [row]);
  }

  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    // arr[0] keeps the original PAN; suffix the rest.
    for (let i = 1; i < arr.length; i++) {
      const dup = arr[i];
      const shortId = dup.id.slice(0, 8);
      const newPan = `${dup.pan}-DUP-${shortId}`;
      const next = { ...dup.tax_info, pan: newPan };
      await knex("employee_payroll_profiles")
        .where({ id: dup.id })
        .update({ tax_info: JSON.stringify(next), updated_at: new Date() });
    }
  }
}

export async function down(_knex: Knex) {
  // One-way data fix. Restoring duplicates / invalid PANs would
  // reintroduce the bug. No-op so the migration registry stays
  // consistent if someone migrates down.
}
