/**
 * Pending Google Form → Profiles auto-sync (Supabase edition)
 *
 * Faithful port of the Sheets-era pendingFormSync: reads new donor
 * submissions from the published Google Form spreadsheet CSV, maps their
 * fields to the profiles schema, and appends each new record to the Supabase
 * `profiles` table as a PENDING record awaiting admin verification.
 *
 * Field mapping and dedup are unchanged from the original:
 *   - Phone numbers lose the leading "91" country-code prefix (≥12 digits)
 *   - Dedup is phone-number-based, both against Supabase profiles and
 *     within a single run
 *   - Consent TRUE/FALSE → YES/NO → Data Storage Consent
 *   - Submission time → Registration Time; Submission ID is skipped
 *
 * Deliberate adaptation to the restored pending flow: new rows are written
 * with Availability PENDING and Public Directory Visibility NO (the Sheets
 * original wrote AVAILABLE/YES because its public read filtered on
 * verification anyway). Here the hidden-until-verified rule is enforced at
 * the row level.
 *
 * Runs as a background job every SYNC_INTERVAL_MS (default 5 minutes) on
 * long-lived processes (local dev). On Vercel serverless there are no
 * persistent timers — exactly like the original — so the import is
 * triggered on-demand via the admin `syncPendingForms` procedure.
 * The sync is single-threaded: a tick still running when the next fires
 * is skipped.
 */

import { ENV } from "./env";
import { supabase, invalidateProfilesSnapshot } from "./supabaseApi";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1_000; // 5 minutes
let SYNC_INTERVAL_MS = DEFAULT_SYNC_INTERVAL_MS;

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncRunning = false;
let syncEnabled = false;

export interface PendingSyncResult {
  imported: number;
  skipped: number;
  errors: string[];
  lastRun: string | null;
}

let lastRunResult: PendingSyncResult = {
  imported: 0,
  skipped: 0,
  errors: [],
  lastRun: null,
};

/** Status of the last (or current) sync run — for the admin Settings view. */
export function getPendingFormStatus(): PendingSyncResult & { running: boolean } {
  return { ...lastRunResult, running: syncRunning };
}

// ---------------------------------------------------------------------------
// CSV parsing (identical to the original implementation)
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
// Pending-sheet CSV reader (separate spreadsheet, read-only)
// ---------------------------------------------------------------------------

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
// Field mapping: Pending Form → Profile (unchanged from the original)
// ---------------------------------------------------------------------------

/** Strip a leading "91" country-code prefix when the number is ≥12 digits. */
function stripCountryCode(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("91")) {
    return digits.slice(2);
  }
  return digits;
}

const CONSENT_COLUMN =
  "ConsentI agree to provide my information for the purpose of HRS Blood Grouping Camp registration and record keeping.";

/** Legacy spellings → the official district names used by the dropdowns. */
const CITY_MAP: Record<string, string> = {
  tumkur: "Tumakuru",
  bangalore: "Bengaluru Urban",
  "bangalore urban": "Bengaluru Urban",
  bengaluru: "Bengaluru Urban",
  mysore: "Mysuru",
};

function mapFormToProfile(formRow: Record<string, string>, hrsId: string) {
  const consentRaw = (formRow[CONSENT_COLUMN] ?? formRow["Consent"] ?? "").trim();
  const dataStorageConsent =
    consentRaw.toUpperCase() === "TRUE"
      ? "YES"
      : consentRaw.toUpperCase() === "FALSE"
        ? "NO"
        : consentRaw || "NO";

  const cityRaw = (formRow["City"] ?? "").trim();
  const city = CITY_MAP[cityRaw.toLowerCase()] ?? cityRaw;

  const submitted = (formRow["Submission time"] ?? "").trim();
  const registrationTime = submitted
    ? submitted.replace(" ", "T") + "+05:30"
    : new Date().toISOString();

  return {
    "HRS ID": hrsId,
    "Full Name": (formRow["Full Name"] ?? "").trim(),
    "Date of Birth": formRow["Date of Birth"] || null,
    gender: formRow["Gender"] || null,
    "Phone Number": stripCountryCode(formRow["Phone number"] ?? ""),
    email: formRow["Email"] || null,
    city: city || null,
    area: (formRow["Area / Locality"] ?? "").trim() || null,
    "Registration Time": registrationTime,
    "Blood Group": "",
    "Blood Group Status": "",
    "Data Storage Consent": dataStorageConsent,
    // The form has a single consent checkbox (storage). Donor consent starts
    // YES exactly like the original mapping; the verifying admin confirms or
    // overrides it in the verify dialog.
    "Donor Consent": "YES",
    "Verification Status": "PENDING",
    "Verification Time": null,
    "Blood Donation Count": "0",
    "Last Donation Time": null,
    "Next Eligible Time": null,
    // Hidden until verified — see module docblock.
    "Availability Status": "PENDING",
    "Public Directory Visibility": "NO",
  };
}

