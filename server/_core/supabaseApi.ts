/**
 * Supabase API Service
 * Replaces Google Sheets CSV (read path) and Google Apps Script (write path)
 * with direct Supabase PostgreSQL database operations.
 */
import { ENV } from "./env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The Supabase client is created LAZILY on first use.
 *
 * Creating it at module load time (the previous behaviour) threw
 * `supabaseUrl is required` from supabase-js whenever SUPABASE_URL was unset —
 * which broke `vitest` (it does not load `.env`) and any deployment missing
 * the env vars, because merely *importing* hrsRouter/appRouter crashed.
 *
 * Deferring construction means an unconfigured environment only fails the
 * requests that actually touch Supabase, with a clear message.
 *
 * The server is the only consumer of these clients (the browser talks tRPC),
 * so every operation uses the service-role key when available — this bypasses
 * Row Level Security and lets `supabase/schema.sql` lock the anon role down to
 * public-safe reads. Falls back to the anon key if the service key is absent.
 */
let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  if (!ENV.supabaseUrl) {
    throw new Error(
      "[Supabase] SUPABASE_URL is not configured — set the Supabase environment variables."
    );
  }
  const key = ENV.supabaseServiceRoleKey || ENV.supabaseAnonKey;
  if (!ENV.supabaseServiceRoleKey) {
    console.warn(
      "[Supabase] SUPABASE_SERVICE_ROLE_KEY is not set — falling back to the anon key. " +
        "Writes may be rejected by Row Level Security."
    );
  }
  _client = createClient(ENV.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

/**
 * Lazily-resolving Supabase client. Existing `supabase.from(...)` call sites
 * keep working unchanged; the underlying client is only built on first access.
 */
function lazyClient(): SupabaseClient {
  return new Proxy({} as SupabaseClient, {
    get(_target, prop) {
      const client = getClient();
      const value = (client as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === "function" ? value.bind(client) : value;
    },
  });
}

export const supabase = lazyClient();

/** Alias kept for callers that explicitly want the privileged client. */
export const supabaseAdmin = lazyClient();

// Email service for sending verification emails
import { sendVerificationEmail as sendEmailViaSmtp, isSmtpConfigured } from "./emailService";
// Type-only import (erased at compile time) so the AdminRecord shape the UI and
// email templates expect stays in one place.
import type { AdminRecord } from "./googleSheetsApi";

/**
 * Profile interface matching Supabase table structure
 * Note: Column names are quoted to match exact case in Supabase
 */
export interface Profile {
  "HRS ID": string;
  "Full Name": string;
  "Date of Birth"?: string;
  Gender?: string;
  "Phone Number"?: string;
  Email?: string;
  City?: string;
  Area?: string;
  "Blood Group"?: string;
  "Blood Group Status"?: string;
  "Registration Time"?: string;
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

export interface PublicProfile {
  "HRS ID": string;
  "Full Name": string;
  "Blood Group": string;
  City: string;
  Area: string;
  "Date of Birth"?: string;
  Gender?: string;
  "Last Donation Time"?: string;
  "Availability Status"?: string;
  "Verification Time"?: string;
  "Blood Donation Count"?: string;
}

export interface Statistics {
  totalProfiles: number;
  verifiedProfiles: number;
  pendingProfiles?: number;
  donorConsentYes: number;
  donorConsentNo: number;
  bloodGroupCounts: Record<string, number>;
  cityCounts: Record<string, number>;
  availabilityCounts: {      available: number;
      temporarilyUnavailable: number;
      notParticipating: number;
    };
  donationCounts: {
    total: number;
    average: number;
  };
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ========================================================================== //
// Helper Functions
// ========================================================================== //

/**
 * Case-insensitive equality for the sheet-derived status columns.
 *
 * The database stores these values in UPPERCASE ("VERIFIED", "AVAILABLE",
 * "NOT PARTICIPATING"), while the UI vocabulary is mixed case ("Verified",
 * "Available"). Comparing with === silently matched nothing, which made the
 * public directory empty and reported 0 verified profiles.
 */
function eqCI(value: unknown, expected: string): boolean {
  return String(value ?? "").trim().toUpperCase() === expected;
}


/** Exact age in completed years (correct even before the birthday). */
function exactAge(birth: Date): number {
  const now = new Date();
  let a = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) a--;
  return a < 0 ? 0 : a;
}

/** All profiles are verified at creation — the Pending concept is gone. */
function isVerifiedRecord(p: Profile): boolean {
  return eqCI(p["Verification Status"], "VERIFIED");
}

/**
 * The Postgres table stores four columns in lowercase — `gender`, `email`,
 * `city`, `area` — while every other column is quoted TitleCase ("HRS ID",
 * "Full Name", …). The application (and the 
 * clients) speak the TitleCase vocabulary, so rows are normalised at this
 * boundary: queries use the real lower-case names, and everything downstream
 * keeps reading `p.City` / `p.Area` / `p.Gender` / `p.Email`.
 *
 * Without this, city/area/gender/email were always `undefined` — donor cards
 * showed "Unknown", the Tumkur locations view collapsed into one area, and
 * verification emails reported "No email on file".
 */
const LOWER_CASE_COLUMNS = ["gender", "email", "city", "area"] as const;

/** Map a raw database row to the TitleCase `Profile` shape. */
function normalizeRow(row: Record<string, any> | null | undefined): Profile {
  const out: Record<string, any> = { ...(row ?? {}) };
  for (const col of LOWER_CASE_COLUMNS) {
    const titleCase = col.charAt(0).toUpperCase() + col.slice(1);
    if (out[col] !== undefined) out[titleCase] = out[col];
  }
  return out as Profile;
}

function normalizeRows(rows: Record<string, any>[] | null | undefined): Profile[] {
  return (rows ?? []).map(normalizeRow);
}

/** Map application field names → real database column names for writes. */
const WRITE_COLUMN_MAP: Record<string, string> = {
  name: "Full Name",
  dob: "Date of Birth",
  gender: "gender",
  mobile: "Phone Number",
  email: "email",
  city: "city",
  area: "area",
  bloodGroup: "Blood Group",
  donorConsent: "Donor Consent",
  dataStorageConsent: "Data Storage Consent",
};

/** Columns that may be written directly (identity mapping). */
const WRITABLE_COLUMNS = new Set([
  "HRS ID", "Full Name", "Date of Birth", "gender", "Phone Number", "email",
  "city", "area", "Blood Group", "Blood Group Status", "Registration Time",
  "Data Storage Consent", "Donor Consent", "Verification Status",
  "Verification Time", "Blood Donation Count", "Last Donation Time",
  "Next Eligible Time", "Availability Status", "Public Directory Visibility",
]);

/** Resolve an incoming field name to a real column, or undefined if unknown. */
function resolveColumn(key: string): string | undefined {
  if (WRITE_COLUMN_MAP[key]) return WRITE_COLUMN_MAP[key];
  if (WRITABLE_COLUMNS.has(key)) return key;
  return undefined;
}

// ------------------------------------------------------------------------ //
// Profiles snapshot cache                                                   //
//                                                                            //
// The admin dashboard (profiles + statistics + locations) and several        //
// public pages each pull the full profiles table. On serverless every call   //
// previously paid a full-table round-trip (~180 KB at the current size) per  //
// request. This cache shares ONE fetch across all readers for a short TTL,   //
// single-flight so concurrent requests await the same promise, and is        //
// invalidated by every profile write so mutations are never served stale.    //
// ------------------------------------------------------------------------ //

const SNAPSHOT_TTL_MS = 30_000;

let snapshotData: Profile[] | null = null;
let snapshotAt = 0;
let snapshotPromise: Promise<Profile[]> | null = null;

async function fetchProfilesSnapshot(): Promise<Profile[]> {
  const { data, error } = await supabase.from("profiles").select("*");
  if (error) throw error;
  const rows = normalizeRows(data);
  snapshotData = rows;
  snapshotAt = Date.now();
  return rows;
}

/**
 * Get a near-realtime snapshot of all profiles. Cheap when warm: repeated
 * calls within the TTL reuse the same array (treat it as read-only).
 */
async function getProfilesSnapshot(): Promise<Profile[]> {
  if (snapshotData && Date.now() - snapshotAt < SNAPSHOT_TTL_MS) {
    return snapshotData;
  }
  if (!snapshotPromise) {
    snapshotPromise = fetchProfilesSnapshot().finally(() => {
      snapshotPromise = null;
    });
  }
  return snapshotPromise;
}

/** Drop the cached snapshot so the next read re-fetches. Called after writes. */
function invalidateProfilesSnapshot(): void {
  snapshotData = null;
  snapshotAt = 0;
}

/**
 * Map<HRS ID, Full Name> for resolving audit-log targets, built from the
 * shared snapshot (no extra table fetch of its own).
 */
export async function getProfileNameLookup(): Promise<Map<string, string>> {
  const profiles = await getProfilesSnapshot();
  const map = new Map<string, string>();
  for (const p of profiles) {
    const id = (p["HRS ID"] || "").trim();
    const name = (p["Full Name"] || "").trim();
    if (id && name) map.set(id, name);
  }
  return map;
}

// ========================================================================== //
// Profile Operations
// ========================================================================== //

/**
 * Get all profiles from Supabase
 * Replaces getAllProfiles() from googleSheetsApi
 */
export async function getProfiles(): Promise<ApiResponse<Profile[]>> {
  try {
    const profiles = await getProfilesSnapshot();
    return { success: true, data: profiles };
  } catch (error) {
    console.error("[Supabase] Failed to fetch profiles:", error);
    return { success: false, error: "Failed to fetch profiles" };
  }
}

/**
 * Get profile by HRS ID
 * Replaces getProfileByHrsId() from googleSheetsApi
 */
export async function getProfileByHrsId(hrsId: string): Promise<ApiResponse<Profile>> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('HRS ID', hrsId)
      .single();

    if (error) throw error;
    if (!data) return { success: false, error: "Profile not found" };
    return { success: true, data: normalizeRow(data) };
  } catch (error) {
    console.error("[Supabase] Failed to fetch profile by HRS ID:", error);
    return { success: false, error: "Failed to fetch profile" };
  }
}

/**
 * Get profiles by city
 * Replaces getProfilesByCity() from googleSheetsApi
 */
export async function getProfilesByCity(city: string): Promise<ApiResponse<Profile[]>> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('city', city);

    if (error) throw error;
    return { success: true, data: normalizeRows(data) };
  } catch (error) {
    console.error("[Supabase] Failed to fetch profiles by city:", error);
    return { success: false, error: "Failed to fetch profiles by city" };
  }
}

