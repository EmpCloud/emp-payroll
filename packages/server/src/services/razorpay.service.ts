// ============================================================================
// RAZORPAY (RazorpayX Payouts) — thin per-tenant HTTP wrapper
// ----------------------------------------------------------------------------
// Per-org client. Holds the decrypted key id + secret and applies Basic auth
// to every request. Phase 1A exposes `testConnection`. Phase 1B adds
// `createContact`, `createFundAccount`, `createPayout`, `getPayout`. Phase 2
// adds `verifyWebhookSignature` (a static helper — no auth needed).
//
// Uses Node 20+ native `fetch` to avoid a new runtime dependency. The
// official `razorpay` npm SDK assumes one global key pair; we have one per
// tenant — easier to manage with a thin wrapper anyway.
// ============================================================================

import crypto from "crypto";

const BASE_URL = "https://api.razorpay.com";
const DEFAULT_TIMEOUT_MS = 15_000;

export interface RazorpayContactPayload {
  name: string;
  email?: string;
  contact?: string;
  type?: "employee" | "vendor" | "customer" | string;
  reference_id?: string;
  notes?: Record<string, string>;
}

export interface RazorpayBankAccount {
  name: string;
  ifsc: string;
  account_number: string;
}

export interface RazorpayPayoutPayload {
  /** Source RazorpayX virtual account number. */
  account_number: string;
  fund_account_id: string;
  amount: number; // paise
  currency: "INR";
  mode: "IMPS" | "NEFT" | "RTGS" | string;
  purpose: "salary" | string;
  reference_id?: string;
  /** Free-text shown on the payee's statement; ≤ 30 chars on most banks. */
  narration?: string;
  queue_if_low_balance?: boolean;
  notes?: Record<string, string>;
}

export interface RazorpayClientConfig {
  keyId: string;
  keySecret: string;
  /** Source RazorpayX virtual account number (the payouts debit source). */
  accountNumber?: string;
}

export interface RazorpayError {
  status: number;
  code?: string;
  description?: string;
}

export class RazorpayClient {
  private readonly authHeader: string;
  private readonly keyId: string;
  private readonly accountNumber?: string;

  constructor(cfg: RazorpayClientConfig) {
    if (!cfg.keyId || !cfg.keySecret) {
      throw new Error("RazorpayClient: keyId and keySecret are required");
    }
    this.keyId = cfg.keyId;
    this.accountNumber = cfg.accountNumber;
    this.authHeader = "Basic " + Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64");
  }

  /**
   * Probe the credentials. Hits `GET /v1/payouts?count=1&account_number=...`
   * which validates BOTH the API key pair AND the source account number
   * (so a wrong virtual account number doesn't surface only at payout time).
   *
   * Resolves on 2xx with a small summary; rejects with a structured error so
   * the Settings page can show a precise message ("Authentication failed",
   * "Account number invalid", etc.) rather than a generic 500.
   */
  // -------------------------------------------------------------------------
  // Phase 1B — payouts surface
  // -------------------------------------------------------------------------

  /**
   * Create (or no-op fetch by reference_id) a Razorpay contact. RazorpayX
   * treats contacts as the human/biz on the other end of a payout — one per
   * employee. Returns the Razorpay contact id, which we cache on the payroll
   * profile so subsequent payouts skip this round-trip.
   */
  async createContact(
    body: RazorpayContactPayload,
    idempotencyKey?: string,
  ): Promise<{ id: string }> {
    const res = await this.request<{ id: string }>(
      "POST",
      `${BASE_URL}/v1/contacts`,
      body,
      idempotencyKey,
    );
    return { id: res.id };
  }

  /**
   * Create a bank_account-type fund account under a given contact. One per
   * (contact, bank_details) combo — the result is cached against a sha256
   * fingerprint of the bank details so a later edit invalidates it.
   */
  async createFundAccount(
    contactId: string,
    bank: RazorpayBankAccount,
    idempotencyKey?: string,
  ): Promise<{ id: string }> {
    const res = await this.request<{ id: string }>(
      "POST",
      `${BASE_URL}/v1/fund_accounts`,
      {
        contact_id: contactId,
        account_type: "bank_account",
        bank_account: bank,
      },
      idempotencyKey,
    );
    return { id: res.id };
  }

