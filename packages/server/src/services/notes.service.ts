import { v4 as uuid } from "uuid";
import { getDB } from "../db/adapters";

export interface CreateNoteInput {
  orgId: string;
  employeeId: string;
  authorId: string;
  content: string;
  category?: string;
  isPrivate?: boolean;
}

export async function createNote(input: CreateNoteInput) {
  const db = getDB();
  const id = uuid();
  await db.create("employee_notes", {
    id,
    org_id: input.orgId,
    employee_id: input.employeeId,
    author_id: input.authorId,
    content: input.content,
    category: input.category || "general",
    is_private: input.isPrivate ? 1 : 0,
  });
  return { id };
}

export async function getNotes(employeeId: string, orgId: string) {
  const db = getDB();
  // Use raw query for the JOIN since the adapter doesn't natively support joins
  const result = await db.raw<any>(
    `SELECT n.id, n.content, n.category, n.is_private, n.created_at,
            e.first_name AS author_first_name, e.last_name AS author_last_name
     FROM employee_notes n
     LEFT JOIN employees e ON n.author_id = e.id
     WHERE n.employee_id = ? AND n.org_id = ?
     ORDER BY n.created_at DESC`,
    [employeeId, orgId]
  );
  // mysql2 raw returns [rows, fields], pg returns { rows }
  const notes = Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : result.rows || [];
  return notes;
}

export async function deleteNote(noteId: string, orgId: string) {
  const db = getDB();
  const count = await db.deleteMany("employee_notes", { id: noteId, org_id: orgId });
  return count > 0;
}