/**
 * Get profiles by area
 * Replaces getProfilesByArea() from googleSheetsApi
 */
export async function getProfilesByArea(area: string): Promise<ApiResponse<Profile[]>> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('area', area);

    if (error) throw error;
    return { success: true, data: normalizeRows(data) };
  } catch (error) {
    console.error("[Supabase] Failed to fetch profiles by area:", error);
    return { success: false, error: "Failed to fetch profiles by area" };
  }
}

/**
 * Get profiles by blood group
 * Replaces getProfilesByBloodGroup() from googleSheetsApi
 */
export async function getProfilesByBloodGroup(bloodGroup: string): Promise<ApiResponse<Profile[]>> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('Blood Group', bloodGroup);

    if (error) throw error;
    return { success: true, data: normalizeRows(data) };
  } catch (error) {
    console.error("[Supabase] Failed to fetch profiles by blood group:", error);
    return { success: false, error: "Failed to fetch profiles by blood group" };
  }
}

/**
 * Get profiles by verification status
 * Replaces getProfilesByVerificationStatus() from googleSheetsApi
 */
export async function getProfilesByVerificationStatus(status: string): Promise<ApiResponse<Profile[]>> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('Verification Status', status);

    if (error) throw error;
    return { success: true, data: normalizeRows(data) };
  } catch (error) {
    console.error("[Supabase] Failed to fetch profiles by verification status:", error);
    return { success: false, error: "Failed to fetch profiles by verification status" };
  }
}

