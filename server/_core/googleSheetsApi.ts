/**
 * Google Sheets CSV API Service
 * Reads the HRS donor directory directly from the publicly-shared Google Sheet CSV.
 * Much faster than the Apps Script endpoint (~3.5s vs 10–44s).
 *
 * Background poll every 15 seconds keeps the in-memory cache fresh.
 * Mutations (verify, recordDonation, delete) still go through Apps Script.
 */
import { ENV } from "./env";
import { buildXlsx } from "./xlsxWriter";

// -------------------------------------------------------------------------- //
// Types
// -------------------------------------------------------------------------- //

export interface Profile {
  "HRS ID"?: string;
  "Full Name"?: string;
  "Date of Birth"?: string;
  "Gender"?: string;
  "Phone Number"?: string;
  Email?: string;
  City?: string;
  Area?: string;
  "Registration Time"?: string;
  "Blood Group"?: string;
  "Blood Group Status"?: string;
  "Data Storage Consent"?: string;
  "Donor Consent"?: string;
  "Verification Status"?: string;
  "Verification Time"?: string;
  "Blood Donation Count"?: string;
  "Last Donation Time"?: string;
  "Next Eligible Time"?: string;
  "Availability Status"?: string;
  "Public Directory Visibility"?: string;
  [key: string]: string | undefined;
}

export interface ProfilesResponse {
  profiles: Profile[];
  count: number;
}

export interface PublicProfile {
  "HRS ID": string;
  "Full Name": string;
  "Blood Group": string;
  City: string;
  Area: string;
  "Last Donation Time"?: string;
  "Availability Status"?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface Statistics {
  totalProfiles: number;
  verifiedProfiles: number;
  pendingProfiles: number;
  donorConsentYes: number;
  donorConsentNo: number;
  bloodGroupCounts: Record<string, number>;
  cityCounts: Record<string, number>;
  availabilityCounts: {
    available: number;
    temporarilyUnavailable: number;
    notParticipating: number;
    pending: number;
  };
  donationCounts: {
    total: number;
    average: number;
  };
}

// -------------------------------------------------------------------------- //
// In-memory cache
// -------------------------------------------------------------------------- //

let cachedProfiles: Profile[] = [];
let cachedAt: number | null = null;

// The background poller is fully controllable at runtime so the admin
// "Sync & Data" panel can genuinely start/stop auto-sync and change how often
// the directory is refreshed — not merely restyle a client-side timer.
let isPolling = false;            // poller has been started at least once
let pollRunning = false;          // whether polling ticks are currently scheduled
let pollTimer: ReturnType<typeof setTimeout> | null = null;

const DEFAULT_POLL_INTERVAL_MS = 10_000;
let POLL_INTERVAL_MS = DEFAULT_POLL_INTERVAL_MS;

// -------------------------------------------------------------------------- //
// Sync health counters — surfaced in the admin "Sync & Data" view.
// In-memory only; resets on restart, which is acceptable for live diagnostics.
// -------------------------------------------------------------------------- //
interface SyncStats {
  attempts: number;
  successes: number;
  failures: number;
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  /** Whether the background poller is currently ticking. */
  running: boolean;
  /** The current poll interval in ms (falls back to default if 0/undefined). */
  currentIntervalMs: number;
  // Rolling window of recent latencies (ms), capped for memory.
  recentLatencies: number[];
  /** Timestamp of the last successful *parse* of the CSV (records loaded). */
  lastLoadedAt: number | null;
}

const syncStats: SyncStats = {
  attempts: 0,
  successes: 0,
  failures: 0,
  lastStatus: null,
  lastError: null,
  lastSuccessAt: null,
  lastAttemptAt: null,
  recentLatencies: [],
  lastLoadedAt: null,
  running: true,
  currentIntervalMs: DEFAULT_POLL_INTERVAL_MS,
};

const MAX_LATENCY_SAMPLES = 60;

function recordSyncResult(
  startedAt: number,
  ok: boolean,
  error?: string | null,
) {
  syncStats.attempts += 1;
  const latency = Date.now() - startedAt;
  syncStats.recentLatencies.push(latency);
  if (syncStats.recentLatencies.length > MAX_LATENCY_SAMPLES) {
    syncStats.recentLatencies.shift();
  }
  syncStats.lastAttemptAt = Date.now();
  syncStats.lastStatus = ok ? "ok" : "error";
  if (ok) {
    syncStats.successes += 1;
    syncStats.lastSuccessAt = Date.now();
    syncStats.lastError = null;
    syncStats.lastLoadedAt = Date.now();
  } else {
    syncStats.failures += 1;
    syncStats.lastError = error ?? "Unknown error";
  }
}

/** Aggregate diagnostics for the admin panel. */
export function getSyncStats() {
  const samples = syncStats.recentLatencies;
  const avg =
    samples.length > 0
      ? Math.round(
          samples.reduce((sum, v) => sum + v, 0) / samples.length,
        )
      : null;
  const max = samples.length > 0 ? Math.max(...samples) : null;
  const min = samples.length > 0 ? Math.min(...samples) : null;
  const successRate =
    syncStats.attempts > 0
      ? Math.round((syncStats.successes / syncStats.attempts) * 100)
      : null;
  return {
    attempts: syncStats.attempts,
    successes: syncStats.successes,
    failures: syncStats.failures,
    lastStatus: syncStats.lastStatus,
    lastError: syncStats.lastError,
    lastSuccessAt: syncStats.lastSuccessAt,
    lastAttemptAt: syncStats.lastAttemptAt,
    lastLoadedAt: syncStats.lastLoadedAt,
    avgLatencyMs: avg,
    minLatencyMs: min,
    maxLatencyMs: max,
    successRate,
    running: pollRunning,
    pollIntervalMs: POLL_INTERVAL_MS,
    currentIntervalMs: POLL_INTERVAL_MS,
    cachedRecordCount: cachedAt ? cachedProfiles.length : 0,
    cachedAt: cachedAt
      ? new Date(cachedAt).toISOString()
      : null,
  };
}

// -------------------------------------------------------------------------- //
// CSV parsing
// -------------------------------------------------------------------------- //

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += ch;
    }
  }
  values.push(value.trim());
  return values;
}

