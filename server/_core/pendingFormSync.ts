/**
 * Pending Google Form → Profiles auto-sync
 *
 * Reads new donor submissions from a separate Google Sheet (fed by a Google
 * Form), maps their fields to the main Profiles tab schema, and appends
 * each new record via the Apps Script `import_profile` action.
 *
 * Runs as a background job every SYNC_INTERVAL_MS (default 5 minutes).
 * Deduplication is phone-number-based: if the pending record's phone number
 * (after stripping the "91" country-code prefix) already exists in the
 * main sheet's profiles, it is skipped.
 *
 * The sync is single-threaded — if a tick is still running when the next
 * interval fires, the new tick is skipped to prevent duplicate imports.
 */
import { ENV } from "./env";
import { importProfile } from "./googleAppsScriptApi";
import {
  getCachedProfiles,
  ensureFreshCache,
  invalidateProfileCache,
} from "./googleSheetsApi";
import type { Profile } from "./googleSheetsApi";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 0o1_000; // 5 minutes
let SYNC_INTERVAL_MS = DEFAULT_SYNC_INTERVAL_MS;

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncRunning = false;
let syncEnabled = false;

// Track imported submission IDs in-memory so we don't re-import within the
// same process lifetime.  (Vercel serverless instances are ephemeral, but
// dedup is also enforced by phone-number check against the main sheet.)
const importedIds = new Set<string>();

// ---------------------------------------------------------------------------
// Pending-sheet CSV reader (separate spreadsheet)
// ---------------------------------------------------------------------------

/**
 * Read all rows from the pending Google Form sheet.
 * The pending sheet lives in a DIFFERENT spreadsheet, so it has its own
 * published CSV URL (ENV.pendingGoogleSheetsCsvUrl).
 */
