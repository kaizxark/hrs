/**
 * Google Sheets CSV API Service
 * Reads the HRS donor directory directly from the publicly-shared Google Sheet CSV.
 * Much faster than the Apps Script endpoint (~3.5s vs 10–44s).
 *
 * Background poll every 15 seconds keeps the in-memory cache fresh.
 * Mutations (verify, recordDonation, delete) still go through Apps Script.
 */
import { ENV } from "./env";

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
let isPolling = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

const POLL_INTERVAL_MS = 5_000;

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
  const result = await fetchProfilesFromSheet();
  if (result.success && result.data) {
    cachedProfiles = result.data.profiles;
    cachedAt = Date.now();
    console.log(
      `[GoogleSheets] Cached ${result.data.count} profiles at ${new Date().toISOString()}`
    );
    // Push update to all connected admin clients so they refetch silently
    broadcast({ type: "cache-update", count: result.data.count });
  } else {
    console.error("[GoogleSheets] Poll failed:", result.error);
  }
}

function scheduleNextPoll() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    await pollSheet();
    scheduleNextPoll();
  }, POLL_INTERVAL_MS);
}

// Start the background poll. Call once at startup.
export async function startProfilePoller(): Promise<void> {
  if (isPolling) return;
  isPolling = true;

  console.log("[GoogleSheets] Fetching profiles from Google Sheets...");
  await pollSheet(); // blocking first fetch
  scheduleNextPoll();
}

// Force an immediate re-fetch (used by the manual Sync button).
export async function forceRefresh(): Promise<void> {
  await pollSheet();
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
