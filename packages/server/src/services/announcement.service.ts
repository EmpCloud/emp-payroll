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

  // ── Local payroll announcements ──────────────────────────────────────────
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
  const local: any[] = Array.isArray(result)
    ? Array.isArray(result[0])
      ? result[0]
      : result
    : result.rows || [];
  for (const a of local) a.source = "payroll";

  // ── EmpCloud announcements (read-only) ───────────────────────────────────
  // EmpCloud is the platform-wide source for company announcements; this
  // page should surface them alongside payroll-local ones. Schema differs
  // (no category, no is_pinned, different column names) — normalize to the
  // payroll shape here.
  let empcloud: any[] = [];
  try {
    const ecDb = getEmpCloudDB();
    let q = ecDb("announcements as a")
      .select(
        "a.id",
        "a.title",
        "a.content",
        "a.priority",
        "a.published_at",
        "a.expires_at",
        "a.created_by",
        "a.is_active",
        "a.created_at",
        "a.updated_at",
      )
      .where({ "a.organization_id": orgId });

    if (opts?.activeOnly !== false) {
      const nowIso = new Date();
      q = q
        .andWhere("a.is_active", true)
        .andWhere((qb) => qb.whereNull("a.published_at").orWhere("a.published_at", "<=", nowIso))
        .andWhere((qb) => qb.whereNull("a.expires_at").orWhere("a.expires_at", ">", nowIso));
    }

    q = q.orderBy("a.created_at", "desc");
    if (opts?.limit) q = q.limit(opts.limit);

    const ecRows: any[] = await q;
    empcloud = ecRows.map((r) => ({
      id: `ec-${r.id}`,
      org_id: orgId,
      title: r.title,
      content: r.content,
      priority: r.priority || "normal",
      category: "general", // EmpCloud schema has no category; default
      author_id: r.created_by,
      is_pinned: 0, // EmpCloud has no pin concept
      is_active: r.is_active ? 1 : 0,
      publish_at: r.published_at,
      expires_at: r.expires_at,
      created_at: r.created_at,
      updated_at: r.updated_at,
      source: "empcloud", // UI uses this to render read-only + a badge
    }));
  } catch {
    // EmpCloud may not be reachable; fall through with empcloud=[].
  }

  // Merge, preserving pinned-first then created_at desc. Payroll is_pinned
  // wins because EmpCloud has no pin concept (all 0).
  const announcements = [...local, ...empcloud].sort((x, y) => {
    if ((y.is_pinned || 0) !== (x.is_pinned || 0)) {
      return (y.is_pinned || 0) - (x.is_pinned || 0);
    }
    const xt = x.created_at ? new Date(x.created_at).getTime() : 0;
    const yt = y.created_at ? new Date(y.created_at).getTime() : 0;
    return yt - xt;
  });

  // Enrich every row with author name from EmpCloud users (single batch).
  try {
    const ecDb = getEmpCloudDB();
    const authorIds = Array.from(
      new Set(announcements.map((a) => Number(a.author_id)).filter((n) => Number.isFinite(n))),
    );
    if (authorIds.length) {
      const authors: any[] = await ecDb("users")
        .whereIn("id", authorIds)
        .select("id", "first_name", "last_name");
      const byId = new Map(
        authors.map((u) => [Number(u.id), `${u.first_name || ""} ${u.last_name || ""}`.trim()]),
      );
      for (const a of announcements) {
        a.author_name = byId.get(Number(a.author_id)) || "Unknown";
      }
    }
  } catch {
    // EmpCloud may not be available
  }

  // Apply a final limit across the merged list so callers get what they asked for.
  if (opts?.limit && announcements.length > opts.limit) {
    return announcements.slice(0, opts.limit);
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
  if (id.startsWith("ec-")) {
    // EmpCloud-sourced rows are read-only here; edit them in EmpCloud.
    return false;
  }
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
  if (id.startsWith("ec-")) {
    return false; // EmpCloud-sourced; not deletable from payroll.
  }
  const db = getDB();
  const count = await db.updateMany(
    "announcements",
    { id, org_id: orgId },
    { is_active: 0, updated_at: new Date() },
  );
  return count > 0;
}