function parseCsv(text: string): string[][] {
  return text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter(row => row.trim())
    .map(parseCsvLine);
}

// -------------------------------------------------------------------------- //
// Fetch & parse
// -------------------------------------------------------------------------- //

async function fetchProfilesFromSheet(): Promise<ApiResponse<ProfilesResponse>> {
  const csvUrl =
    process.env.GOOGLE_SHEETS_CSV_URL ??
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTI9MNntfRcNQsCJCPBhNIbsc-ZCh5kqw28-x7Aa3kfeUwBCXDd7TPAt2pb6ag8HWdwkcpgsqeSKQmF/pub?output=csv";

  try {
    const response = await fetch(csvUrl, { cache: "no-store" });

    if (!response.ok) {
      return {
        success: false,
        error: `Google Sheets returned HTTP ${response.status}`,
      };
    }

    const text = await response.text();
    const rows = parseCsv(text);

    if (rows.length < 2) {
      return { success: true, data: { profiles: [], count: 0 } };
    }

    const headers = rows[0]!;
    const profiles: Profile[] = [];

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i]!;
      // Skip completely blank rows (no HRS ID)
      const hrsId = row[0]?.trim();
      if (!hrsId) continue;
      const profile: Profile = { "HRS ID": hrsId };
      for (let j = 1; j < headers.length; j += 1) {
        profile[headers[j]!] = row[j] ?? "";
      }
      // Strip the internal row number if present
      delete profile["sheet_row"];
      profiles.push(profile);
    }

    return {
      success: true,
      data: { profiles, count: profiles.length },
    };
  } catch (err) {
    console.error("[GoogleSheets] Failed to fetch CSV:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

// -------------------------------------------------------------------------- //
// Poller
// -------------------------------------------------------------------------- //

// ------------------------------------------------------------------------- //
// SSE broadcaster — notifies all connected admin clients when cache updates
// ------------------------------------------------------------------------- //
type Broadcaster = (data: string) => void;
const broadcasters = new Set<Broadcaster>();

export function addBroadcaster(fn: Broadcaster) {
  broadcasters.add(fn);
}

export function removeBroadcaster(fn: Broadcaster) {
  broadcasters.delete(fn);
}

function broadcast(payload: object) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  broadcasters.forEach(fn => {
    try { fn(data); } catch { /* client disconnected */ }
  });
}

// ------------------------------------------------------------------------- //
// Poller
// ------------------------------------------------------------------------- //

async function pollSheet() {
  const startedAt = Date.now();
  const result = await fetchProfilesFromSheet();
  if (result.success && result.data) {
    cachedProfiles = result.data.profiles;
    cachedAt = Date.now();
    recordSyncResult(startedAt, true);
    console.log(
      `[GoogleSheets] Cached ${result.data.count} profiles at ${new Date().toISOString()}`
    );
    // Track newly seen areas for auto-registration
    const areas = Array.from(new Set(cachedProfiles.map(p => p.Area).filter((a): a is string => Boolean(a))));
    markAreasSeen(areas);
    // Push update to all connected admin clients so they refetch silently
    broadcast({ type: "cache-update", count: result.data.count });
  } else {
    recordSyncResult(startedAt, false, result.error);
    console.error("[GoogleSheets] Poll failed:", result.error);
  }
}

function scheduleNextPoll() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    if (!pollRunning) return; // stop was requested while sleeping
    try {
      await pollSheet();
    } catch (err) {
      // A poll must never kill the loop — log and keep going.
      console.error("[GoogleSheets] Poll threw:", err);
      recordSyncResult(Date.now(), false, err instanceof Error ? err.message : "Poll threw");
    } finally {
      if (pollRunning) scheduleNextPoll();
    }
  }, POLL_INTERVAL_MS);
}