// ---------------------------------------------------------------------------
// Next HRS ID
// ---------------------------------------------------------------------------

async function computeNextHrsId(): Promise<string> {
  const { data, error } = await supabase.from("profiles").select('"HRS ID"');
  if (error) throw error;
  let max = 0;
  for (const row of data ?? []) {
    const match = String(row["HRS ID"] ?? "").match(/^HRS-(\d+)$/);
    if (match) {
      const num = parseInt(match[1]!, 10);
      if (num > max) max = num;
    }
  }
  return `HRS-${String(max + 1).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Sync tick
// ---------------------------------------------------------------------------

export async function runPendingFormSync(): Promise<PendingSyncResult> {
  if (syncRunning) return lastRunResult; // single-threaded, like the original
  syncRunning = true;

  const result: PendingSyncResult = {
    imported: 0,
    skipped: 0,
    errors: [],
    lastRun: new Date().toISOString(),
  };

  try {
    const fetchResult = await fetchPendingRecords();
    if (!fetchResult.success) {
      result.errors.push(fetchResult.error ?? "Failed to fetch pending sheet");
      return result;
    }

    // Dedup within the run by phone (keep the earliest submission), exactly
    // like the original's phone-based dedup.
    const byPhone = new Map<string, Record<string, string>>();
    for (const row of fetchResult.data) {
      const phone = stripCountryCode(row["Phone number"] ?? "");
      const name = (row["Full Name"] ?? "").trim();
      if (!phone || !name) {
        result.skipped += 1;
        continue;
      }
      const prev = byPhone.get(phone);
      if (!prev || (row["Submission time"] ?? "") < (prev["Submission time"] ?? "")) {
        byPhone.set(phone, row);
      }
    }

    // Phones already in Supabase
    const { data: existing, error: existingError } = await supabase
      .from("profiles")
      .select('"HRS ID", "Phone Number"');
    if (existingError) {
      result.errors.push(existingError.message);
      return result;
    }
    const existingPhones = new Set(
      (existing ?? []).map((r) =>
        String(r["Phone Number"] ?? "").replace(/\D/g, "")
      )
    );

    const pendingRows = Array.from(byPhone.entries());
    for (const [phone, row] of pendingRows) {
      if (existingPhones.has(phone)) {
        result.skipped += 1;
        continue;
      }

      try {
        const hrsId = await computeNextHrsId();
        const profile = mapFormToProfile(row, hrsId);
        const { error } = await supabase.from("profiles").insert(profile);
        if (error) throw error;
        existingPhones.add(phone);
        result.imported += 1;
      } catch (err) {
        result.errors.push(
          `${(row["Full Name"] ?? "unknown").trim()}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    if (result.imported > 0) invalidateProfilesSnapshot();
    return result;
  } finally {
    lastRunResult = result;
    syncRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Auto-sync loop (long-lived processes only — no timers on serverless)
// ---------------------------------------------------------------------------

export function startPendingFormSync(intervalMs?: number): void {
  if (syncEnabled) return;
  if (intervalMs && intervalMs > 0) SYNC_INTERVAL_MS = intervalMs;
  syncEnabled = true;
  console.log(
    `[PendingFormSync] Starting auto-sync every ${SYNC_INTERVAL_MS / 1000}s`
  );
  // Fire the first tick after a short delay so boot is not blocked.
  syncTimer = setTimeout(runSyncLoop, 15_000);
}

async function runSyncLoop(): Promise<void> {
  if (!syncEnabled) return;
  try {
    const result = await runPendingFormSync();
    if (result.imported > 0 || result.errors.length > 0) {
      console.log(
        `[PendingFormSync] imported=${result.imported} skipped=${result.skipped} errors=${result.errors.length}`
      );
    }
  } catch (err) {
    console.error("[PendingFormSync] tick failed:", err);
  }
  if (syncEnabled) {
    syncTimer = setTimeout(runSyncLoop, SYNC_INTERVAL_MS);
  }
}

export function stopPendingFormSync(): void {
  syncEnabled = false;
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
}
