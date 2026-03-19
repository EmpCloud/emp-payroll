import { v4 as uuid } from "uuid";
import { getDB } from "../db/adapters";
import { getEmpCloudDB } from "../db/empcloud";

export interface CreateAnnouncementInput {
  orgId: number;
  authorId: number;
  title: string;
  content: string;
  priority?: "low" | "normal" | "high" | "urgent";
  category?: "general" | "hr" | "policy" | "event" | "holiday" | "maintenance";
  isPinned?: boolean;
  publishAt?: string;
  expiresAt?: string;
}

export async function createAnnouncement(input: CreateAnnouncementInput) {
  const db = getDB();
  const id = uuid();
  await db.create("announcements", {
    id,
    org_id: input.orgId,
    author_id: input.authorId,
    title: input.title,
    content: input.content,
    priority: input.priority || "normal",
    category: input.category || "general",
    is_pinned: input.isPinned ? 1 : 0,
    is_active: 1,
    publish_at: input.publishAt || new Date().toISOString().replace("T", " ").replace("Z", ""),
    expires_at: input.expiresAt || null,
  });
  return { id };
}

export async function listAnnouncements(
  orgId: number,
  opts?: { activeOnly?: boolean; limit?: number },
) {
  const db = getDB();
  const now = new Date().toISOString().replace("T", " ").replace("Z", "");

  let query = `SELECT * FROM announcements WHERE org_id = ?`;
  const params: any[] = [orgId];

  if (opts?.activeOnly !== false) {
    query += ` AND is_active = 1 AND (publish_at IS NULL OR publish_at <= ?) AND (expires_at IS NULL OR expires_at > ?)`;
    params.push(now, now);
  }

  query += ` ORDER BY is_pinned DESC, created_at DESC`;

  if (opts?.limit) {
    query += ` LIMIT ?`;
    params.push(opts.limit);
  }

  const result = await db.raw<any>(query, params);
  const announcements = Array.isArray(result)
    ? Array.isArray(result[0])
      ? result[0]
      : result
    : result.rows || [];

  // Enrich with author names
  try {
    const ecDb = getEmpCloudDB();
    for (const a of announcements) {
      if (a.author_id) {
        const author = await ecDb("users")
          .where({ id: Number(a.author_id) })
          .select("first_name", "last_name")
          .first();
        a.author_name = author ? `${author.first_name} ${author.last_name}` : "Unknown";
      }
    }
  } catch {
    // EmpCloud may not be available
  }

  return announcements;
}

export async function getAnnouncement(id: string, orgId: number) {
  const db = getDB();
  const result = await db.raw<any>(`SELECT * FROM announcements WHERE id = ? AND org_id = ?`, [
    id,
    orgId,
  ]);
  const rows = Array.isArray(result)
    ? Array.isArray(result[0])
      ? result[0]
      : result
    : result.rows || [];
  return rows[0] || null;
}

export async function updateAnnouncement(
  id: string,
  orgId: number,
  data: Partial<CreateAnnouncementInput>,
) {
  const db = getDB();
  const updates: Record<string, any> = {};
  if (data.title !== undefined) updates.title = data.title;
  if (data.content !== undefined) updates.content = data.content;
  if (data.priority !== undefined) updates.priority = data.priority;
  if (data.category !== undefined) updates.category = data.category;
  if (data.isPinned !== undefined) updates.is_pinned = data.isPinned ? 1 : 0;
  if (data.publishAt !== undefined) updates.publish_at = data.publishAt;
  if (data.expiresAt !== undefined) updates.expires_at = data.expiresAt;

  if (Object.keys(updates).length === 0) return false;
  updates.updated_at = new Date();

  const count = await db.updateMany("announcements", { id, org_id: orgId }, updates);
  return count > 0;
}

export async function deleteAnnouncement(id: string, orgId: number) {
  const db = getDB();
  const count = await db.updateMany(
    "announcements",
    { id, org_id: orgId },
    { is_active: 0, updated_at: new Date() },
  );
  return count > 0;
}
