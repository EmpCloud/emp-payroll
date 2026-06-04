// ============================================================================
// PAYOUT SERVICE — RazorpayX disbursement orchestration (Phase 1B + 2)
// ----------------------------------------------------------------------------
// Phase 1B:
//   ensureFundAccount(empcloudUserId)   — cache contact + fund_account
//   disburseRun(runId)                  — push every payslip on a run to
//                                         Razorpay as a queued payout
//   getRunPayouts(runId)                — list current state for the UI
//   retryPayout(payoutId)               — re-issue a failed payout (fresh
//                                         idempotency key)
//
// Phase 2:
//   applyWebhookEvent(payload)          — payout.* webhook handler — finds
//                                         the row by razorpay_payout_id and
//                                         updates status
//
// Per-org Razorpay clients are constructed on demand from the decrypted
// settings — never cached process-wide so a tenant rotating their key
// secret immediately invalidates outstanding clients.
// ============================================================================

import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { getDB } from "../db/adapters";
import { findUserById, getEmpCloudDB } from "../db/empcloud";
import { AppError } from "../api/middleware/error.middleware";
import { decryptSecret } from "../utils/secrets";
import { RazorpayClient } from "./razorpay.service";

const CONCURRENCY = 5;

/** Truncated, JSON-serialisable view of a Razorpay payout to persist. */
function safeResponseSnapshot(raw: any): any {
  if (!raw || typeof raw !== "object") return null;
  const slim: Record<string, any> = {};
  for (const k of [
    "id",
    "entity",
    "status",
    "mode",
    "purpose",
    "amount",
    "currency",
    "utr",
    "failure_reason",
    "created_at",
    "processed_at",
    "fund_account_id",
    "reference_id",
  ]) {
    if (raw[k] !== undefined) slim[k] = raw[k];
  }
  return slim;
}

export class PayoutService {
  private db = getDB();

  /**
   * Build a per-org Razorpay client from the encrypted-at-rest settings.
   * Throws a structured AppError when the org isn't fully configured so the
   * route handler can surface a precise 400 instead of a generic 500.
   */
  private async clientForOrg(empcloudOrgId: number): Promise<{
    client: RazorpayClient;
    accountNumber: string;
    defaultMode: string;
    settingsRowId: string;
  }> {
    const row = await this.db.findOne<any>("organization_payroll_settings", {
      empcloud_org_id: empcloudOrgId,
    });
    if (!row?.razorpay_enabled) {
      throw new AppError(
        400,
        "RAZORPAY_DISABLED",
        "Razorpay payouts are not enabled for this organization. Enable them in Settings first.",
      );
    }
    if (!row.razorpay_key_id || !row.razorpay_key_secret_enc || !row.razorpay_account_number) {
      throw new AppError(
        400,
        "RAZORPAY_INCOMPLETE",
        "Razorpay credentials are incomplete. Configure Key ID, Key Secret and Source Account Number in Settings.",
      );
    }
    let keySecret: string;
    try {
      keySecret = decryptSecret(row.razorpay_key_secret_enc);
    } catch {
      throw new AppError(
        500,
        "SECRET_DECRYPT_FAILED",
        "Could not decrypt the stored Razorpay Key Secret. Re-enter it in Settings.",
      );
    }
    return {
      client: new RazorpayClient({
        keyId: row.razorpay_key_id,
        keySecret,
        accountNumber: row.razorpay_account_number,
      }),
      accountNumber: row.razorpay_account_number,
      defaultMode: row.razorpay_default_mode || "IMPS",
      settingsRowId: row.id,
    };
  }

  /**
   * Bank-details fingerprint — the hash changes whenever HR (or the employee
   * via the bank-update flow) edits any field, so a stale fund_account never
   * gets reused after a real account change.
   */
  private fingerprintBank(bank: {
    bankName?: string;
    accountNumber?: string;
    ifscCode?: string;
  }): string {
    return crypto
      .createHash("sha256")
      .update(
        `${(bank.bankName || "").trim()}|${(bank.accountNumber || "").trim()}|${(bank.ifscCode || "").trim().toUpperCase()}`,
      )
      .digest("hex");
  }

