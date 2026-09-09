/**
 * Google Apps Script API Service
 * Handles all communication with the HRS Google Apps Script backend.
 *
 * Reads (profiles, statistics) now go through googleSheetsApi which polls the
 * public CSV export directly. This file is left as the write-path only:
 * verify, updateProfile, recordDonation, deleteProfiles, sendVerificationEmail, ping.
 */
import { ENV } from "./env";

const API_BASE_URL = ENV.googleAppsScriptUrl;

// Kept as a no-op for backward compatibility — the sheet poller always
// re-reads from Google Sheets every 15s, so no invalidation is needed.
export function invalidateProfilesCache() {
  /* no-op */
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface Profile {
  "HRS ID"?: string;
  "Full Name"?: string;
  "Date of Birth"?: string;
  Gender?: string;
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

export async function callApi<T>(
  action: string,
  params: Record<string, string> = {},
  timeoutMs = 8000
): Promise<ApiResponse<T>> {
  try {
    const url = new URL(API_BASE_URL);
    url.searchParams.set("action", action);

    // Add all params to URL
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let response: globalThis.Response;
    try {
      response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      return {
        success: false,
        error: `API responded with status ${response.status}`,
      };
    }

    const data = await response.json();

    // Handle both direct response and wrapped response
    if (data.success === false || data.status === "error") {
      return {
        success: false,
        error: data.message || data.error || "Unknown error",
      };
    }

    return {
      success: true,
      data: data.data || data,
    };
  } catch (error) {
    console.error(`Google Apps Script API error (${action}):`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

export async function postApi<T>(
  action: string,
  body: Record<string, string>
): Promise<ApiResponse<T>> {
  try {
    // Apps Script's doPost(e) reads e.parameter, which is populated from
    // form-urlencoded bodies. We use URLSearchParams so the values arrive
    // as individual query-like parameters that Apps Script can read directly.
    const formBody = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      formBody.append(key, value);
    }

    const response = await fetch(API_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: formBody.toString(),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `API responded with status ${response.status}`,
      };
    }

    const text = await response.text();

    // Apps Script's ContentService returns a plain-text JSON string.
    // Follow redirects manually (Apps Script may redirect to an auth page on
    // first deploy, or return a redirect response we need to follow).
    if (text.startsWith("<!DOCTYPE") || text.startsWith("<html")) {
      return {
        success: false,
        error: "Apps Script returned an HTML page — is the web-app deployment set to 'Anyone' (not 'Only myself')?",
      };
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      return { success: false, error: "Apps Script returned invalid JSON: " + text.slice(0, 200) };
    }

    if (data.success === false || data.status === "error") {
      return {
        success: false,
        error: (data.message as string) || (data.error as string) || "Unknown error",
      };
    }

    return {
      success: true,
      data: (data.data as T) || (data as T),
    };
  } catch (error) {
    console.error(`Google Apps Script API POST error (${action}):`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

// Health check
export async function ping(): Promise<ApiResponse<{ message: string }>> {
  return callApi<{ message: string }>("ping");
}

/**
 * Measure connectivity + latency to the Apps Script write endpoint.
 * Returns a decorated result the admin "Sync & Data" diagnostics panel can show.
 */
export async function testWritePath(): Promise<{
  ok: boolean;
  latencyMs: number | null;
  error?: string;
  message?: string;
}> {
  const startedAt = Date.now();
  const res = await ping();
  const latencyMs = Date.now() - startedAt;
  if (res.success) {
    return { ok: true, latencyMs, message: res.data?.message ?? "pong" };
  }
  return { ok: false, latencyMs, error: res.error ?? "Unknown error" };
}

// ---------------------------------------------------------------------------
// Audit log (read from Google Sheet "Audit Logs" tab)
// ---------------------------------------------------------------------------

/** Raw shape returned by the Apps Script `getAuditLogs` helper (sheet columns). */
export interface RawAuditLogEntry {
  "Timestamp"?: string;
  "Action Type"?: string;
  "Action"?: string;
  "Actor Name"?: string;
  "Actor Role"?: string;
  "Actor OpenID"?: string;
  "Target Type"?: string;
  "Target ID"?: string;
  "Details"?: string;
  "Success"?: string;
  "IP Address"?: string;
}

/**
 * Fetch audit log entries from the Google Sheet via Apps Script.
 * Returns newest-first rows from the "Audit Logs" sheet.
 */
/** Clear all audit entries from the Google Sheet "Audit Log" tab. */
export async function clearAuditLogs(): Promise<ApiResponse<{ removed: number; message: string }>> {
  return callApi<{ removed: number; message: string }>("clear_audit");
}

export async function fetchAuditLogs(
  limit = 500,
  offset = 0,
): Promise<ApiResponse<RawAuditLogEntry[]>> {
  // Audit log reads can be slow (Apps Script cold start / sheet reads), so use
  // a generous timeout instead of the 8s default.
  return callApi<RawAuditLogEntry[]>(
    "audit_logs",
    {
      limit: String(limit),
      offset: String(offset),
    },
    30000
  );
}

// Verify profile (admin only - requires secret)
export async function verifyProfile(
  hrsId: string,
  bloodGroup: string,
  donorConsent: string
): Promise<ApiResponse<{ message: string; hrs_id: string; blood_group: string; donor_consent: string }>> {
  if (!ENV.googleAppsScriptSecret) {
    return {
      success: false,
      error: "API secret not configured",
    };
  }

  return postApi<{ message: string; hrs_id: string; blood_group: string; donor_consent: string }>("verify_profile", {
    action: "verify_profile",
    api_secret: ENV.googleAppsScriptSecret,
    hrs_id: hrsId,
    blood_group: bloodGroup,
    donor_consent: donorConsent,
  });
}

// Record donation (admin only - requires secret)
export async function recordDonation(
  hrsId: string,
  donationTime: string
): Promise<ApiResponse<{ message: string }>> {
  if (!ENV.googleAppsScriptSecret) {
    return {
      success: false,
      error: "API secret not configured",
    };
  }

  return postApi<{ message: string }>("record_donation", {
    action: "record_donation",
    api_secret: ENV.googleAppsScriptSecret,
    hrs_id: hrsId,
    donation_time: donationTime,
  });
}

// Delete profiles by HRS ID(s) - permanently removes rows from the sheet
export async function deleteProfiles(
  hrsIds: string[]
): Promise<ApiResponse<{ deleted: number; message: string }>> {
  if (!ENV.googleAppsScriptSecret) {
    return {
      success: false,
      error: "API secret not configured",
    };
  }

  if (!hrsIds.length) {
    return { success: false, error: "No records selected for deletion" };
  }

  return postApi<{ deleted: number; message: string }>("delete_profiles", {
    action: "delete_profiles",
    api_secret: ENV.googleAppsScriptSecret,
    hrs_ids: JSON.stringify(hrsIds),
  });
}

// Update an existing profile (admin only). The Apps Script action is `update_profile`
// and accepts the editable fields: name, dob, gender, mobile, email, city, area,
// blood_group, donor_consent. Storage consent is intentionally not editable here —
// it is recorded at registration time and verified.
export async function updateProfile(
  hrsId: string,
  fields: {
    name?: string;
    dob?: string;
    gender?: string;
    mobile?: string;
    email?: string;
    city?: string;
    area?: string;
    bloodGroup?: string;
    donorConsent?: string;
  }
): Promise<ApiResponse<{ message: string }>> {
  if (!ENV.googleAppsScriptSecret) {
    return { success: false, error: "API secret not configured" };
  }

  // Build the payload — only include keys with non-empty values so the Apps
  // Script can leave untouched fields alone.
  const body: Record<string, string> = {
    action: "update_profile",
    api_secret: ENV.googleAppsScriptSecret,
    hrs_id: hrsId,
  };

  if (fields.name !== undefined) body.full_name = fields.name;
  if (fields.dob !== undefined) body.date_of_birth = fields.dob;
  if (fields.gender !== undefined) body.gender = fields.gender;
  if (fields.mobile !== undefined) body.phone_number = fields.mobile;
  if (fields.email !== undefined) body.email = fields.email;
  if (fields.city !== undefined) body.city = fields.city;
  if (fields.area !== undefined) body.area = fields.area;
  if (fields.bloodGroup !== undefined) body.blood_group = fields.bloodGroup;
  if (fields.donorConsent !== undefined) body.donor_consent = fields.donorConsent;

  return postApi<{ message: string }>("update_profile", body);
}

// Send verification email to a donor after they are verified
export async function sendVerificationEmail(
  hrsId: string
): Promise<ApiResponse<{ sent: boolean; skipped?: boolean; reason?: string; to?: string }>> {
  if (!ENV.googleAppsScriptSecret) {
    return {
      success: false,
      error: "API secret not configured",
    };
  }

  return postApi<{ sent: boolean; skipped?: boolean; reason?: string; to?: string }>(
    "send_verification_email",
    {
      action: "send_verification_email",
      api_secret: ENV.googleAppsScriptSecret,
      hrs_id: hrsId,
    }
  );
}