// Start the background poll. Called once at boot; subsequent calls are no-ops.
export async function startProfilePoller(): Promise<void> {
  if (isPolling) return;
  isPolling = true;
  pollRunning = true;

  console.log(`[GoogleSheets] Poller started — interval ${POLL_INTERVAL_MS}ms`);
  try {
    await pollSheet(); // blocking first fetch
  } catch (err) {
    console.error("[GoogleSheets] Initial poll failed:", err);
    recordSyncResult(Date.now(), false, err instanceof Error ? err.message : "Initial poll failed");
  } finally {
    if (pollRunning) scheduleNextPoll();
  }
}

/** Pause automatic polling. The in-memory cache is kept alive and manual
 *  `forceRefresh()` calls still work. */
export function stopPoller(): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  pollRunning = false;
  console.log("[GoogleSheets] Poller paused");
}

/** Resume automatic polling (idempotent — already running is a no-op).
 *  Polls immediately so re-enabling auto-sync has instant effect, then
 *  keeps the regular cadence from that point on. */
export function resumePoller(): void {
  if (pollRunning) return;
  pollRunning = true;
  console.log(`[GoogleSheets] Poller resumed — interval ${POLL_INTERVAL_MS}ms`);
  void pollSheet()
    .catch((err) => {
      console.error("[GoogleSheets] Immediate poll on resume failed:", err);
      recordSyncResult(Date.now(), false, err instanceof Error ? err.message : "Resume poll failed");
    })
    .finally(() => {
      if (pollRunning) scheduleNextPoll();
    });
}

/** Change the poll interval in ms and immediately apply it.
 *  If the poller is paused it stays paused but the new interval is remembered. */
export function setPollInterval(ms: number): void {
  POLL_INTERVAL_MS = Math.max(1_000, ms);
  console.log(`[GoogleSheets] Poll interval changed to ${POLL_INTERVAL_MS}ms`);
  // If actively polling, reschedule immediately with the new interval.
  if (pollRunning) {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      if (!pollRunning) return;
      try {
        await pollSheet();
      } catch (err) {
        console.error("[GoogleSheets] Poll threw:", err);
        recordSyncResult(Date.now(), false, err instanceof Error ? err.message : "Poll threw");
      } finally {
        if (pollRunning) scheduleNextPoll();
      }
    }, POLL_INTERVAL_MS);
  }
}

