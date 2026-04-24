// =============================================================================
// Announcement service — read-only, sourced from EmpCloud.
//
// The payroll-local `announcements` table was dropped in migration 022;
// EmpCloud is now the single source of truth. This module only exposes
// read paths that pull from the EmpCloud DB via getEmpCloudDB().
// =============================================================================

import { getEmpCloudDB } from "../db/empcloud";

export interface PayrollAnnouncement {
  id: string;
  org_id: number;
  title: string;
  content: string;
  priority: "low" | "normal" | "high" | "urgent";
  category: string;
  author_id: number | null;
  author_name?: string;
  is_pinned: 0 | 1;
  is_active: 0 | 1;
  publish_at: Date | string | null;
  expires_at: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  source: "empcloud";
}

function mapEmpCloudRow(r: any, orgId: number): PayrollAnnouncement {
  return {
    id: `ec-${r.id}`,
    org_id: orgId,
    title: r.title,
    content: r.content,
    priority: (r.priority as PayrollAnnouncement["priority"]) || "normal",
    category: "general", // EmpCloud schema has no category; default
    author_id: r.created_by ?? null,
    is_pinned: 0, // EmpCloud has no pin concept
    is_active: r.is_active ? 1 : 0,
    publish_at: r.published_at,
    expires_at: r.expires_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
    source: "empcloud",
  };
}

export async function listAnnouncements(
  orgId: number,
  opts?: { activeOnly?: boolean; limit?: number },
): Promise<PayrollAnnouncement[]> {
  let rows: PayrollAnnouncement[] = [];

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
      const now = new Date();
      q = q
        .andWhere("a.is_active", true)
        .andWhere((qb) => qb.whereNull("a.published_at").orWhere("a.published_at", "<=", now))
        .andWhere((qb) => qb.whereNull("a.expires_at").orWhere("a.expires_at", ">", now));
    }

    q = q.orderBy("a.created_at", "desc");
    if (opts?.limit) q = q.limit(opts.limit);

    const ecRows: any[] = await q;
    rows = ecRows.map((r) => mapEmpCloudRow(r, orgId));

    // Batch author-name enrichment from EmpCloud users.
    const authorIds = Array.from(
      new Set(rows.map((a) => Number(a.author_id)).filter((n) => Number.isFinite(n))),
    );
    if (authorIds.length) {
      const authors: any[] = await ecDb("users")
        .whereIn("id", authorIds)
        .select("id", "first_name", "last_name");
      const byId = new Map(
        authors.map((u) => [Number(u.id), `${u.first_name || ""} ${u.last_name || ""}`.trim()]),
      );
      for (const a of rows) {
        a.author_name = byId.get(Number(a.author_id)) || "Unknown";
      }
    }
  } catch {
    // EmpCloud unreachable — return empty list rather than 500.
    return [];
  }

  return rows;
}

export async function getAnnouncement(
  id: string,
  orgId: number,
): Promise<PayrollAnnouncement | null> {
  if (!id.startsWith("ec-")) return null;
  const ecId = id.slice(3);
  try {
    const ecDb = getEmpCloudDB();
    const row = await ecDb("announcements")
      .where({ id: Number(ecId), organization_id: orgId })
      .first();
    if (!row) return null;
    const mapped = mapEmpCloudRow(row, orgId);
    if (mapped.author_id) {
      const author = await ecDb("users")
        .where({ id: Number(mapped.author_id) })
        .select("first_name", "last_name")
        .first();
      mapped.author_name = author
        ? `${author.first_name || ""} ${author.last_name || ""}`.trim()
        : "Unknown";
    }
    return mapped;
  } catch {
    return null;
  }
}
