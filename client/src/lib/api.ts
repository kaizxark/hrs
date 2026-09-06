/**
 * HRS API Client
 * Client-side API functions for HRS data operations
 */
import { trpc } from "./trpc";

// Types matching the backend API
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

export interface PublicProfile {
  "HRS ID": string;
  "Full Name": string;
  "Blood Group": string;
  City: string;
  Area: string;
  "Last Donation Time"?: string;
  "Availability Status"?: string;
}

export interface ProfilesResponse {
  profiles: Profile[];
  count: number;
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

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Health check
export function useHealthCheck() {
  return trpc.hrs.health.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 60000,
  });
}

// Get all profiles (admin)
export function useProfiles() {
  return trpc.hrs.profiles.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });
}

// Get single profile
export function useProfile(hrsId: string | undefined) {
  return trpc.hrs.profile.useQuery(
    { hrsId: hrsId || "" },
    {
      enabled: !!hrsId,
      refetchOnWindowFocus: false,
      staleTime: 30000,
    }
  );
}

// Get public profiles
export function usePublicProfiles() {
  return trpc.hrs.publicProfiles.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });
}

// Get statistics
export function useStatistics() {
  return trpc.hrs.statistics.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });
}

// Verify profile mutation
export function useVerifyProfile() {
  return trpc.hrs.verifyProfile.useMutation({
    retry: 1,
  });
}

// Record donation mutation
export function useRecordDonation() {
  return trpc.hrs.recordDonation.useMutation({
    retry: 1,
  });
}

// Helper to convert API profile to AdminRecord
export function convertApiProfileToAdminRecord(profile: Profile): {
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
} {
  const id = profile["HRS ID"] || null;
  const name = profile["Full Name"] || "Unknown";
  const dob = profile["Date of Birth"] || "";
  const gender = profile["Gender"] || "Prefer not to say";
  const mobile = profile["Phone Number"] || "Not provided";
  const email = profile["Email"] || "Not provided";
  const bloodGroup = profile["Blood Group"] || "—";
  const city = profile["City"] || "Unknown";
  const area = profile["Area"] || "Unknown";
  const registrationTime = profile["Registration Time"] || "";
  const storageConsent = profile["Data Storage Consent"] || "";
  const donationConsent = profile["Donor Consent"] || "";
  const verificationStatus = profile["Verification Status"] || "";
  const verifiedTime = profile["Verification Time"] || "";
  const donationCount = profile["Blood Donation Count"] || "0";
  const lastDonationTime = profile["Last Donation Time"] || "";
  const nextEligibleTime = profile["Next Eligible Time"] || "";
  const availabilityStatus = profile["Availability Status"] || "";
  const publicVisibility = profile["Public Directory Visibility"] || "";

  // Calculate age
  const birthDate = new Date(dob);
  const age = Number.isNaN(birthDate.getTime())
    ? 0
    : new Date().getFullYear() - birthDate.getFullYear();

  // Determine status
  const rawStatus = verificationStatus.toUpperCase();
  const isPending =
    rawStatus.includes("PENDING") || rawStatus.includes("VERIFICATION");

  // Consent status
  const consentStatus =
    storageConsent.toUpperCase() === "YES"
      ? "Yes"
      : storageConsent.toUpperCase() === "NO"
        ? "No"
        : "Pending";

  // Donor consent
  const donorConsent = isPending
    ? null
    : donationConsent.toUpperCase() === "YES";

  // Parse dates
  const parseSheetDate = (value: string | undefined) => {
    if (!value?.trim()) return null;
    const normalized = value.trim().replace(" ", "T");
    const withIndiaOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(normalized)
      ? normalized
      : `${normalized}+05:30`;
    const date = new Date(withIndiaOffset);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const registeredAt = parseSheetDate(registrationTime)?.toISOString() ?? null;
  const verifiedAt = parseSheetDate(verifiedTime)?.toISOString() ?? null;
  const nextEligibleAt =
    parseSheetDate(nextEligibleTime)?.toISOString() ?? null;

  // Collect all donation dates dynamically
  const donationDates: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const dateKey = `Donation ${i} Date`;
    const dateValue = profile[dateKey];
    if (dateValue && dateValue.trim()) {
      donationDates.push(dateValue.trim());
    }
  }

  // Availability
  const availability = availabilityStatus.toLowerCase().includes("available")
    ? "Available"
    : availabilityStatus.toLowerCase().includes("unavailable")
      ? "Unavailable"
      : donorConsent
        ? "Available"
        : "Unavailable";

  // Public visibility
  const publicVisible = Boolean(
    id &&
      rawStatus === "VERIFIED" &&
      donorConsent === true &&
      bloodGroup &&
      bloodGroup !== "—" &&
      publicVisibility.toUpperCase() === "YES"
  );

  // Initials
  const initials =
    name
      .split(" ")
      .map(n => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";

  // Last donation
  const lastDonationAt =
    lastDonationTime?.trim() ||
    (donationDates.length > 0 ? donationDates[donationDates.length - 1] : null);

  return {
    id,
    name,
    dateOfBirth: dob || "Not recorded",
    age: isNaN(age) ? 0 : age,
    gender,
    mobile,
    email,
    group: bloodGroup,
    location: city,
    area,
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

// Helper to convert API public profile to donor card data
export function convertApiPublicProfileToDonor(profile: PublicProfile) {
  return {
    id: profile["HRS ID"],
    name: profile["Full Name"],
    group: profile["Blood Group"],
    location: profile["City"],
    area: profile["Area"],
    lastDonation: profile["Last Donation Time"] || null,
    availability: profile["Availability Status"] || "Available",
    initials: profile["Full Name"]
      .split(" ")
      .map((n: string) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase(),
  };
}