async function fetchPendingRecords(): Promise<{
  success: boolean;
  data: Record<string, string>[];
  error?: string;
}> {
  const csvUrl = ENV.pendingGoogleSheetsCsvUrl;
  if (!csvUrl) {
    return { success: false, data: [], error: "No pending sheet CSV URL configured" };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    let response: globalThis.Response;
    try {
      response = await fetch(csvUrl, { cache: "no-store", signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      return { success: false, data: [], error: `HTTP ${response.status}` };
    }

    const text = await response.text();
    const rows = parseCsv(text);
    if (rows.length < 2) return { success: true, data: [] };

    const headers = rows[0]!;
    const out: Record<string, string>[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      if (row.every((c) => !c.trim())) continue;
      const obj: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        obj[headers[j]!] = row[j] ?? "";
      }
      out.push(obj);
    }
    return { success: true, data: out };
  } catch (err) {
    return {
      success: false,
      data: [],
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

// ---------------------------------------------------------------------------
// Minimal CSV parser (handles quoted fields with commas/newlines)
// ---------------------------------------------------------------------------

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        cells.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  cells.push(current);
  return cells;
}

function parseCsv(text: string): string[][] {
  const lines: string[] = [];
  let buf = "";
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      buf += ch;
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (buf.trim()) lines.push(buf);
      buf = "";
      if (ch === "\r") continue; // skip \r in \r\n
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) lines.push(buf);
  return lines.map(parseCsvLine);
}

// ---------------------------------------------------------------------------
// Field mapping: Pending Form → Profile
// ---------------------------------------------------------------------------

/**
 * Strip a leading "91" country-code prefix if the number is ≥12 digits.
 * India numbers are 10 digits; with 91 prefix they become 12.
 */
function stripCountryCode(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("91")) {
    return digits.slice(2);
  }
  return digits;
}

/**
 * Map a pending Google Form row to a main-sheet Profile row.
 *
 * Form columns → Profile columns:
 *   Submission time                  → Registration Time
 *   Full Name                        → Full Name
 *   Date of Birth                    → Date of Birth
 *   Gender                           → Gender
 *   Phone number                     → Phone Number (strip 91 prefix)
 *   Email                            → Email
 *   City                             → City
 *   Area / Locality                  → Area
 *   ConsentI agree to provide...     → Data Storage Consent (TRUE→YES, FALSE→NO)
 *   Submission ID                    → skipped
 *
 * The remaining profile columns get sensible defaults for a newly-imported
 * record that has not yet been verified.
 */
function mapFormToProfile(
  formRow: Record<string, string>,
  hrsId: string
): Record<string, string> {
  const consentRaw = (
    formRow["ConsentI agree to provide my information for the purpose of HRS Blood Grouping Camp registration and record keeping."] ??
    formRow["Consent"] ??
    ""
  ).trim();

  const dataStorageConsent =
    consentRaw.toUpperCase() === "TRUE" ? "YES" : consentRaw.toUpperCase() === "FALSE" ? "NO" : consentRaw || "NO";

  return {
    "HRS ID": hrsId,
    "Full Name": formRow["Full Name"] ?? "",
    "Date of Birth": formRow["Date of Birth"] ?? "",
    "Gender": formRow["Gender"] ?? "",
    "Phone Number": stripCountryCode(formRow["Phone number"] ?? ""),
    "Email": formRow["Email"] ?? "",
    "City": formRow["City"] ?? "",
    "Area": formRow["Area / Locality"] ?? "",
    "Registration Time": formRow["Submission time"] ?? "",
    "Blood Group": "",
    "Blood Group Status": "",
    "Data Storage Consent": dataStorageConsent,
    "Donor Consent": "YES",
    "Verification Status": "PENDING",
    "Verification Time": "",
    "Blood Donation Count": "0",
    "Last Donation Time": "",
    "Next Eligible Time": "",
    "Availability Status": "AVAILABLE",
    "Public Directory Visibility": "YES",
  };
}

// ---------------------------------------------------------------------------
// Deduplication helper
// ---------------------------------------------------------------------------

/**
 * Check if a phone number (already stripped of country code) already exists in
 * the main sheet's cached profiles.
 */
function phoneExistsInProfiles(phone: string, profiles: Profile[]): boolean {
  return profiles.some((p) => {
    const existing = (p["Phone Number"] ?? "").replace(/\D/g, "");
    return existing === phone;
  });
}

// ---------------------------------------------------------------------------
// Next HRS ID generator
// ---------------------------------------------------------------------------

function computeNextHrsId(profiles: Profile[]): string {
  let max = 10000;
  for (const p of profiles) {
    const id = p["HRS ID"] ?? "";
    const match = id.match(/^HRS-(\d+)$/);
    if (match) {
      const num = parseInt(match[1]!, 10);
      if (num > max) max = num;
    }
  }
  return `HRS-${max + 1}`;
}

// ---------------------------------------------------------------------------
// Sync tick
// ---------------------------------------------------------------------------

async function syncTick(): Promise<{
  imported: number;
  skipped: number;
  errors: string[];
}> {
  const stats = { imported: 0, skipped: 0, errors: [] as string[] };

  // 1. Ensure the main-profiles cache is fresh so we can dedup against it.
  await ensureFreshCache();
  const profilesResp = getCachedProfiles();
  const profiles: Profile[] = profilesResp.data?.profiles ?? [];

  // 2. Read the pending form sheet.
  const pending = await fetchPendingRecords();
  if (!pending.success) {
    stats.errors.push(`Failed to read pending sheet: ${pending.error}`);
    return stats;
  }
  if (!pending.data.length) {
    return stats; // nothing to import
  }

  // 3. Compute the next HRS ID starting point.
  let nextId = computeNextHrsId(profiles);

  // 4. Process each pending record.
  for (const row of pending.data) {
    const submissionId = row["Submission ID"] ?? "";

    // Skip already-imported (in-memory dedup for this process lifetime)
    if (submissionId && importedIds.has(submissionId)) {
      stats.skipped++;
      continue;
    }

    // Strip phone and dedup against main sheet.
    const phone = stripCountryCode(row["Phone number"] ?? "");
    if (!phone) {
      stats.errors.push(`Skipping record with no phone number (Submission ID: ${submissionId})`);
      stats.skipped++;
      continue;
    }
    if (phoneExistsInProfiles(phone, profiles)) {
      // Already in the main sheet — mark as imported so we skip next time.
      if (submissionId) importedIds.add(submissionId);
      stats.skipped++;
      continue;
    }

    // Map fields and write to the main sheet.
    const profile = mapFormToProfile(row, nextId);
    const usedId = nextId; // snapshot before advancing
    const result = await importProfile(profile);

    // Always advance the HRS ID counter (even on failure) to prevent ID collisions
    // when a transient error causes a retry on a subsequent record.
    const num = parseInt(nextId.replace("HRS-", ""), 10);
    nextId = `HRS-${num + 1}`;

    if (result.success) {
      stats.imported++;
      if (submissionId) importedIds.add(submissionId);
      // Inject into the local profiles array so same-batch phone dedup works.
      profiles.push({ "HRS ID": usedId, "Phone Number": phone });
    } else {
      stats.errors.push(
        `Failed to import ${usedId} (${row["Full Name"] ?? "unknown"}): ${result.error}`
      );
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Background scheduler (local server) + lazy trigger (Vercel serverless)
// ---------------------------------------------------------------------------

async function runSyncLoop(): Promise<void> {
  if (!syncEnabled) return;
  if (syncRunning) {
    // Previous tick still running — skip this one.
    syncTimer = setTimeout(runSyncLoop, SYNC_INTERVAL_MS);
    return;
  }

  syncRunning = true;
  try {
    const stats = await syncTick();
    if (stats.imported > 0 || stats.errors.length) {
      console.log(
        `[PendingFormSync] Imported: ${stats.imported}, Skipped: ${stats.skipped}, Errors: ${stats.errors.length}`
      );
      if (stats.errors.length) {
        for (const e of stats.errors) console.warn(`[PendingFormSync]   ${e}`);
      }
    }
  } catch (err) {
    console.error("[PendingFormSync] Unexpected error:", err);
  } finally {
    syncRunning = false;
    if (syncEnabled) {
      syncTimer = setTimeout(runSyncLoop, SYNC_INTERVAL_MS);
    }
  }
}

// ---------------------------------------------------------------------------
// Lazy sync for Vercel serverless (piggy-backed on ensureFreshCache)
// ---------------------------------------------------------------------------

/** Timestamp of the last lazy sync attempt (process-lifetime). */
let lastLazySyncAt = 0;

/**
 * Pending-form sync that piggy-backs on the read-path cache refresh
 * (`ensureFreshCache`).  On Vercel there is no long-running background
 * loop, so this is the mechanism that imports new form submissions.
 * Called from `ensureFreshCache()` — fires on every cache refresh
 * (every ~15 seconds when the dashboard is open), and only when a sync
 * isn't already running.
 */
export async function lazyPendingFormSync(): Promise<void> {
  // Skip if the background loop already handles sync (local server).
  if (syncEnabled) return;
  // Don't stack on a manual trigger / prior tick still in flight.
  if (syncRunning) return;

  lastLazySyncAt = Date.now();
  syncRunning = true;
  try {
    const stats = await syncTick();
    if (stats.imported > 0 || stats.errors.length) {
      console.log(
        `[PendingFormSync:lazy] Imported: ${stats.imported}, Skipped: ${stats.skipped}, Errors: ${stats.errors.length}`
      );
      if (stats.errors.length) {
        for (const e of stats.errors) console.warn(`[PendingFormSync:lazy]   ${e}`);
      }
      // Force cache invalidation so the next read picks up the newly-imported
      // profiles immediately instead of waiting for the 15-second read cycle.
      if (stats.imported > 0) invalidateProfileCache();
    }
  } catch (err) {
    console.error("[PendingFormSync:lazy] Unexpected error:", err);
  } finally {
    syncRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the pending-form auto-sync background job.
 * Safe to call multiple subsequent times — only the first call activates.
 * On Vercel serverless this is NOT used — see lazyPendingFormSync() instead.
 */
export function startPendingFormSync(intervalMs?: number): void {
  if (syncEnabled) return;
  if (intervalMs && intervalMs > 0) SYNC_INTERVAL_MS = intervalMs;
  syncEnabled = true;
  console.log(
    `[PendingFormSync] Starting auto-sync every ${SYNC_INTERVAL_MS / 1000}s`
  );
  // Fire the first tick after a short delay so the main profile cache has
  // time to populate on startup.
  syncTimer = setTimeout(runSyncLoop, 15_000);
}

/** Stop the auto-sync loop. */
export function stopPendingFormSync(): void {
  syncEnabled = false;
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
}

/** Manually trigger one sync tick (for admin "Sync Now" button). */
export async function triggerPendingFormSync(): Promise<{
  imported: number;
  skipped: number;
  errors: string[];
}> {
  return syncTick();
}

/** Return current sync status for the admin diagnostics panel. */
export function getPendingFormSyncStatus(): {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  importedCount: number;
} {
  return {
    enabled: syncEnabled || lastLazySyncAt > 0, // show enabled when lazy sync is active
    running: syncRunning,
    intervalMs: syncEnabled ? SYNC_INTERVAL_MS : 15_000,
    importedCount: importedIds.size,
  };
}
