// =============================================================================
// MIGRATION 027 — superseded by the self-healing rewrite of 026
//
// Originally added to clean up the bad expression migration 026 left
// behind. PR #281 then folded the same logic into 026 itself (now
// self-healing on every run), making this migration redundant.
//
// Worse, this migration's body still rebuilt the column with the
// `NULLIF(JSON_UNQUOTE(...), 'null')` expression — which does NOT cover
// the empty-string case 026 now handles. Running it after 026 undid
// 026's fix and the unique index failed again with `Duplicate entry '1-'`.
//
// Kept as a no-op so the migration registry stays consistent on
// machines that already had this entry queued.
// =============================================================================

import type { Knex } from "knex";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function up(_knex: Knex) {
  // Intentionally empty. Column + index are managed exclusively by
  // migration 026 from PR #281 onward.
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function down(_knex: Knex) {
  // No-op.
}