/**
 * Get profiles by availability status
 * Replaces getProfilesByAvailabilityStatus() from googleSheetsApi
 */
export async function getProfilesByAvailabilityStatus(status: string): Promise<ApiResponse<Profile[]>> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('Availability Status', status);

    if (error) throw error;
    return { success: true, data: normalizeRows(data) };
  } catch (error) {
    console.error("[Supabase] Failed to fetch profiles by availability status:", error);
    return { success: false, error: "Failed to fetch profiles by availability status" };
  }
}

/**
 * Get statistics from profiles table
 * Pending concept removed — every profile is created verified, so this
 */
export async function getStatistics(): Promise<ApiResponse<Statistics>> {
  try {
    const profiles = await getProfilesSnapshot();

    // Calculate statistics (all status comparisons are case-insensitive — the
    // stored values are UPPERCASE).
    const totalProfiles = profiles.length;
    const verifiedProfiles = profiles.filter(isVerifiedRecord).length;
    const donorConsentYes = profiles.filter(p => eqCI(p["Donor Consent"], "YES")).length;
    const donorConsentNo = profiles.filter(p => eqCI(p["Donor Consent"], "NO")).length;

    // Blood group counts
    const bloodGroupCounts: Record<string, number> = {};
    profiles.forEach(p => {
      const bg = p["Blood Group"] || "Unknown";
      bloodGroupCounts[bg] = (bloodGroupCounts[bg] || 0) + 1;
    });

    // City counts
    const cityCounts: Record<string, number> = {};
    profiles.forEach(p => {
      const city = p.City || "Unknown";
      cityCounts[city] = (cityCounts[city] || 0) + 1;
    });

    // Availability counts (case-insensitive — stored UPPERCASE)
    const availabilityCounts = {
      available: profiles.filter(p => eqCI(p["Availability Status"], "AVAILABLE")).length,
      temporarilyUnavailable: profiles.filter(p => eqCI(p["Availability Status"], "TEMPORARILY UNAVAILABLE")).length,
      notParticipating: profiles.filter(p => eqCI(p["Availability Status"], "NOT PARTICIPATING")).length,
    };

    // Donation counts
    let totalDonations = 0;
    profiles.forEach(p => {
      const count = parseInt(p["Blood Donation Count"] || "0", 10);
      totalDonations += !isNaN(count) ? count : 0;
    });
    const donationCounts = {
      total: totalDonations,
      average: totalProfiles > 0 ? totalDonations / totalProfiles : 0,
    };

    return {
      success: true,
      data: {
        totalProfiles,
        verifiedProfiles,
        donorConsentYes,
        donorConsentNo,
        bloodGroupCounts,
        cityCounts,
        availabilityCounts,
        donationCounts,
      },
    };
  } catch (error) {
    console.error("[Supabase] Failed to get statistics:", error);
    return { success: false, error: "Failed to get statistics" };
  }
}

/**
 * Get unique cities
 * Replaces getCities() from googleSheetsApi
 */
export async function getCities(): Promise<ApiResponse<string[]>> {
  try {
    const { data, error } = await supabase.from('profiles').select('city');

    if (error) throw error;
    const cities = Array.from(new Set(normalizeRows(data).map(p => p.City).filter((city): city is string => city !== undefined && city !== null && city !== "")));
    return { success: true, data: cities };
  } catch (error) {
    console.error("[Supabase] Failed to get cities:", error);
    return { success: false, error: "Failed to get cities" };
  }
}

/**
 * Get unique areas
 * Replaces getAreas() from googleSheetsApi
 */
