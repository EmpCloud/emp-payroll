// ============================================================================
// EMP-EXIT DATABASE CONNECTION
//
// Read-only connection to the emp-exit module's database. Payroll uses this
// as the source of truth for an employee's last_working_date, because
// EmpCloud's users.date_of_exit comes through a webhook that previously
// fell back to "today" whenever the payload was missing the date — leaving
// EmpCloud with a wrong date and payroll over-paying final-month payslips.
//
// We never WRITE to empexit-db from here. It's strictly a lookup.
// ============================================================================

import knex from "knex";
import type { Knex } from "knex";
import { config } from "../config";
import { logger } from "../utils/logger";

let empexitDb: Knex | null = null;
let empexitEnabled = false;

/**
 * Initialize the emp-exit database connection. Safe to call at startup even
 * when the integration is disabled — it becomes a no-op so the rest of the
 * server boots normally.
 *
 * Returns the Knex instance when enabled+connected; null otherwise.
 */
export async function initEmpExitDB(): Promise<Knex | null> {
  if (empexitDb) return empexitDb;
  if (!config.empexitDb.enabled) {
    logger.info("emp-exit DB integration disabled (EMPEXIT_DB_ENABLED=false)");
    return null;
  }

  const c = config.empexitDb;
  try {
    empexitDb = knex({
      client: "mysql2",
      connection: {
        host: c.host,
        port: c.port,
        user: c.user,
        password: c.password,
        database: c.name,
      },
      pool: { min: 1, max: 5 },
    });
    await empexitDb.raw("SELECT 1");
    empexitEnabled = true;
    logger.info(`emp-exit database connected (${c.host}:${c.port}/${c.name})`);
    return empexitDb;
  } catch (err: any) {
    // Don't crash the whole payroll server if emp-exit is unreachable —
    // the integration just degrades to the legacy users.date_of_exit path.
    logger.warn(
      `emp-exit database init failed (${c.host}:${c.port}/${c.name}): ${err?.message || err}. ` +
        "Falling back to empcloud.users.date_of_exit for exit lookups.",
    );
    empexitDb = null;
    empexitEnabled = false;
    return null;
  }
}

export function getEmpExitDB(): Knex | null {
  return empexitDb;
}

export function isEmpExitEnabled(): boolean {
  return empexitEnabled;
}

export async function closeEmpExitDB(): Promise<void> {
  if (empexitDb) {
    await empexitDb.destroy();
    empexitDb = null;
    empexitEnabled = false;
  }
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export interface EffectiveExitRecord {
  exitRequestId: string;
  status: string;
  lastWorkingDate: string | null; // YYYY-MM-DD
  resignationDate: string | null;
  actualExitDate: string | null;
}

const TERMINAL_EXIT_STATUSES = new Set([
  "initiated",
  "approved",
  "in_progress",
  "completed",
  "exited",
]);

/**
 * Return the effective exit record for an EmpCloud user_id. We pick the
 * most recent NON-cancelled / NON-revoked / NON-draft request so a
 * mis-entered exit that was later cancelled doesn't shadow the real one.
 *
 * Returns null when:
 *  - the integration is disabled / failed to connect,
 *  - no exit request exists for the user, or
 *  - the only request(s) are cancelled / revoked / draft.
 */
export async function findEffectiveExitForUser(
  empcloudUserId: number,
): Promise<EffectiveExitRecord | null> {
  const db = empexitDb;
  if (!db) return null;
  try {
    const row = await db("exit_requests")
      .where("employee_id", empcloudUserId)
      .whereIn("status", Array.from(TERMINAL_EXIT_STATUSES))
      .orderByRaw("COALESCE(last_working_date, actual_exit_date, resignation_date) DESC")
      .orderBy("updated_at", "desc")
      .first();
    if (!row) return null;

    const toIso = (v: unknown): string | null => {
      if (!v) return null;
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      const s = String(v);
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    };

    return {
      exitRequestId: String(row.id),
      status: String(row.status),
      lastWorkingDate: toIso(row.last_working_date),
      resignationDate: toIso(row.resignation_date),
      actualExitDate: toIso(row.actual_exit_date),
    };
  } catch (err: any) {
    // Schema drift / table missing — degrade gracefully.
    logger.warn(`findEffectiveExitForUser(${empcloudUserId}) failed: ${err?.message || err}`);
    return null;
  }
}

/**
 * Bulk variant: returns a map { userId -> EffectiveExitRecord } for the
 * given user ids. Used by computePayroll so we make one query per run
 * instead of one per employee. Skips cancelled/revoked/draft requests.
 */
export async function findEffectiveExitsForUsers(
  empcloudUserIds: number[],
): Promise<Map<number, EffectiveExitRecord>> {
  const result = new Map<number, EffectiveExitRecord>();
  const db = empexitDb;
  if (!db || empcloudUserIds.length === 0) return result;
  try {
    const rows = await db("exit_requests")
      .whereIn("employee_id", empcloudUserIds)
      .whereIn("status", Array.from(TERMINAL_EXIT_STATUSES))
      .orderByRaw("COALESCE(last_working_date, actual_exit_date, resignation_date) DESC")
      .orderBy("updated_at", "desc")
      .select(
        "id",
        "employee_id",
        "status",
        "last_working_date",
        "resignation_date",
        "actual_exit_date",
      );
    const toIso = (v: unknown): string | null => {
      if (!v) return null;
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      const s = String(v);
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    };
    for (const row of rows) {
      const uid = Number(row.employee_id);
      // First row per user wins (already ordered by most-recent date).
      if (result.has(uid)) continue;
      result.set(uid, {
        exitRequestId: String(row.id),
        status: String(row.status),
        lastWorkingDate: toIso(row.last_working_date),
        resignationDate: toIso(row.resignation_date),
        actualExitDate: toIso(row.actual_exit_date),
      });
    }
  } catch (err: any) {
    logger.warn(`findEffectiveExitsForUsers failed: ${err?.message || err}`);
  }
  return result;
}
