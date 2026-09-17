/**
 * Staff Credential Cache
 *
 * Keeps Volunteer + Admin tab credentials in memory so that login requests
 * resolve instantly. Reads come from the published Google Sheet CSV export
 * (`fetchCsvTab` — fast, no Apps Script); only writes touch the Apps Script
 * API.
 *
 * On long-running Node servers the cache auto-refreshes in the background.
 * On Vercel serverless every cold instance gets a stale-while-revalidate
 * pattern: the first login after a cold start may still be slow, but
 * subsequent calls within the same instance lifetime are instant.
 *
 * Cache TTL: 60 s (configurable).
 */
import { fetchCsvTab } from "./googleSheetsApi";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface CachedVolunteer {
  username: string;
  displayName: string;
  passwordHash: string;
  mobile: string;
}

export interface CachedAdmin {
  username: string;
  displayName: string;
  /** Admin passwords are stored in plaintext in the sheet. */
  password: string;
}

/* ------------------------------------------------------------------ */
/* In-memory state                                                     */
/* ------------------------------------------------------------------ */

let volunteerCache: Map<string, CachedVolunteer> = new Map();
let adminCache: Map<string, CachedAdmin> = new Map();
let cacheUpdatedAt = 0;
const CACHE_TTL_MS = 60_000; // 60 seconds

let refreshPromise: Promise<void> | null = null; // dedup concurrent refreshes

/* ------------------------------------------------------------------ */
/* Cache internals                                                     */
/* ------------------------------------------------------------------ */

async function doRefresh(): Promise<void> {
  // Fetch both tabs from the published CSV in parallel (fast, no Apps Script).
  const [volRes, adminRes] = await Promise.all([
    fetchCsvTab("volunteer", 30_000),
    fetchCsvTab("admin", 30_000),
  ]);

  // --- Volunteers ---
  if (volRes.success) {
    const map = new Map<string, CachedVolunteer>();
    for (const row of volRes.data) {
      const uname = (row.Username || row.username || "").trim();
      if (!uname) continue;
      map.set(uname.toLowerCase(), {
        username: uname,
        displayName:
          (row["Full Name"] || row.fullName || row.Name || row.name) || uname,
        passwordHash: row.Password || row.password || "",
        mobile: (row.Mobile || row.mobile || row["Phone Number"] || row.phone || "").trim(),
      });
    }
    volunteerCache = map;
    console.log(
      `[StaffCredentialCache] Refreshed ${map.size} volunteer(s) from CSV`
    );
  } else {
    console.warn(
      `[StaffCredentialCache] Volunteer CSV refresh failed — keeping stale cache (${volunteerCache.size} entries). Error: ${volRes.error}`
    );
  }

  // --- Admins ---
  if (adminRes.success) {
    const map = new Map<string, CachedAdmin>();
    for (const row of adminRes.data) {
      const uname = (row.Username || row.username || "").trim();
      if (!uname) continue;
      map.set(uname.toLowerCase(), {
        username: uname,
        displayName: (row.Name || row.name) || uname,
        password: row.Password || row.password || "",
      });
    }
    adminCache = map;
    console.log(
      `[StaffCredentialCache] Refreshed ${map.size} admin(s) from CSV`
    );
  } else {
    console.warn(
      `[StaffCredentialCache] Admin CSV refresh failed — keeping stale cache (${adminCache.size} entries). Error: ${adminRes.error}`
    );
  }

  cacheUpdatedAt = Date.now();
}

/**
 * Ensure the credential cache is reasonably fresh.
 * Returns immediately if the cache is within TTL (unless `force` is true).
 * Deduplicates concurrent refresh calls.
 */
export async function ensureFreshStaffCache(force = false): Promise<void> {
  if (!force && Date.now() - cacheUpdatedAt < CACHE_TTL_MS) return;
  if (refreshPromise) return refreshPromise;
  refreshPromise = doRefresh().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

/* ------------------------------------------------------------------ */
/* Public lookup helpers                                               */
/* ------------------------------------------------------------------ */

/** Look up a volunteer by username (case-insensitive). Returns null if not cached. */
export function findVolunteerFromCache(
  username: string
): CachedVolunteer | null {
  return volunteerCache.get(username.trim().toLowerCase()) ?? null;
}

/** Look up an admin by username (case-insensitive). Returns null if not cached. */
export function findAdminFromCache(username: string): CachedAdmin | null {
  return adminCache.get(username.trim().toLowerCase()) ?? null;
}

/** Return all cached volunteers (for staff.list). */
export function listVolunteersFromCache(): CachedVolunteer[] {
  return Array.from(volunteerCache.values());
}

/** Count cached admins (for the last-admin delete guard). */
export function adminCountFromCache(): number {
  return adminCache.size;
}

/** Diagnostic — how many entries are cached and when last refreshed. */
export function staffCacheStats() {
  return {
    volunteers: volunteerCache.size,
    admins: adminCache.size,
    cacheUpdatedAt: cacheUpdatedAt ? new Date(cacheUpdatedAt).toISOString() : null,
    ttlMs: CACHE_TTL_MS,
    ageMs: cacheUpdatedAt ? Date.now() - cacheUpdatedAt : Infinity,
  };
}