export async function getAreas(): Promise<ApiResponse<string[]>> {
  try {
    const { data, error } = await supabase.from('profiles').select('area');

    if (error) throw error;
    const areas = Array.from(new Set(normalizeRows(data).map(p => p.Area).filter((area): area is string => area !== undefined && area !== null && area !== "")));
    return { success: true, data: areas };
  } catch (error) {
    console.error("[Supabase] Failed to get areas:", error);
    return { success: false, error: "Failed to get areas" };
  }
}

/**
 * Get locations (cities with their areas)
 * Replaces getLocations() from googleSheetsApi
 */
export interface LocationStats {
  area: string;
  total: number;
  verified: number;
  donors: number;
  available: number;
  bloodGroupCounts: Record<string, number>;
  topGroup: string;
  isNew: boolean;
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

/**
 * Get Tumkur locations with stats
 * Replaces getLocations() from googleSheetsApi
 */
export async function getLocations(): Promise<ApiResponse<LocationsResponse>> {
  try {
    const profiles = await getProfilesSnapshot();

    const areaMap: Record<string, {
      total: number;
      verified: number;
      donors: number;
      available: number;
      bloodGroupCounts: Record<string, number>;
    }> = {};

    let totalDonors = 0;
    let totalAvailable = 0;
    let outsideTumkur = 0;

    profiles.forEach(p => {
      const city = (p.City || "").trim();
      const area = (p.Area || "").trim() || "Unknown";
      const isTumkur = city.toLowerCase() === "tumkur" || city.toLowerCase() === "tumakuru";

      if (!isTumkur && city) {
        outsideTumkur++;
      }

      if (!areaMap[area]) {
        areaMap[area] = {
          total: 0,
          verified: 0,
          donors: 0,
          available: 0,
          bloodGroupCounts: {},
        };
      }

      const stats = areaMap[area];
      stats.total++;

      const isVerified = (p["Verification Status"] || "").toLowerCase() === "verified";
      if (isVerified) stats.verified++;

      const isConsent = (p["Donor Consent"] || "").toLowerCase() === "yes";
      if (isConsent) {
        stats.donors++;
        totalDonors++;
      }

      const isAvailable = (p["Availability Status"] || "").toLowerCase() === "available";
      if (isAvailable) {
        stats.available++;
        totalAvailable++;
      }

      const bg = p["Blood Group"] || "Unknown";
      stats.bloodGroupCounts[bg] = (stats.bloodGroupCounts[bg] || 0) + 1;
    });

    const locations: LocationStats[] = Object.keys(areaMap).map(area => {
      const stats = areaMap[area];
      let topGroup = "None";
      let maxCount = 0;
      Object.entries(stats.bloodGroupCounts).forEach(([bg, count]) => {
        if (count > maxCount) {
          maxCount = count;
          topGroup = bg;
        }
      });

      return {
        area,
        total: stats.total,
        verified: stats.verified,
        donors: stats.donors,
        available: stats.available,
        bloodGroupCounts: stats.bloodGroupCounts,
        topGroup,
        isNew: false,
        firstSeenAt: null,
      };
    });

    return {
      success: true,
      data: {
        locations,
        totalAreas: locations.length,
        totalDonors,
        totalAvailable,
        newThisSync: [],
        outsideTumkur,
      },
    };
  } catch (error) {
    console.error("[Supabase] Failed to get locations:", error);
    return { success: false, error: "Failed to get locations" };
  }
}

/**
 * Record a donation for a profile
 * Replaces recordDonation() from googleSheetsApi
 */
export async function recordDonation(hrsId: string): Promise<ApiResponse<{ success: boolean; newCount: number }>> {
  try {
    // First get current profile to get donation count and donor consent
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('"Blood Donation Count", "Donor Consent"')
      .eq('HRS ID', hrsId)
      .single();

    if (profileError) throw profileError;
    if (!profileData) return { success: false, error: "Profile not found" };

    const currentCount = parseInt(profileData["Blood Donation Count"] || "0", 10);
    const newCount = isNaN(currentCount) ? 1 : currentCount + 1;
    const donorConsent = (profileData as any)["Donor Consent"];

    // Update donation count and last donation time
    const { data, error } = await supabase
      .from('profiles')
      .update({
        "Blood Donation Count": newCount.toString(),
        "Last Donation Time": new Date().toISOString(),
        // Update next eligible time (120 days from now)
        "Next Eligible Time": new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString(),
        // Update availability based on donor consent (UPPERCASE convention)
        "Availability Status": donorConsent === "YES" ? "AVAILABLE" : "NOT PARTICIPATING"
      })
      .eq('HRS ID', hrsId)
      .select();

    if (error) throw error;
    invalidateProfilesSnapshot();
    return { success: true, data: { success: true, newCount } };
  } catch (error) {
    console.error("[Supabase] Failed to record donation:", error);
    return { success: false, error: "Failed to record donation" };
  }
}

/**
 * Delete profiles by HRS IDs
 * Replaces deleteProfiles() from googleSheetsApi
 */
export async function deleteProfiles(hrsIds: string[]): Promise<ApiResponse<{ success: boolean; count: number }>> {
  try {
    if (hrsIds.length === 0) {
      return { success: true, data: { success: true, count: 0 } };
    }

    const { data, error } = await supabase
      .from('profiles')
      .delete()
      .in('HRS ID', hrsIds)
      .select('"HRS ID"');

    if (error) throw error;
    invalidateProfilesSnapshot();
    const count = data ? data.length : 0;
    return { success: true, data: { success: true, count } };
  } catch (error) {
    console.error("[Supabase] Failed to delete profiles:", error);
    return { success: false, error: "Failed to delete profiles" };
  }
}

/**
 * Update a profile
 * Replaces updateProfile() from googleSheetsApi
 */
export async function updateProfile(hrsId: string, updates: Partial<Profile>): Promise<ApiResponse<{ success: boolean }>> {
  try {
    // Map the caller's field names to the real database columns and drop
    // anything unknown. The previous pass-through wrote keys like `name`,
    // `dob` and `mobile` straight to PostgREST, which has no such columns, so
    // every edit of those fields failed.
    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === null) continue;
      const column = resolveColumn(key);
      if (column) updateData[column] = value;
    }

