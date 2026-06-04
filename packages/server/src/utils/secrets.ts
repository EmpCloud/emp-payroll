// ============================================================================
// SECRETS — AES-256-GCM at-rest encryption for tenant-supplied credentials
// ----------------------------------------------------------------------------
// Stored format: `v1:<iv_hex>:<tag_hex>:<ct_hex>` where iv is 12 bytes (96 bit)
// and tag is 16 bytes. The `v1:` prefix lets us rotate algorithms later
// without re-encrypting every row up-front — `decryptSecret` dispatches on
// the version tag.
//
// Master key: 32 bytes, supplied as 64-char hex in `PAYROLL_SECRETS_KEY`.
// Generate with:  openssl rand -hex 32
// The server starts without it set, but any encrypt/decrypt call throws a
// clear, actionable error so the operator knows to add it before configuring
// any tenant secret (Razorpay creds, future webhook secrets, etc.).
// ============================================================================

import crypto from "crypto";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = "v1";

function loadMasterKey(): Buffer {
  const hex = process.env.PAYROLL_SECRETS_KEY;
  if (!hex || !hex.trim()) {
    throw new Error(
      "PAYROLL_SECRETS_KEY is not set. Generate one with `openssl rand -hex 32` and add it to the payroll .env (repo root).",
    );
  }
  const trimmed = hex.trim();
  if (!/^[0-9a-fA-F]+$/.test(trimmed)) {
    throw new Error("PAYROLL_SECRETS_KEY must be hex-encoded (use `openssl rand -hex 32`).");
  }
  const buf = Buffer.from(trimmed, "hex");
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `PAYROLL_SECRETS_KEY must decode to ${KEY_BYTES} bytes (got ${buf.length}). Use \`openssl rand -hex 32\` to generate a fresh one.`,
    );
  }
  return buf;
}

/**
 * Encrypt a plaintext secret. Returns a versioned, self-describing string
 * safe to persist in a VARCHAR column.
 */
export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptSecret: plaintext must be a non-empty string");
  }
  const key = loadMasterKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

/**
 * Decrypt a value produced by `encryptSecret`. Throws on tamper / bad key /
 * malformed payload — never returns a partial / garbage result.
 */
export function decryptSecret(payload: string): string {
  if (typeof payload !== "string" || !payload.startsWith(`${VERSION}:`)) {
    throw new Error("decryptSecret: payload missing or version unrecognised");
  }
  const parts = payload.split(":");
  if (parts.length !== 4) {
    throw new Error("decryptSecret: malformed payload (expected v1:iv:tag:ct)");
  }
  const [, ivHex, tagHex, ctHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ct = Buffer.from(ctHex, "hex");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ct.length === 0) {
    throw new Error("decryptSecret: malformed payload (component sizes wrong)");
  }
  const key = loadMasterKey();
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plain.toString("utf8");
}

/**
 * Convenience: returns true when the master key is present + valid. Used by
 * the Razorpay settings endpoint to refuse a save with a clear error before
 * touching the DB instead of erroring at the encrypt step.
 */
export function isSecretsKeyConfigured(): boolean {
  try {
    loadMasterKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Mask a Razorpay-style key for display ("rzp_test_XXXXXXXX" → "rzp_test_••••XXXX").
 * Safe for sending back to the client; secret never leaves the server.
 */
export function maskKeyId(keyId: string | null | undefined): string {
  if (!keyId) return "";
  const last4 = keyId.slice(-4);
  return `${keyId.slice(0, Math.min(keyId.length - 4, 9))}${"•".repeat(8)}${last4}`;
}
