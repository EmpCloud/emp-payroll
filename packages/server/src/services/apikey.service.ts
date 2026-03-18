import crypto from "crypto";
import { v4 as uuid } from "uuid";
import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";

/**
 * API Key service for third-party integrations.
 * Keys are stored hashed. The full key is only shown once at creation.
 */
export class ApiKeyService {
  private db = getDB();

  // In-memory store for dev (use DB table in production)
  private static keys = new Map<string, { orgId: string; name: string; permissions: string[]; createdAt: Date }>();

  async create(orgId: string, params: { name: string; permissions?: string[] }) {
    const rawKey = `empk_${crypto.randomBytes(32).toString("hex")}`;
    const hashedKey = crypto.createHash("sha256").update(rawKey).digest("hex");
    const id = uuid();

    ApiKeyService.keys.set(hashedKey, {
      orgId,
      name: params.name,
      permissions: params.permissions || ["read"],
      createdAt: new Date(),
    });

    return {
      id,
      key: rawKey, // Only shown once!
      name: params.name,
      prefix: rawKey.slice(0, 12) + "...",
      permissions: params.permissions || ["read"],
      createdAt: new Date().toISOString(),
    };
  }

  async validate(rawKey: string): Promise<{ orgId: string; name: string; permissions: string[] } | null> {
    const hashedKey = crypto.createHash("sha256").update(rawKey).digest("hex");
    const entry = ApiKeyService.keys.get(hashedKey);
    if (!entry) return null;
    return entry;
  }

  async list(orgId: string) {
    const keys: any[] = [];
    for (const [hash, entry] of ApiKeyService.keys.entries()) {
      if (entry.orgId === orgId) {
        keys.push({
          hash: hash.slice(0, 8) + "...",
          name: entry.name,
          permissions: entry.permissions,
          createdAt: entry.createdAt,
        });
      }
    }
    return keys;
  }

  async revoke(orgId: string, keyHash: string) {
    for (const [hash, entry] of ApiKeyService.keys.entries()) {
      if (entry.orgId === orgId && hash.startsWith(keyHash)) {
        ApiKeyService.keys.delete(hash);
        return { revoked: true };
      }
    }
    throw new AppError(404, "NOT_FOUND", "API key not found");
  }
}