    if (Object.keys(updateData).length === 0) {
      return { success: true, data: { success: true } };
    }

    // Note: "Verification Time" is deliberately NOT touched here. An edit is
    // not a verification, and overwriting it corrupted the verification trail.
    const { data, error } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('HRS ID', hrsId)
      .select();

    if (error) throw error;
    invalidateProfilesSnapshot();
    return { success: true, data: { success: true } };
  } catch (error) {
    console.error("[Supabase] Failed to update profile:", error);
    return { success: false, error: "Failed to update profile" };
  }
}

/**
 * Send verification email to a donor
 * Uses SMTP with Google Apps Script fallback
 */
export async function sendVerificationEmail(
  hrsId: string,
  extras?: { bloodGroup?: string; donorConsent?: string }
): Promise<ApiResponse<{ sent: boolean; skipped?: boolean; reason?: string; to?: string; via?: string }>> {
  try {
    // Resolve the FULL profile from the database — the email body is built from
    // it. Previously the router called emailService directly, which looked the
    // donor up in the legacy Google Sheets cache instead.
    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select('*')
      .eq("HRS ID", hrsId)
      .single();

    if (profileError) throw profileError;
    if (!profileData) return { success: false, error: "Profile not found" };

    const record = convertToAdminRecord(normalizeRow(profileData));
    const to = (record.email ?? "").trim();
    if (!to) {
      return {
        success: true,
        data: {
          sent: false,
          skipped: true,
          reason: "No email on file",
          to: undefined
        }
      };
    }

    // Build email extras
    const emailExtras: { bloodGroup?: string; donorConsent?: string } = {};
    if (extras?.bloodGroup) emailExtras.bloodGroup = extras.bloodGroup;
    if (extras?.donorConsent) emailExtras.donorConsent = extras.donorConsent;

    // Send via SMTP, using the database record (Apps Script stays as the
    // fallback inside emailService when SMTP is not configured).
    const emailResult = await sendEmailViaSmtp(hrsId, emailExtras, record);
    
    return {
      success: true,
      data: {
        sent: emailResult.response.data?.sent ?? false,
        skipped: emailResult.response.data?.skipped ?? false,
        reason: emailResult.response.data?.reason ?? undefined,
        to: emailResult.response.data?.to ?? to,
        via: emailResult.via
      }
    };
  } catch (error: any) {
    console.error("[Supabase] Failed to send verification email:", error);
    return {
      success: false,
      error: "Failed to send verification email: " + (error?.message || "Unknown error")
    };
  }
}

/**
 * Test Supabase connection
 */
export async function ping(): Promise<ApiResponse<{ success: boolean }>> {
  try {
    const { data, error } = await supabase.from('profiles').select('"HRS ID"').limit(1);
    if (error) throw error;
    return { success: true, data: { success: true } };
  } catch (error) {
    console.error("[Supabase] Failed to ping:", error);
    return { success: false, error: "Failed to connect to Supabase" };
  }
}

/**
 * Add a new profile
 */
export async function addProfile(data: Partial<Profile>): Promise<ApiResponse<{ success: boolean }>> {
  try {
    // Map to real column names, dropping unknown fields.
    const cleanData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined || value === null) continue;
      const column = resolveColumn(key);
      if (column) cleanData[column] = value;
    }

    const { data: result, error } = await supabase
      .from('profiles')
      .insert(cleanData)
      .select();

    if (error) throw error;
    invalidateProfilesSnapshot();
    return { success: true, data: { success: true } };
  } catch (error) {
    console.error("[Supabase] Failed to add profile:", error);
    return { success: false, error: "Failed to add profile" };
  }
}

/**
 * Reset all profiles' verification bookkeeping (legacy helper — retained as a
 * no-op placeholder since every profile is already verified at creation).
 */


/**
 * Convert a Profile to AdminRecord format (matching googleSheetsApi shape)
 */
/**
 * Parse a sheet/database timestamp into an ISO string.
 *
 * Values are stored as IST wall-clock strings ("2025-08-12 09:30:00") with no
 * timezone; a bare `new Date(value)` would interpret them in the server's local
 * zone, so an explicit +05:30 offset is appended when none is present.
 */
