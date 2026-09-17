/**
 * Audit Router (Google Sheets + Apps Script only — no database)
 *
 * Reads audit log entries from the Google Sheets "Audit Log" tab via the
 * Apps Script `audit_logs` GET endpoint. All privileged actions are written
 * by the Apps Script `appendAuditLog()` helper on each mutation, then this
 * router surfaces them to the admin UI with filtering and pagination.
 *
 * Action keys normalised to dot-notation (e.g. "profile.verify") so the
 * client always sees one consistent format regardless of the sheet's
 * uppercase "Action Type" column.
 */
import { z } from "zod";
import {
  clearAuditLogs as clearSheetAuditLogs,
} from "./googleAppsScriptApi";
import { ensureFreshCache, getCachedProfiles } from "./googleSheetsApi";
import {
  ensureFreshAuditCache,
  getCachedAuditLogs,
  invalidateAuditCache,
  type RawAuditLogEntry,
} from "./auditLogCache";
import { publicProcedure, router } from "./trpc";

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

/* ------------------------------------------------------------------ */
/* Name resolver                                                       */
/* ------------------------------------------------------------------ */

/** Build a Map<HRS ID, Full Name> from the cached profiles. */
function buildNameLookup(): Map<string, string> {
  const map = new Map<string, string>();
  const res = getCachedProfiles();
  if (!res.success || !res.data) return map;
  for (const p of res.data.profiles) {
    const id = (p["HRS ID"] || "").trim();
    const name = (p["Full Name"] || "").trim();
    if (id && name) map.set(id, name);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Sheet helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * Only these audit action kinds surface in the admin Audit Log section.
 * Staff actions, directory syncs, emails, deletes, and system notices stay
 * in the sheet but are not shown in the UI.
 */
const VISIBLE_ACTIONS = new Set([
  "profile.verify",
  "profile.update",
  "profile.donation",
]);

/** Map uppercase Apps Script action types to dot-notation keys. */
function normaliseAction(raw: string): string {
  const upper = raw.trim().toUpperCase();
  const map: Record<string, string> = {
    PROFILE_VERIFY: "profile.verify",
    PROFILE_UPDATE: "profile.update",
    PROFILE_DELETE: "profile.delete",
    PROFILE_DONATION: "profile.donation",
    PROFILE_EMAIL: "profile.send_email",
    DIRECTORY_SYNC: "directory.sync",
    SYSTEM_NOTIFY_OWNER: "system.notify_owner",
    VOLUNTEER_CREATE: "staff.create",
    VOLUNTEER_DELETE: "staff.delete",
    AUDIT_CLEAR: "audit.clear",
    ACTION_ERROR: "action.error",
  };
  return map[upper] || raw.trim().toLowerCase();
}

/** Parse the "dd-MM-yyyy HH:mm:ss" sheet timestamp → ISO. */
function parseSheetTimestamp(raw: string | undefined): string {
  if (!raw) return new Date().toISOString();
  const match = raw.match(
    /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!match) {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  const [, dd, mm, yyyy, hh, min, ss] = match;
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}+05:30`;
}

/** Parse the Details cell (usually JSON string). */
function parseDetails(raw: string | undefined): Record<string, unknown> | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) return parsed;
    return { message: String(parsed) };
  } catch {
    return { message: raw };
  }
}

/** Map a raw sheet row → UI shape. */
function sheetRowToEntry(
  raw: RawAuditLogEntry,
  index: number,
  nameLookup: Map<string, string>,
): UiAuditLogEntry {
  const successStr = (raw["Success"] || "Yes").trim().toLowerCase();
  const hrsId = (raw["Target ID"] || "").trim() || null;
  return {
    id: index,
    action: normaliseAction(raw["Action Type"] || ""),
    actionLabel: (raw["Action"] || "").trim(),
    targetId: hrsId,
    targetName: hrsId ? (nameLookup.get(hrsId) ?? null) : null,
    details: parseDetails(raw["Details"]),
    success: successStr !== "no",
    createdAt: parseSheetTimestamp(raw["Timestamp"]),
  };
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
  list: publicProcedure.input(listInput).query(async ({ input }) => {
    const { limit = 50, offset = 0, action, search } = input;
    // Top up the read cache so HRS-ID → name resolution works on cold
    // serverless instances (no-op when the cache is already fresh).
    await ensureFreshCache();
    const nameLookup = buildNameLookup();

    /* ----- Read from cached audit logs (refreshed every 30s) ----- */
    await ensureFreshAuditCache();
    const rawLogs = getCachedAuditLogs();
    if (!rawLogs.length) {
      return { logs: [] as UiAuditLogEntry[], total: 0 };
    }

    let entries = rawLogs
      .map((row, i) => sheetRowToEntry(row, i, nameLookup))
      // Skip junk rows (header row, fully blank rows).
      .filter((e) => e.action !== "" || e.actionLabel !== "" || e.details !== null)
      // Only show profile updates / verifications / donations in the UI.
      .filter((e) => VISIBLE_ACTIONS.has(e.action));

    // Apply action filter (normalised dot-notation).
    if (action && action !== "all") {
      entries = entries.filter((e) => e.action === action);
    }

    // Apply search filter.
    if (search && search.trim()) {
      const lower = search.trim().toLowerCase();
      entries = entries.filter((e) => {
        const fields = [e.targetId, e.targetName, e.actionLabel, e.action];
        return fields.some((f) => f && f.toLowerCase().includes(lower));
      });
    }

    // Newest first — sheet rows are appended oldest→newest, so the UI shows
    // recent audits on top and older ones further down.
    entries.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const total = entries.length;
    const page = entries.slice(offset, offset + limit);

    return { logs: page, total };
  }),

  /**
   * Clear all audit log entries from the Google Sheets "Audit Log" tab.
   * The Apps Script `clear_audit` action handles the actual deletion.
   */
  clear: publicProcedure.mutation(async () => {
    const result = await clearSheetAuditLogs();
    const removed = result.success && result.data ? result.data.removed : 0;
    // The sheet takes 10–40 s to reflect the clear; bust the read cache so
    // the next `list` re-reads the CSV instead of serving stale entries for
    // up to the TTL.
    invalidateAuditCache();
    return { success: result.success, removed };
  }),
});