/** Read current poller state for the admin panel. */
export function getPollerState() {
  return { running: pollRunning, intervalMs: POLL_INTERVAL_MS };
}

// Force an immediate re-fetch (used by the manual Sync button).
export async function forceRefresh(): Promise<void> {
  await pollSheet();
}

// -------------------------------------------------------------------------- //
// Serverless-friendly freshness gate (Vercel)
// -------------------------------------------------------------------------- //

/**
 * How stale the in-memory cache may be before a read tops it up from Google
 * Sheets. Mirrors the local poll cadence (10-15s) so reads behave the same on
 * Vercel, where no long-running background poller exists.
 */
export const READ_FRESHNESS_MS = 15_000;

let inflightPoll: Promise<void> | null = null;

/**
 * Ensure the read cache is fresh before serving a request.
 *
 * On the long-running Node server this is a cheap no-op because the background
 * poller keeps `cachedAt` recent. On serverless (Vercel) every cold instance
 * starts with an empty cache, so the first read must perform a blocking fetch;
 * the shared `inflightPoll` promise coalesces parallel requests (e.g. several
 * tRPC queries fired by one page render) into a single CSV download.
 */
export async function ensureFreshCache(): Promise<void> {
  if (cachedAt && Date.now() - cachedAt < READ_FRESHNESS_MS) {
    return; // fresh enough — serve from memory
  }
  if (inflightPoll) {
    await inflightPoll; // another request is already topping up the cache
    return;
  }
  inflightPoll = pollSheet().finally(() => {
    inflightPoll = null;
  });
  await inflightPoll;
}

// -------------------------------------------------------------------------- //
// Public read helpers
// -------------------------------------------------------------------------- //

export function getCachedProfiles(): ApiResponse<ProfilesResponse> {
  if (!cachedAt) {
    return { success: false, error: "Profiles not loaded yet" };
  }
  return { success: true, data: { profiles: cachedProfiles, count: cachedProfiles.length } };
}

// -------------------------------------------------------------------------- //
// Data health — quality diagnostics computed from the in-memory cache.
// -------------------------------------------------------------------------- //
export interface DataHealth {
  totalRecords: number;
  verified: number;
  pending: number;
  missingHrsId: number;
  missingBloodGroup: number;
  missingMobile: number;
  missingEmail: number;
  noConsent: number;
  unavailableEligible: number;
  duplicateCount: number;
}