function parseSheetDate(value: string | undefined | null): string | null {
  if (!value || !String(value).trim()) return null;
  const raw = String(value).trim();
  const normalized = raw.replace(" ", "T");
  const withOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(normalized)
    ? normalized
    : `${normalized}+05:30`;
  const date = new Date(withOffset);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function convertToAdminRecord(p: Profile): AdminRecord {
  const id = p["HRS ID"] || null;
  const name = p["Full Name"] || "Unknown";
  const dob = p["Date of Birth"] || "";
  const gender = p.Gender || "Prefer not to say";
  const mobile = p["Phone Number"] || "Not provided";
  const email = p.Email || "";
  const bloodGroup = p["Blood Group"] || "—";
  const city = p.City || "Unknown";
  const area = p.Area || "Unknown";
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
    : exactAge(birthDate);
  const rawStatus = verificationStatus.toUpperCase();
  const consentStatus =
    storageConsent.toUpperCase() === "YES" ? "Yes" : "No";
  const donorConsentBool = donationConsent.toUpperCase() === "YES";

  // Real timestamps parsed from the stored columns. The previous code returned
  // `new Date()` for any non-empty value, so every record displayed "now" as
  // its registration/verification time.
  const registeredAt = parseSheetDate(registrationTime);
  const verifiedAt = parseSheetDate(verifiedTime);
  const nextEligibleAt = parseSheetDate(nextEligibleTime);

  // Eligibility is computed from the actual next-eligible instant, not the
  // stored status string (which can lag a write).
  const isEligibleNow =
    nextEligibleAt === null || Date.parse(nextEligibleAt) <= Date.now();
  const availability =
    isEligibleNow && donorConsentBool
      ? "Available"
      : "Unavailable";

  // Donation dates are stored per-slot ("Donation 1 Date" … "Donation N Date") —
  // collect whatever exists so the UI can show the real history.
  const donationDates: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const parsed = parseSheetDate(p[`Donation ${i} Date`]);
    if (parsed) donationDates.push(parsed);
  }

  const publicVisible = Boolean(
    id && rawStatus === "VERIFIED" && donorConsentBool === true &&
    bloodGroup && bloodGroup !== "—" && publicVisibility.toUpperCase() === "YES" &&
    isEligibleNow
  );
  const initials = name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase() || "?";
  const lastDonationAt =
    parseSheetDate(lastDonationTime) ??
    (donationDates.length > 0
      ? donationDates[donationDates.length - 1]
      : null);

  return {
    id, name,
    dateOfBirth: dob || "Not recorded",
    age: isNaN(age) ? 0 : age,
    gender, mobile, email,
    group: bloodGroup,
    location: city, area,
    status: "Verified",
    consent: consentStatus === "Yes",
    consentStatus,
    availability,
    donorConsent: donorConsentBool,
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

/**
 * Get all profiles formatted as AdminRecord (for admin panel and volunteer access)
 * Replaces getAdminRecords() concept from googleSheetsApi
 */
export async function getAdminRecords(): Promise<ApiResponse<{ records: any[]; count: number }>> {
  try {
    const { data, error } = await supabase.from('profiles').select('*');
    
    if (error) throw error;
    
    const adminRecords = normalizeRows(data).map(convertToAdminRecord);
    
    return { 
      success: true, 
      data: { 
        records: adminRecords, 
        count: adminRecords.length 
      } 
    };
  } catch (error) {
    console.error("[Supabase] Failed to get admin records:", error);
    return { success: false, error: "Failed to get admin records" };
  }
}

/**
 * Build directory CSV file from profiles
 * Replaces buildDirectoryCsv() from googleSheetsApi
 */
export async function buildDirectoryCsv(): Promise<ApiResponse<{ filename: string; csv: string }>> {
  try {
    const { data: profileRows, error } = await supabase.from('profiles').select('*');
    
    if (error) throw error;
    const profiles = normalizeRows(profileRows);
    
    // Convert profiles to CSV format
    if (profiles.length === 0) {
      return { 
        success: true, 
        data: { 
          filename: `HRS_Directory_${new Date().toISOString().slice(0,10)}.csv`, 
          csv: "" 
        } 
      };
    }
    
    // Define CSV columns (matching the AdminRecord shape for consistency)
    const columns = [
      "ID", "Name", "Date of Birth", "Age", "Gender", "Mobile", "Email", 
      "Blood Group", "City", "Area", "Status", "Consent", "Consent Status", 
      "Availability", "Donor Consent", "Submitted", "Registered At", 
      "Verified At", "Donation Count", "Next Eligible At", 
      "Public Visible", "Initials", "Last Donation At"
    ];
    
    const csvRows = [
      columns.join(","), // header
      ...profiles.map(profile => {
        const adminRecord = convertToAdminRecord(profile);
        return [
          adminRecord.id ?? "",
          adminRecord.name,
          adminRecord.dateOfBirth,
          adminRecord.age,
          adminRecord.gender,
          adminRecord.mobile,
          adminRecord.email,
          adminRecord.group,
          adminRecord.location,
          adminRecord.area,
          adminRecord.status,
          adminRecord.consent,
          adminRecord.consentStatus,
          adminRecord.availability,
          adminRecord.donorConsent ?? "",
          adminRecord.submitted,
          adminRecord.registeredAt ?? "",
          adminRecord.verifiedAt ?? "",
          adminRecord.donationCount,
          adminRecord.nextEligibleAt ?? "",
          adminRecord.publicVisible,
          adminRecord.initials,
          adminRecord.lastDonationAt ?? "",
        ].map(value => {
          // Escape quotes and wrap in quotes if contains comma, quote, or newline
          const str = String(value);
          if (str.includes('"') || str.includes(',') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        }).join(",")
      })
    ];
    
    const csv = csvRows.join("\n");
    
    return { 
      success: true, 
      data: { 
        filename: `HRS_Directory_${new Date().toISOString().slice(0,10)}.csv`, 
        csv 
      } 
    };
  } catch (error) {
    console.error("[Supabase] Failed to build directory CSV:", error);
    return { success: false, error: "Failed to build directory CSV" };
  }
}

/**
 * Get public profiles (only those with public visibility enabled)
 * Replaces getPublicProfiles() concept from googleSheetsApi
 */
export async function getPublicProfiles(): Promise<ApiResponse<Profile[]>> {
  try {
    // ilike (no wildcards) is PostgREST's case-insensitive equality, matching
    // the UPPERCASE values stored in the table. The plain .eq() below matched
    // nothing, so the public directory always rendered empty.
    //
    // Columns are listed explicitly: this endpoint is PUBLIC, so it must never
    // return donor contact details or exact dates of birth. `select('*')`
    // previously shipped every donor's "Phone Number" and Email to any
    // anonymous caller; DOB is read only to derive the display age and is
    // stripped from the response (a full birthdate is an identity-theft
    // vector — the directory only shows "N years").
    const { data, error } = await supabase
      .from('profiles')
      .select(
        '"HRS ID","Full Name","Blood Group","Date of Birth",gender,city,area,"Blood Donation Count","Last Donation Time","Availability Status","Verification Time"'
      )
      .ilike('Public Directory Visibility', 'YES')
      .ilike('Verification Status', 'Verified')
      .ilike('Donor Consent', 'YES')
      .neq('Blood Group', '—'); // Ensure they have a blood group
    
    if (error) throw error;

    const safeRows = normalizeRows(data).map(p => {
      const dob = p["Date of Birth"];
      let age: number | undefined;
      if (dob) {
        const birth = new Date(dob);
        if (!Number.isNaN(birth.getTime())) {
          const now = new Date();
          age = now.getFullYear() - birth.getFullYear();
          const m = now.getMonth() - birth.getMonth();
          if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
          if (age < 0 || age > 120) age = undefined;
        }
      }
      const { "Date of Birth": _dob, ...publicSafe } = p;
      return { ...publicSafe, age };
    });

    return { success: true, data: safeRows as unknown as Profile[] };
  } catch (error) {
    console.error("[Supabase] Failed to get public profiles:", error);
    return { success: false, error: "Failed to get public profiles" };
  }
}

/**
 * Add a new verified person (admin "Add Person" modal)
 * Creates a profile with Verification Status = VERIFIED and skips Pending
 */
export async function addPerson(input: {
  fullName: string;
  bloodGroup: string;
  donorConsent: "YES" | "NO";
  dateOfBirth?: string;
  gender?: string;
  phoneNumber?: string;
  email?: string;
  city?: string;
  area?: string;
  dataStorageConsent?: "YES" | "NO";
}): Promise<ApiResponse<{ success: boolean; hrs_id: string }>> {
  try {
    // Prepare profile data — note the lower-case gender/email/city/area
    // columns are the real column names in the table.
    const now = new Date().toISOString();
    const profileData: Record<string, unknown> = {
      // "HRS ID" is assigned inside the retry loop below (max+1, collision-safe).
      "Full Name": input.fullName,
      "Date of Birth": input.dateOfBirth || null,
      gender: input.gender || null,
      "Phone Number": input.phoneNumber || null,
      email: input.email || null,
      city: input.city || null,
      area: input.area || null,
      "Blood Group": input.bloodGroup,
      "Blood Group Status": "Recorded",
      "Registration Time": now,
      "Data Storage Consent": input.dataStorageConsent || "NO",
      "Donor Consent": input.donorConsent,
      "Verification Status": "VERIFIED", // Skip pending - verified immediately
      "Verification Time": now,
      "Blood Donation Count": "0",
      "Last Donation Time": null,
      "Next Eligible Time": null,
      "Availability Status": input.donorConsent === "YES" ? "AVAILABLE" : "NOT PARTICIPATING",
      "Public Directory Visibility": "NO", // Default to not public until approved
    };
    
    // Remove null values to let Supabase use defaults
    Object.keys(profileData).forEach(key => 
      (profileData[key] === null || profileData[key] === undefined) && delete profileData[key]
    );
    
    // HRS ID generation with retry: concurrent registrations can compute the
    // same next ID. On a unique-constraint collision, re-read the max and
    // retry (bounded) instead of failing the registration.
    let data: Record<string, unknown> | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: idRows, error: maxIdError } = await supabase
        .from('profiles')
        .select('"HRS ID"');
      if (maxIdError) throw maxIdError;

      let maxNum = 0;
      for (const row of idRows ?? []) {
        const n = parseInt(String(row["HRS ID"] ?? "").replace(/\D/g, ""), 10);
        if (!Number.isNaN(n) && n > maxNum) maxNum = n;
      }
      profileData["HRS ID"] = `HRS-${String(maxNum + 1).padStart(4, "0")}`;

      const { data: inserted, error } = await supabase
        .from('profiles')
        .insert(profileData)
        .select()
        .single();
      if (!error) {
        data = inserted as Record<string, unknown>;
        break;
      }
      lastError = error;
      // Only retry on uniqueness collisions; other errors are fatal.
      const code = (error as { code?: string }).code ?? "";
      if (code !== "23505" && !String(error).includes("duplicate")) break;
      // small jitter so racing writers diverge on the next attempt
      await new Promise(r => setTimeout(r, 60 + Math.floor(Math.random() * 90)));
    }
    
    if (!data) throw lastError ?? new Error("insert failed");
    invalidateProfilesSnapshot();
    
    return { 
      success: true, 
      data: { 
        success: true, 
        hrs_id: data["HRS ID"] as string 
      } 
    };
  } catch (error) {
    console.error("[Supabase] Failed to add person:", error);
    // Surface a specific, user-actionable message instead of a blanket
    // "Failed to add person" — the common case is an invalid date that
    // Postgres rejects (e.g. February 31st from a broken client form).
    const raw = String((error as { message?: string })?.message ?? error);
    if (/date\/time|invalid date|out of range/i.test(raw)) {
      return { success: false, error: "Invalid date of birth — please check the day, month and year." };
    }
    if ((error as { code?: string })?.code === "23505" || /duplicate/i.test(raw)) {
      return { success: false, error: "That record was just created by someone else — please submit again." };
    }
    return { success: false, error: "Could not save the registration — please try again." };
  }
}

/**
 * Perform data health check on profiles table
 * Replaces dataHealth() concept
 */
export async function dataHealth(): Promise<ApiResponse<{ success: boolean; issues: string[]; totalProfiles: number }>> {
  try {
    const profiles = await getProfilesSnapshot();
    const issues: string[] = [];

    // Check for missing essential fields
    profiles.forEach((p, index) => {
      const hrsId = p["HRS ID"] || `ROW_${index + 1}`;
      
      if (!p["Full Name"] || p["Full Name"].trim() === "") {
        issues.push(`${hrsId}: Missing full name`);
      }
      if (!p.Email || p.Email.trim() === "") {
        issues.push(`${hrsId}: Missing email`);
      }
      if (!p["Blood Group"] || p["Blood Group"].trim() === "" || p["Blood Group"] === "—") {
        issues.push(`${hrsId}: Missing blood group`);
      }
      if (!p.City || p.City.trim() === "") {
        issues.push(`${hrsId}: Missing city`);
      }
      if (!p.Area || p.Area.trim() === "") {
        issues.push(`${hrsId}: Missing area`);
      }
      if (!p.Gender || p.Gender.trim() === "") {
        issues.push(`${hrsId}: Missing gender`);
      }
      if (!p["Phone Number"] || p["Phone Number"].trim() === "") {
        issues.push(`${hrsId}: Missing phone number`);
      }
      
      // Check verification status consistency — all profiles must be VERIFIED
      const verificationStatus = p["Verification Status"];
      if (verificationStatus && verificationStatus.toUpperCase() !== "VERIFIED") {
        issues.push(`${hrsId}: Not verified (pending concept removed)`);
      }
      
      // Check donor consent consistency
      const donorConsent = p["Donor Consent"];
      if (donorConsent && !["YES", "NO"].includes(donorConsent)) {
        issues.push(`${hrsId}: Invalid donor consent: ${donorConsent}`);
      }
      
      // Check data storage consent
      const storageConsent = p["Data Storage Consent"];
      if (storageConsent && !["YES", "NO"].includes(storageConsent)) {
        issues.push(`${hrsId}: Invalid data storage consent: ${storageConsent}`);
      }
      
      // Check availability status
      const availabilityStatus = p["Availability Status"];
      const validStatuses = ["AVAILABLE", "UNAVAILABLE", "TEMPORARILY UNAVAILABLE", "NOT PARTICIPATING"];
      if (availabilityStatus && !validStatuses.includes(String(availabilityStatus).toUpperCase())) {
        issues.push(`${hrsId}: Invalid availability status: ${availabilityStatus}`);
      }
      
      // Check public visibility
      const publicVisibility = p["Public Directory Visibility"];
      if (publicVisibility && !["YES", "NO"].includes(publicVisibility)) {
        issues.push(`${hrsId}: Invalid public visibility: ${publicVisibility}`);
      }
      
      // Check numeric fields
      const donationCount = parseInt(p["Blood Donation Count"] || "0", 10);
      if (isNaN(donationCount) || donationCount < 0) {
        issues.push(`${hrsId}: Invalid donation count: ${p["Blood Donation Count"]}`);
      }
      
      // Check date formats (basic check)
      const dateFields = ["Date of Birth", "Registration Time", "Verification Time", "Last Donation Time", "Next Eligible Time"];
      dateFields.forEach(field => {
        const value = p[field as keyof Profile];
        if (value && value !== "" && value !== null) {
          // Basic ISO date check - just see if it looks like a date
          const dateMatch = value.match(/\d{4}-\d{2}-\d{2}/);
          if (!dateMatch) {
            issues.push(`${hrsId}: Invalid date format for ${field}: ${value}`);
          }
        }
      });
    });

    return {
      success: true,
      data: {
        success: issues.length === 0,
        issues,
        totalProfiles: profiles.length
      }
    };
  } catch (error) {
    console.error("[Supabase] Failed to perform data health check:", error);
    return { success: false, error: "Failed to perform data health check" };
  }
}