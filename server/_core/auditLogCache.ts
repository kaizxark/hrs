/**
 * Audit Log Cache
 *
 * Keeps audit log entries in memory so that the admin Audit Log panel and
 * Staff & Access section load instantly. Reads now come from the published
 * Google Sheet CSV export (`fetchCsvTab` — fast, no Apps Script); only
 * writes touch the Apps Script API.
 *
 * Same stale-while-revalidate pattern as the profile and staff credential
 * caches: TTL 30 s, deduped concurrent refreshes.
 */
import { fetchCsvTab } from "./googleSheetsApi";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Raw shape of an audit-log row (sheet CSV columns). */
export interface RawAuditLogEntry {
  Timestamp?: string;
  "Action Type"?: string;
  Action?: string;
  "Actor Name"?: string;
  "Actor Role"?: string;
  "Actor OpenID"?: string;
  "Target Type"?: string;
  "Target ID"?: string;
  Details?: string;
  Success?: string;
  "IP Address"?: string;
  // Index signature so the CSV-keyed objects are assignable.
  [key: string]: string | undefined;
}

/* ------------------------------------------------------------------ */
/* In-memory state                                                     */
/* ------------------------------------------------------------------ */

let cachedAuditLogs: RawAuditLogEntry[] = [];
let cacheUpdatedAt = 0;
const CACHE_TTL_MS = 10_000; // 10 seconds — keeps the audit panel near real time
const MAX_ROWS = 2000;

let refreshPromise: Promise<void> | null = null;

/* ------------------------------------------------------------------ */
/* Cache internals                                                     */
/* ------------------------------------------------------------------ */

async function doRefresh(): Promise<void> {
  try {
    const res = await fetchCsvTab("audit", 30_000);
    if (res.success) {
      // CSV keys match the sheet header row; cast directly.
      cachedAuditLogs = res.data.slice(0, MAX_ROWS) as RawAuditLogEntry[];
      console.log(
        `[AuditLogCache] Refreshed ${cachedAuditLogs.length} audit log entries from CSV`
      );
    } else {
      console.warn(
        `[AuditLogCache] CSV refresh failed — keeping stale cache (${cachedAuditLogs.length} entries). Error: ${res.error}`
      );
    }
  } catch (err: unknown) {
    console.error(
      "[AuditLogCache] Refresh threw:",
      (err as Error)?.message ?? err
    );
  }
  cacheUpdatedAt = Date.now();
}

/**
 * Ensure the audit log cache is reasonably fresh.
 * Returns immediately if the cache is within TTL.
 */
export async function ensureFreshAuditCache(): Promise<void> {
  if (Date.now() - cacheUpdatedAt < CACHE_TTL_MS) return;
  if (refreshPromise) return refreshPromise;
  refreshPromise = doRefresh().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

/* ------------------------------------------------------------------ */
/* Public helpers                                                      */
/* ------------------------------------------------------------------ */

/** Get all cached audit log entries. */
export function getCachedAuditLogs(): RawAuditLogEntry[] {
  return cachedAuditLogs;
}

/** Diagnostic stats for admin panel. */
export function auditCacheStats() {
  return {
    count: cachedAuditLogs.length,
    cacheUpdatedAt: cacheUpdatedAt
      ? new Date(cacheUpdatedAt).toISOString()
      : null,
    ttlMs: CACHE_TTL_MS,
    ageMs: cacheUpdatedAt ? Date.now() - cacheUpdatedAt : Infinity,
  };
}

/**
 * Force the next `list` read to re-fetch from the CSV instead of serving
 * the in-memory copy. Called right after a clear so the cleared sheet state
 * is picked up immediately rather than waiting out the TTL.
 */
export function invalidateAuditCache(): void {
  cacheUpdatedAt = 0;
}