  /**
   * Create a payout. Razorpay's `X-Payout-Idempotency` header makes the call
   * safe to retry: the same key always returns the same payout (HTTP 200 with
   * the original id), so a network blip during disburse won't double-pay.
   */
  async createPayout(
    body: RazorpayPayoutPayload,
    idempotencyKey: string,
  ): Promise<{ id: string; status: string; mode?: string; raw: any }> {
    const res = await this.request<any>(
      "POST",
      `${BASE_URL}/v1/payouts`,
      body,
      idempotencyKey,
      // Razorpay's payout idempotency uses a dedicated header name, not the
      // generic X-Idempotency-Key.
      "X-Payout-Idempotency",
    );
    return { id: res.id, status: res.status, mode: res.mode, raw: res };
  }

  /** Fetch a single payout — used to refresh status on retry / manual poll. */
  async getPayout(payoutId: string): Promise<{ id: string; status: string; raw: any }> {
    const res = await this.request<any>("GET", `${BASE_URL}/v1/payouts/${payoutId}`);
    return { id: res.id, status: res.status, raw: res };
  }

  // -------------------------------------------------------------------------
  // Phase 2 — webhook signature verification (static — no per-tenant client)
  // -------------------------------------------------------------------------

  /**
   * Verify a Razorpay webhook signature. The signature header is an
   * HMAC-SHA256 of the RAW request body using the webhook secret as the key.
   * Uses a timing-safe compare so an attacker can't binary-search the
   * signature via response timing. Returns true on match, false on anything
   * else (wrong key, malformed payload, tampered body).
   */
  static verifyWebhookSignature(
    rawBody: string | Buffer,
    signature: string,
    secret: string,
  ): boolean {
    if (!signature || !secret || !rawBody) return false;
    const computed = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const a = Buffer.from(computed, "utf8");
    const b = Buffer.from(signature, "utf8");
    if (a.length !== b.length) return false;
    try {
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  async testConnection(): Promise<{ ok: true; count: number; mode: "test" | "live" | "unknown" }> {
    if (!this.accountNumber) {
      throw asError({
        status: 400,
        code: "ACCOUNT_NUMBER_REQUIRED",
        description: "Source account number is required to verify the connection.",
      });
    }
    const url = `${BASE_URL}/v1/payouts?count=1&account_number=${encodeURIComponent(
      this.accountNumber,
    )}`;
    const body = await this.request<{ items?: any[] }>("GET", url);
    return {
      ok: true,
      count: Array.isArray(body.items) ? body.items.length : 0,
      mode: inferModeFromKey(this.keyId),
    };
  }

  /**
   * Low-level request. Adds Basic auth, a timeout, and translates non-2xx
   * responses + transport errors into the structured RazorpayError shape.
   */
  private async request<T>(
    method: string,
    url: string,
    payload?: any,
    idempotencyKey?: string,
    idempotencyHeaderName: string = "X-Idempotency-Key",
  ): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (idempotencyKey) headers[idempotencyHeaderName] = idempotencyKey;
      const res = await fetch(url, {
        method,
        signal: ctrl.signal,
        headers,
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      let parsed: any = null;
      const text = await res.text();
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { raw: text };
        }
      }
      if (!res.ok) {
        const errObj = parsed?.error || {};
        throw asError({
          status: res.status,
          code: errObj.code || `HTTP_${res.status}`,
          description:
            errObj.description ||
            (res.status === 401
              ? "Authentication failed — check the Key ID and Secret."
              : res.status === 400 && /account/i.test(text)
                ? "Source account number is not valid for this Razorpay key."
                : `Razorpay returned HTTP ${res.status}.`),
        });
      }
      return (parsed ?? {}) as T;
    } catch (err: any) {
      if ((err as any)?.status !== undefined) throw err; // already structured
      if (err?.name === "AbortError") {
        throw asError({
          status: 504,
          code: "TIMEOUT",
          description: "Razorpay did not respond within 15s.",
        });
      }
      throw asError({
        status: 0,
        code: "NETWORK",
        description: err?.message || "Could not reach api.razorpay.com.",
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

function inferModeFromKey(keyId: string | undefined): "test" | "live" | "unknown" {
  if (!keyId) return "unknown";
  if (keyId.startsWith("rzp_test_")) return "test";
  if (keyId.startsWith("rzp_live_")) return "live";
  return "unknown";
}

function asError(e: RazorpayError): Error & RazorpayError {
  const err = new Error(e.description || e.code || "Razorpay error") as Error & RazorpayError;
  err.status = e.status;
  err.code = e.code;
  err.description = e.description;
  return err;
}