  /**
   * Resolve (or lazy-create) the Razorpay contact + fund_account for one
   * employee. Returns the fund_account id ready to receive a payout.
   *
   * Caches on `employee_payroll_profiles`. When the bank fingerprint matches
   * the previous one, the cached fund_account id is reused. Otherwise a new
   * fund_account is created (the old one is left behind on Razorpay — they
   * have no delete API; it's just abandoned and that's fine).
   */
  async ensureFundAccount(client: RazorpayClient, empcloudUserId: number): Promise<string> {
    const profile = await this.db.findOne<any>("employee_payroll_profiles", {
      empcloud_user_id: empcloudUserId,
    });
    if (!profile) {
      throw new AppError(
        400,
        "PROFILE_MISSING",
        `Employee #${empcloudUserId} has no payroll profile.`,
      );
    }
    const bank =
      profile.bank_details && typeof profile.bank_details === "string"
        ? safeJson(profile.bank_details)
        : profile.bank_details || {};
    if (!bank?.accountNumber || !bank?.ifscCode || !bank?.bankName) {
      throw new AppError(
        400,
        "BANK_DETAILS_MISSING",
        `Employee #${empcloudUserId} is missing bank account / IFSC / bank name.`,
      );
    }
    const fp = this.fingerprintBank(bank);
    if (profile.razorpay_fund_account_id && profile.razorpay_bank_fingerprint === fp) {
      return profile.razorpay_fund_account_id;
    }

    // Need the EmpCloud user for name + contact info on Razorpay.
    const ecUser = await findUserById(empcloudUserId);
    if (!ecUser) {
      throw new AppError(400, "USER_NOT_FOUND", `Employee #${empcloudUserId} not found.`);
    }
    const fullName = `${ecUser.first_name || ""} ${ecUser.last_name || ""}`.trim() || ecUser.email;

    let contactId = profile.razorpay_contact_id;
    if (!contactId) {
      const contact = await client.createContact(
        {
          name: fullName,
          email: ecUser.email || undefined,
          contact: (ecUser as any).contact_number || undefined,
          type: "employee",
          reference_id: `emp-${empcloudUserId}`,
          notes: { empcloud_user_id: String(empcloudUserId) },
        },
        `emp-${empcloudUserId}-contact`,
      );
      contactId = contact.id;
    }

    const fund = await client.createFundAccount(
      contactId,
      {
        name: fullName,
        ifsc: String(bank.ifscCode).trim().toUpperCase(),
        account_number: String(bank.accountNumber).trim(),
      },
      `emp-${empcloudUserId}-fund-${fp.slice(0, 12)}`,
    );

    await this.db.update("employee_payroll_profiles", profile.id, {
      razorpay_contact_id: contactId,
      razorpay_fund_account_id: fund.id,
      razorpay_bank_fingerprint: fp,
    });
    return fund.id;
  }

