/**
 * Google Apps Script API Service
 * Handles all communication with the HRS Google Apps Script backend
 */
import { ENV } from "./env";

const API_BASE_URL = ENV.googleAppsScriptUrl;

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

async function callApi<T>(
  action: string,
  params: Record<string, string> = {}
): Promise<ApiResponse<T>> {
  try {
    const url = new URL(API_BASE_URL);
    url.searchParams.set("action", action);

    // Add all params to URL
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

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

async function postApi<T>(
  action: string,
  body: Record<string, string>
): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(API_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `API responded with status ${response.status}`,
      };
    }

    const data = await response.json();

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

// Get all profiles (for admin)
export async function getProfiles(): Promise<ApiResponse<ProfilesResponse>> {
  return callApi<ProfilesResponse>("profiles");
}

// Get single profile by HRS ID
export async function getProfileById(
  hrsId: string
): Promise<ApiResponse<Profile>> {
  return callApi<Profile>("profile", { hrs_id: hrsId });
}

// Get public donor directory
export async function getPublicProfiles(): Promise<
  ApiResponse<{ profiles: PublicProfile[]; count: number }>
> {
  return callApi<{ profiles: PublicProfile[]; count: number }>(
    "public_profiles"
  );
}

// Get statistics
export async function getStatistics(): Promise<ApiResponse<Statistics>> {
  return callApi<Statistics>("statistics");
}

// Verify profile (admin only - requires secret)
export async function verifyProfile(
  hrsId: string,
  bloodGroup: string,
  donorConsent: string
): Promise<ApiResponse<{ message: string }>> {
  if (!ENV.googleAppsScriptSecret) {
    return {
      success: false,
      error: "API secret not configured",
    };
  }

  return postApi<{ message: string }>("verify_profile", {
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