export function getDataHealth(): DataHealth {
  const records = cachedProfiles;
  const total = records.length;

  let verified = 0;
  let pending = 0;
  let missingHrsId = 0;
  let missingBloodGroup = 0;
  let missingMobile = 0;
  let missingEmail = 0;
  let unavailableEligible = 0;

  // Track by normalized name+phone for duplicate detection.
  const seen = new Map<string, number>();
  const dups = new Set<string>();

  for (const p of records) {
    if (!(p["HRS ID"] ?? "").trim()) missingHrsId += 1;
    const status = (p["Verification Status"] ?? "PENDING").toString().toUpperCase();
    if (status === "VERIFIED") verified += 1;
    else pending += 1;

    const bloodGroup = (p["Blood Group"] ?? "").trim();
    if (!bloodGroup || bloodGroup === "—") missingBloodGroup += 1;

    if (!(p["Phone Number"] ?? "").trim()) missingMobile += 1;
    if (!(p.Email ?? "").trim()) missingEmail += 1;

    // Eligible donors whose availability is not tracked as available.
    const nextEligible = (p["Next Eligible Time"] ?? "").trim();
    const donorConsent = (p["Donor Consent"] ?? "").toString().toUpperCase();
    const availability = (p["Availability Status"] ?? "").toString().toUpperCase();
    const eligible = !nextEligible || Date.parse(nextEligible) <= Date.now();
    if (eligible && donorConsent === "YES" && !availability.includes("AVAILABLE")) {
      unavailableEligible += 1;
    }

    const name = (p["Full Name"] ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    const phone = (p["Phone Number"] ?? "").trim();
    if (name && phone) {
      const key = `${name}|${phone}`;
      const prev = seen.get(key) ?? 0;
      if (prev > 0) dups.add(key);
      seen.set(key, prev + 1);
    }
  }

  return {
    totalRecords: total,
    verified,
    pending,
    missingHrsId,
    missingBloodGroup,
    missingMobile,
    missingEmail,
    noConsent: pending, // pending = no donor consent recorded yet
    unavailableEligible,
    duplicateCount: dups.size,
  };
}

// -------------------------------------------------------------------------- //
// Export — build a CSV string from the in-memory cache.
// -------------------------------------------------------------------------- //
export function buildDirectoryCsv(): { filename: string; csv: string } | { error: string } {
  if (!cachedAt || cachedProfiles.length === 0) {
    return { error: "No data loaded yet — nothing to export." };
  }

  const baseCols = [
    "HRS ID",
    "Full Name",
    "Date of Birth",
    "Gender",
    "Phone Number",
    "Email",
    "City",
    "Area",
    "Blood Group",
    "Blood Group Status",
    "Registration Time",
    "Data Storage Consent",
    "Donor Consent",
    "Verification Status",
    "Verification Time",
    "Blood Donation Count",
    "Last Donation Time",
    "Next Eligible Time",
    "Availability Status",
    "Public Directory Visibility",
  ];

  const extraCols = Array.from(
    new Set(cachedProfiles.flatMap(p => Object.keys(p))),
  ).filter(col => !baseCols.includes(col));

  const cols = [...baseCols, ...extraCols];

  const escape = (value: string | undefined) => {
    const v = value ?? "";
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };

  const rows = cachedProfiles.map(p => cols.map(col => escape(p[col])).join(","));
  const csv = [cols.join(","), ...rows].join("\n");

  const date = new Date().toISOString().slice(0, 10);
  return { filename: `hrs-directory-${date}.csv`, csv };
}

/**
 * Build an .xlsx (Excel) file from the cached directory data.
 * Uses the zero-dependency xlsxWriter — no external packages needed.
 * Returns base64-encoded bytes so the client can decode and download.
 */
export function buildDirectoryXlsx(): { filename: string; data: string } | { error: string } {
  if (!cachedAt || cachedProfiles.length === 0) {
    return { error: "No data loaded yet — nothing to export." };
  }

  const baseCols = [
    "HRS ID",
    "Full Name",
    "Date of Birth",
    "Gender",
    "Phone Number",
    "Email",
    "City",
    "Area",
    "Blood Group",
    "Blood Group Status",
    "Registration Time",
    "Data Storage Consent",
    "Donor Consent",
    "Verification Status",
    "Verification Time",
    "Blood Donation Count",
    "Last Donation Time",
    "Next Eligible Time",
    "Availability Status",
    "Public Directory Visibility",
  ];

  const extraCols = Array.from(
    new Set(cachedProfiles.flatMap(p => Object.keys(p))),
  ).filter(col => !baseCols.includes(col));

  const columns = [...baseCols, ...extraCols];
  const rows = cachedProfiles.map(p => columns.map(col => p[col]));

  return buildXlsx({ columns, rows, sheetName: "Directory", filePrefix: "hrs-directory" });
}

// Pre-converted admin records — the shape Admin.tsx uses.
// Pre-converting on the server means the client skips O(N) conversion on every render
// and receives a minimal, type-safe payload instead of raw profile objects.
export interface AdminRecord {
  id: string | null;
  name: string;
  dateOfBirth: string;
  age: number;
  gender: string;
  mobile: string;
  email: string;
  group: string;
  location: string;
  area: string;
  status: "Verified" | "Pending";
  consent: boolean;
  consentStatus: "Yes" | "No" | "Pending";
  availability: "Available" | "Unavailable";
  donorConsent: boolean | null;
  submitted: string;
  registeredAt: string | null;
  verifiedAt: string | null;
  donationCount: number;
  donationDates: string[];
  nextEligibleAt: string | null;
  publicVisible: boolean;
  initials: string;
  lastDonationAt: string | null;
}

function parseSheetDateLocal(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const normalized = value.trim().replace(" ", "T");
  const withIndiaOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(normalized)
    ? normalized
    : `${normalized}+05:30`;
  const date = new Date(withIndiaOffset);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function convertToAdminRecord(p: Profile): AdminRecord {
  const id = p["HRS ID"] || null;
  const name = p["Full Name"] || "Unknown";
  const dob = p["Date of Birth"] || "";
  const gender = p["Gender"] || "Prefer not to say";
  const mobile = p["Phone Number"] || "Not provided";
  const email = p["Email"] || "";
  const bloodGroup = p["Blood Group"] || "—";
  const city = p["City"] || "Unknown";
  const area = p["Area"] || "Unknown";
  const registrationTime = p["Registration Time"] || "";
  const storageConsent = p["Data Storage Consent"] || "";
  const donationConsent = p["Donor Consent"] || "";
  const verificationStatus = p["Verification Status"] || "";
  const verifiedTime = p["Verification Time"] || "";
  const donationCount = p["Blood Donation Count"] || "0";
  const lastDonationTime = p["Last Donation Time"] || "";
  const nextEligibleTime = p["Next Eligible Time"] || "";
  const availabilityStatus = p["Availability Status"] || "";
  const publicVisibility = p["Public Directory Visibility"] || "";

  const birthDate = new Date(dob);
  const age = Number.isNaN(birthDate.getTime())
    ? 0
    : new Date().getFullYear() - birthDate.getFullYear();
  const rawStatus = verificationStatus.toUpperCase();
  const isPending = rawStatus.includes("PENDING") || rawStatus.includes("VERIFICATION");
  const consentStatus =
    storageConsent.toUpperCase() === "YES" ? "Yes" :
    storageConsent.toUpperCase() === "NO" ? "No" : "Pending";
  const donorConsent = isPending ? null : donationConsent.toUpperCase() === "YES";

  const registeredAt = parseSheetDateLocal(registrationTime);
  const verifiedAt = parseSheetDateLocal(verifiedTime);
  const nextEligibleAt = parseSheetDateLocal(nextEligibleTime);

  // Authoritative availability: a donor is only "Available" if their next-eligible
  // date has passed (or they have never donated). The sheet's "Availability Status"
  // string can lag — Google Sheets may not run the post-donation trigger before the
  // next poll. Without this guard, a donor who donated yesterday could still appear
  // eligible if the Apps Script script hasn't run yet.
  const isEligibleNow = !nextEligibleAt || Date.parse(nextEligibleAt) <= Date.now();
  const availability =
    isEligibleNow
      ? (donorConsent ? "Available" : "Unavailable")
      : "Unavailable";

  const donationDates: string[] = [];
  for (let i = 1; i <= 5; i += 1) {
    const dateValue = p[`Donation ${i} Date`];
    if (dateValue?.trim()) donationDates.push(dateValue.trim());
  }

  const publicVisible = Boolean(
    id && rawStatus === "VERIFIED" && donorConsent === true &&
    bloodGroup && bloodGroup !== "—" && publicVisibility.toUpperCase() === "YES"
  );
  const initials = name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase() || "?";
  const lastDonationAt = lastDonationTime?.trim() || null;

  return {
    id, name,
    dateOfBirth: dob || "Not recorded",
    age: isNaN(age) ? 0 : age,
    gender, mobile, email,
    group: bloodGroup,
    location: city, area,
    status: isPending ? "Pending" : "Verified",
    consent: consentStatus === "Yes",
    consentStatus,
    availability,
    donorConsent,
    submitted: registrationTime || "Recently",
    registeredAt,
    verifiedAt,
    donationCount: parseInt(donationCount, 10) || 0,
    donationDates,
    nextEligibleAt,
    publicVisible,
    initials,
    lastDonationAt,
  };
}

let cachedAdminRecords: AdminRecord[] | null = null;
let cachedAdminRecordsAt: number | null = null;

export function getCachedAdminRecords(): ApiResponse<{ records: AdminRecord[]; count: number }> {
  if (!cachedAt) {
    return { success: false, error: "Profiles not loaded yet" };
  }
  if (cachedAdminRecordsAt !== cachedAt) {
    cachedAdminRecords = cachedProfiles.map(convertToAdminRecord);
    cachedAdminRecordsAt = cachedAt;
  }
  return { success: true, data: { records: cachedAdminRecords!, count: cachedAdminRecords!.length } };
}

export function getCachedPublicProfiles(): ApiResponse<{ profiles: PublicProfile[]; count: number }> {
  if (!cachedAt) {
    return { success: false, error: "Profiles not loaded yet" };
  }

  const publicProfiles: PublicProfile[] = cachedProfiles
    .filter(p => {
      const status = (p["Verification Status"] ?? "").toUpperCase();
      const donorConsent = (p["Donor Consent"] ?? "").toUpperCase();
      const bloodGroup = p["Blood Group"] ?? "";
      const publicVisibility = (p["Public Directory Visibility"] ?? "").toUpperCase();
      return (
        status === "VERIFIED" &&
        donorConsent === "YES" &&
        bloodGroup !== "" &&
        bloodGroup !== "—" &&
        publicVisibility === "YES"
      );
    })
    .map(p => ({
      "HRS ID": p["HRS ID"] ?? "",
      "Full Name": p["Full Name"] ?? "",
      "Blood Group": p["Blood Group"] ?? "",
      City: p["City"] ?? "",
      Area: p["Area"] ?? "",
      "Last Donation Time": p["Last Donation Time"],
      "Availability Status": p["Availability Status"],
    }));

  return { success: true, data: { profiles: publicProfiles, count: publicProfiles.length } };
}

export interface LocationStats {
  area: string;
  total: number;
  verified: number;
  donors: number;
  available: number;
  bloodGroupCounts: Record<string, number>;
  topGroup: string;
  /** True when this area was first seen in the current server session. */
  isNew: boolean;
  /** ISO timestamp of when the area was first detected. */
  firstSeenAt: string | null;
}

export interface LocationsResponse {
  locations: LocationStats[];
  totalAreas: number;
  totalDonors: number;
  totalAvailable: number;
  newThisSync: LocationStats[];
  outsideTumkur: number;
}

// Areas that appeared in the sheet since server start. In-memory only — resets
// on restart, which is fine because the first poll always marks everything new.
const newlySeenAreas = new Map<string, string>();

function detectNewAreas(areas: string[]): LocationStats[] {
  const fresh: LocationStats[] = [];
  for (const area of areas) {
    if (!newlySeenAreas.has(area)) {
      newlySeenAreas.set(area, new Date().toISOString());
      fresh.push({ area, total: 0, verified: 0, donors: 0, available: 0, bloodGroupCounts: {}, topGroup: "—", isNew: true, firstSeenAt: newlySeenAreas.get(area) ?? null });
    }
  }
  return fresh;
}

export function getCachedLocations(): ApiResponse<LocationsResponse> {
  if (!cachedAt) {
    return { success: false, error: "Profiles not loaded yet" };
  }

  const records = cachedProfiles.map(convertToAdminRecord);
  const areaMap = new Map<string, LocationStats>();

  for (const record of records) {
    const area = record.area || "Unknown";
    let stats = areaMap.get(area);
    if (!stats) {
      stats = {
        area,
        total: 0,
        verified: 0,
        donors: 0,
        available: 0,
        bloodGroupCounts: {},
        topGroup: "—",
        isNew: newlySeenAreas.has(area),
        firstSeenAt: newlySeenAreas.get(area) ?? null,
      };
      areaMap.set(area, stats);
    }
    stats.total += 1;
    if (record.status === "Verified") {
      stats.verified += 1;
      stats.bloodGroupCounts[record.group] = (stats.bloodGroupCounts[record.group] ?? 0) + 1;
      if (record.donorConsent === true) {
        stats.donors += 1;
        if (record.availability === "Available") stats.available += 1;
      }
    }
  }

  // Sort by donor count descending (most useful areas first)
  const locations = Array.from(areaMap.values()).sort((a, b) => b.donors - a.donors || b.total - a.total);
  for (const stats of locations) {
    const top = Object.entries(stats.bloodGroupCounts).sort((a, b) => b[1] - a[1])[0];
    stats.topGroup = top?.[0] ?? "—";
  }

  const newThisSync = locations.filter(l => l.isNew);
  const tumkurLocations = locations.filter(l => l.isNew || l.total > 0);
  const totalDonors = tumkurLocations.reduce((s, l) => s + l.donors, 0);
  const totalAvailable = tumkurLocations.reduce((s, l) => s + l.available, 0);

  return {
    success: true,
    data: {
      locations: tumkurLocations,
      totalAreas: tumkurLocations.length,
      totalDonors,
      totalAvailable,
      newThisSync,
      outsideTumkur: records.filter(r => (r.location || "").toLowerCase() !== "tumkur").length,
    },
  };
}

// Expose the detector so the poller can mark areas as seen after a fresh fetch.
export function markAreasSeen(areas: string[]): void {
  for (const area of areas) {
    if (!newlySeenAreas.has(area)) newlySeenAreas.set(area, new Date().toISOString());
  }
}

export function getCachedStatistics(): ApiResponse<Statistics> {
  if (!cachedAt) {
    return { success: false, error: "Profiles not loaded yet" };
  }

  const totalProfiles = cachedProfiles.length;
  let verifiedProfiles = 0;
  let pendingProfiles = 0;
  let donorConsentYes = 0;
  let donorConsentNo = 0;
  const bloodGroupCounts: Record<string, number> = {};
  const cityCounts: Record<string, number> = {};
  let available = 0;
  let temporarilyUnavailable = 0;
  let notParticipating = 0;
  let pending = 0;
  let totalDonations = 0;

  for (const p of cachedProfiles) {
    const status = (p["Verification Status"] ?? "").toUpperCase();
    const donorConsent = (p["Donor Consent"] ?? "").toUpperCase();
    const availability = (p["Availability Status"] ?? "").toLowerCase();
    const bloodGroup = p["Blood Group"] ?? "";
    const city = p["City"] ?? "";

    if (status.includes("PENDING") || status.includes("VERIFICATION")) {
      pendingProfiles += 1;
      pending += 1;
    } else {
      verifiedProfiles += 1;
    }

    if (donorConsent === "YES") {
      donorConsentYes += 1;
    } else if (donorConsent === "NO") {
      donorConsentNo += 1;
    }

    if (bloodGroup) {
      bloodGroupCounts[bloodGroup] = (bloodGroupCounts[bloodGroup] ?? 0) + 1;
    }

    if (city) {
      cityCounts[city] = (cityCounts[city] ?? 0) + 1;
    }

    if (availability.includes("available")) {
      available += 1;
    } else if (availability.includes("unavailable")) {
      temporarilyUnavailable += 1;
    } else if (donorConsent === "NO") {
      notParticipating += 1;
    } else {
      pending += 1;
    }

    const count = parseInt(p["Blood Donation Count"] ?? "0", 10);
    totalDonations += isNaN(count) ? 0 : count;
  }

  return {
    success: true,
    data: {
      totalProfiles,
      verifiedProfiles,
      pendingProfiles,
      donorConsentYes,
      donorConsentNo,
      bloodGroupCounts,
      cityCounts,
      availabilityCounts: {
        available,
        temporarilyUnavailable,
        notParticipating,
        pending,
      },
      donationCounts: {
        total: totalDonations,
        average: totalProfiles > 0 ? Math.round((totalDonations / totalProfiles) * 10) / 10 : 0,
      },
    },
  };
}