  /**
   * Push every payslip on an approved run to Razorpay. Runs each employee
   * sequentially in a small worker pool (concurrency=CONCURRENCY) so a slow
   * Razorpay call doesn't stall the whole batch but we also don't fan-out
   * 200 concurrent requests.
   *
   * Returns a summary so the route handler can show per-employee outcomes.
   * Does NOT change the run's status — the admin still has to click Mark
   * Paid after reviewing on the RazorpayX dashboard.
   */
  async disburseRun(empcloudOrgId: number, runId: string) {
    const { client, accountNumber, defaultMode } = await this.clientForOrg(empcloudOrgId);
    const run = await this.db.findById<any>("payroll_runs", runId);
    if (!run) throw new AppError(404, "RUN_NOT_FOUND", "Payroll run not found.");
    if (run.empcloud_org_id !== empcloudOrgId) {
      throw new AppError(404, "RUN_NOT_FOUND", "Payroll run not found for this organization.");
    }
    if (!["computed", "approved"].includes(run.status)) {
      throw new AppError(
        400,
        "INVALID_RUN_STATUS",
        `Only computed/approved runs can be disbursed (current: ${run.status}).`,
      );
    }

    const payslipsRes = await this.db.findMany<any>("payslips", {
      filters: { payroll_run_id: runId },
      limit: 10000,
    });
    const payslips = payslipsRes.data;

    // Skip payslips that already have a successful payout (idempotency_key =
    // payslip.id) — gives "Disburse all" safe re-run semantics. Re-runs of
    // queued/processing payouts are handled by Razorpay's own idempotency
    // header below.
    const existing = await this.db.findMany<any>("payroll_payouts", {
      filters: { payroll_run_id: runId },
      limit: 10000,
    });
    const existingByIdem = new Map<string, any>();
    for (const p of existing.data) existingByIdem.set(p.idempotency_key, p);

    type Result = {
      payslipId: string;
      empcloudUserId: number;
      status: "queued" | "skipped" | "error";
      payoutId?: string;
      message?: string;
    };
    const results: Result[] = [];

    let cursor = 0;
    const worker = async () => {
      while (cursor < payslips.length) {
        const i = cursor++;
        const ps = payslips[i];
        const idem = String(ps.id);
        const already = existingByIdem.get(idem);
        if (already && ["processed", "processing"].includes(String(already.status))) {
          results.push({
            payslipId: ps.id,
            empcloudUserId: Number(ps.empcloud_user_id),
            status: "skipped",
            message: `already ${already.status}`,
            payoutId: already.razorpay_payout_id || undefined,
          });
          continue;
        }
        const netPay = Number(ps.net_pay) || 0;
        if (netPay <= 0) {
          results.push({
            payslipId: ps.id,
            empcloudUserId: Number(ps.empcloud_user_id),
            status: "skipped",
            message: `net pay is ${netPay}`,
          });
          continue;
        }
        try {
          const fundAccountId = await this.ensureFundAccount(client, Number(ps.empcloud_user_id));
          const amountPaise = Math.round(netPay * 100);
          const created = await client.createPayout(
            {
              account_number: accountNumber,
              fund_account_id: fundAccountId,
              amount: amountPaise,
              currency: "INR",
              mode: defaultMode as any,
              purpose: "salary",
              reference_id: `payslip-${ps.id}`,
              narration: `Salary ${run.month}/${run.year}`.slice(0, 30),
              queue_if_low_balance: true,
              notes: {
                payslip_id: ps.id,
                payroll_run_id: runId,
                empcloud_user_id: String(ps.empcloud_user_id),
                empcloud_org_id: String(empcloudOrgId),
              },
            },
            idem,
          );
          // Record / update the payout row.
          const snapshot = safeResponseSnapshot(created.raw);
          if (already) {
            await this.db.update("payroll_payouts", already.id, {
              razorpay_payout_id: created.id,
              status: created.status || "queued",
              mode: created.mode || defaultMode,
              attempted_at: new Date(),
              response: JSON.stringify(snapshot),
              failure_reason: null,
            });
          } else {
            await this.db.create("payroll_payouts", {
              id: uuidv4(),
              payslip_id: ps.id,
              payroll_run_id: runId,
              empcloud_user_id: Number(ps.empcloud_user_id),
              empcloud_org_id: empcloudOrgId,
              razorpay_payout_id: created.id,
              idempotency_key: idem,
              amount_paise: amountPaise,
              mode: created.mode || defaultMode,
              status: created.status || "queued",
              attempted_at: new Date(),
              response: JSON.stringify(snapshot),
            });
          }
          results.push({
            payslipId: ps.id,
            empcloudUserId: Number(ps.empcloud_user_id),
            status: "queued",
            payoutId: created.id,
          });
        } catch (err: any) {
          const reason =
            err?.description || err?.message || "Razorpay payout failed for unknown reason.";
          // Persist the failure even though no Razorpay id was issued.
          if (already) {
            await this.db.update("payroll_payouts", already.id, {
              status: "failed",
              failure_reason: String(reason).slice(0, 500),
              attempted_at: new Date(),
            });
          } else {
            await this.db.create("payroll_payouts", {
              id: uuidv4(),
              payslip_id: ps.id,
              payroll_run_id: runId,
              empcloud_user_id: Number(ps.empcloud_user_id),
              empcloud_org_id: empcloudOrgId,
              razorpay_payout_id: null,
              idempotency_key: idem,
              amount_paise: Math.round(netPay * 100),
              mode: defaultMode,
              status: "failed",
              failure_reason: String(reason).slice(0, 500),
              attempted_at: new Date(),
            });
          }
          results.push({
            payslipId: ps.id,
            empcloudUserId: Number(ps.empcloud_user_id),
            status: "error",
            message: String(reason),
          });
        }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    const summary = {
      total: payslips.length,
      queued: results.filter((r) => r.status === "queued").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      errors: results.filter((r) => r.status === "error").length,
      results,
    };
    return summary;
  }

  /**
   * Current payouts for a run, with each row's latest known status. Rows are
   * decorated with `employee_name` and `emp_code` from EmpCloud so the UI can
   * render proper names instead of bare numeric ids.
   */
  async getRunPayouts(empcloudOrgId: number, runId: string) {
    const rows = await this.db.findMany<any>("payroll_payouts", {
      filters: { payroll_run_id: runId, empcloud_org_id: empcloudOrgId },
      limit: 10000,
      sort: { field: "created_at", order: "asc" },
    });
    // Batch-fetch the EmpCloud users for every distinct empcloud_user_id on
    // the run — one query for the whole table, then a local merge. Avoids the
    // N+1 a per-row findUserById would produce on a 1000-row run.
    const ids = [
      ...new Set(rows.data.map((r: any) => Number(r.empcloud_user_id)).filter((n: number) => !!n)),
    ];
    let nameByUser: Map<number, { name: string; emp_code: string | null }> = new Map();
    if (ids.length > 0) {
      const ecDb = getEmpCloudDB();
      const users = await ecDb("users")
        .whereIn("id", ids)
        .select("id", "first_name", "last_name", "emp_code");
      for (const u of users) {
        const full = `${u.first_name || ""} ${u.last_name || ""}`.trim();
        nameByUser.set(Number(u.id), {
          name: full || u.emp_code || `Employee #${u.id}`,
          emp_code: u.emp_code || null,
        });
      }
    }
    return rows.data.map((r: any) => {
      const u = nameByUser.get(Number(r.empcloud_user_id));
      return {
        ...r,
        employee_name: u?.name || `Employee #${r.empcloud_user_id}`,
        emp_code: u?.emp_code || null,
      };
    });
  }

  /**
   * Retry a single failed payout. Uses a fresh idempotency key (the original
   * + ":r<timestamp>") so Razorpay treats it as a new attempt rather than
   * returning the previous failure.
   */
  async retryPayout(empcloudOrgId: number, payoutRowId: string) {
    const { client, accountNumber, defaultMode } = await this.clientForOrg(empcloudOrgId);
    const row = await this.db.findById<any>("payroll_payouts", payoutRowId);
    if (!row || row.empcloud_org_id !== empcloudOrgId) {
      throw new AppError(404, "PAYOUT_NOT_FOUND", "Payout not found for this organization.");
    }
    if (!["failed", "rejected", "reversed"].includes(String(row.status))) {
      throw new AppError(
        400,
        "INVALID_PAYOUT_STATUS",
        `Only failed / rejected / reversed payouts can be retried (current: ${row.status}).`,
      );
    }
    const fundAccountId = await this.ensureFundAccount(client, Number(row.empcloud_user_id));
    const ps = await this.db.findById<any>("payslips", row.payslip_id);
    const run = await this.db.findById<any>("payroll_runs", row.payroll_run_id);
    const freshIdem = `${row.idempotency_key}:r${Date.now()}`;
    const created = await client.createPayout(
      {
        account_number: accountNumber,
        fund_account_id: fundAccountId,
        amount: Number(row.amount_paise),
        currency: "INR",
        mode: defaultMode as any,
        purpose: "salary",
        reference_id: `payslip-${row.payslip_id}`,
        narration: `Salary ${run?.month}/${run?.year}`.slice(0, 30),
        queue_if_low_balance: true,
        notes: {
          payslip_id: String(row.payslip_id),
          payroll_run_id: String(row.payroll_run_id),
          empcloud_user_id: String(row.empcloud_user_id),
          empcloud_org_id: String(empcloudOrgId),
          retry_of: String(row.id),
        },
      },
      freshIdem,
    );
    await this.db.update("payroll_payouts", row.id, {
      razorpay_payout_id: created.id,
      idempotency_key: freshIdem,
      status: created.status || "queued",
      failure_reason: null,
      attempted_at: new Date(),
      response: JSON.stringify(safeResponseSnapshot(created.raw)),
    });
    return { id: row.id, payoutId: created.id, status: created.status };
  }

  // -------------------------------------------------------------------------
  // Phase 2 — webhook reconciliation
  // -------------------------------------------------------------------------

  /**
   * Apply a Razorpay webhook event. Caller is responsible for signature
   * verification before invoking this. Returns a small audit summary so the
   * webhook route can log a one-liner per event.
   */
  async applyWebhookEvent(event: any): Promise<{
    handled: boolean;
    payoutRowId?: string;
    status?: string;
    reason?: string;
  }> {
    const type = String(event?.event || "");
    if (!type.startsWith("payout.")) return { handled: false, reason: `ignored event ${type}` };
    const rzpPayout = event?.payload?.payout?.entity;
    const rzpPayoutId = rzpPayout?.id;
    if (!rzpPayoutId) return { handled: false, reason: "missing payout id in event" };

    const matchRes = await this.db.findMany<any>("payroll_payouts", {
      filters: { razorpay_payout_id: rzpPayoutId },
      limit: 1,
    });
    const row = matchRes.data[0];
    if (!row) {
      return { handled: false, reason: `no local payout row for ${rzpPayoutId}` };
    }

    const newStatus = String(rzpPayout.status || row.status).toLowerCase();
    const updates: Record<string, any> = {
      status: newStatus,
      response: JSON.stringify(safeResponseSnapshot(rzpPayout)),
    };
    if (rzpPayout.failure_reason) {
      updates.failure_reason = String(rzpPayout.failure_reason).slice(0, 500);
    }
    if (["processed", "reversed"].includes(newStatus)) {
      updates.settled_at = new Date();
    }
    await this.db.update("payroll_payouts", row.id, updates);
    return { handled: true, payoutRowId: row.id, status: newStatus };
  }
}

function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
