/**
 * Audit Router — reads the Supabase `audit_logs` table (the single audit
 * trail, written by `logAudit` on every privileged action).
 *
 * The previous implementation read an Apps-Script-maintained "Audit Log"
 * Google Sheet through a CSV cache; that path is retired along with the rest
 * of the Sheets integration.
 *
 * Action keys are stored in dot-notation already ("profile.verify"), so no
 * mapping layer is needed any more.
 */
import { z } from "zod";
import { supabase, getProfileNameLookup } from "./supabaseApi";
import { adminProcedure, router } from "./trpc";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Shape the client AuditLog.tsx component expects. */
interface UiAuditLogEntry {
  id: number;
  action: string;
  actionLabel: string;
  targetId: string | null;
  targetName: string | null;
  details: Record<string, unknown> | null;
  success: boolean;
  createdAt: string; // ISO-8601 string
}

type AuditRow = {
  id: string;
  action: string;
  action_label: string;
  actor_open_id: string | null;
  actor_name: string | null;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  success: boolean;
  created_at: string;
};

/**
 * Only these action kinds surface in the admin Audit Log section — the four
 * donor-record lifecycle events (registrations, edits, donations,
 * deletions). Everything else is out of scope by product decision.
 */
const VISIBLE_ACTIONS = new Set([
  "profile.add_person",
  "profile.update",
  "profile.donation",
  "profile.delete",
]);

/* ------------------------------------------------------------------ */
/* Name resolution                                                     */
/* ------------------------------------------------------------------ */

/** Build a Map<HRS ID, Full Name> so audit rows can show who was acted on. */
async function buildNameLookup(): Promise<Map<string, string>> {
  try {
    // Shared snapshot — no extra round-trip of its own.
    return await getProfileNameLookup();
  } catch (error) {
    console.warn("[auditRouter] Name lookup unavailable:", error);
    return new Map();
  }
}

/* ------------------------------------------------------------------ */
/* Row → UI shape                                                      */
/* ------------------------------------------------------------------ */

function rowToEntry(
  row: AuditRow,
  nameLookup: Map<string, string>
): UiAuditLogEntry {
  const targetId = (row.target_id || "").trim() || null;
  return {
    id: stableId(row.id),
    action: row.action,
    actionLabel: row.action_label,
    targetId,
    targetName: targetId ? (nameLookup.get(targetId) ?? null) : null,
    details: row.details ?? null,
    success: row.success !== false,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** Map the UUID primary key to the numeric id the UI uses as a React key. */
function stableId(uuid: string): number {
  let h = 0;
  for (let i = 0; i < uuid.length; i++) {
    h = (h * 31 + uuid.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

const listInput = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
  action: z.string().optional(),
  search: z.string().max(120).optional(),
});

export const auditRouter = router({
  list: adminProcedure.input(listInput).query(async ({ input }) => {
    const { limit = 50, offset = 0, action, search } = input;

    // Base fetch: this table only ever contains audit rows, and the volume is
    // small (privileged actions only), so a bounded page is enough. Filters
    // that PostgREST can express directly are pushed down; the visible-action
    // filter and text search run client-side of the query.
    // The HRS-ID → name lookup runs in parallel with the log fetch instead of
    // after it (it previously added a second serial round-trip to Supabase).
    const [logsResult, nameLookup] = await Promise.all([
      supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500),
      buildNameLookup(),
    ]);

    const { data, error } = logsResult;

    if (error) {
      console.error("[auditRouter] list failed:", error);
      return { logs: [] as UiAuditLogEntry[], total: 0 };
    }

    let entries = ((data ?? []) as AuditRow[])
      .map(row => rowToEntry(row, nameLookup))
      .filter(e => VISIBLE_ACTIONS.has(e.action));

    if (action && action !== "all") {
      entries = entries.filter(e => e.action === action);
    }

    if (search && search.trim()) {
      const lower = search.trim().toLowerCase();
      entries = entries.filter(e =>
        [e.targetId, e.targetName, e.actionLabel, e.action].some(
          f => f && f.toLowerCase().includes(lower)
        )
      );
    }

    const total = entries.length;
    const page = entries.slice(offset, offset + limit);
    return { logs: page, total };
  }),

  /** Clear all audit log entries (admin only). */
  clear: adminProcedure.mutation(async () => {
    const { data, error } = await supabase
      .from("audit_logs")
      .delete()
      .neq("action", "__never_matches__") // delete all rows
      .select("id");

    if (error) {
      console.error("[auditRouter] clear failed:", error);
      return { success: false, removed: 0 };
    }

    const removed = (data ?? []).length;
    return { success: true, removed };
  }),
});
