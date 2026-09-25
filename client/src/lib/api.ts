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
  donorConsentYes: number;
  donorConsentNo: number;
  bloodGroupCounts: Record<string, number>;
  cityCounts: Record<string, number>;
  availabilityCounts: {
    available: number;
    temporarilyUnavailable: number;
    notParticipating: number;
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
    refetchInterval: 30000,
  });
}

// Get statistics
export function useStatistics() {
  return trpc.hrs.statistics.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });
}

// Get Tumkur locations with auto-detected new areas
export function useLocations() {
  return trpc.hrs.locations.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    retry: 2,
  });
}

// Record donation mutation
export function useRecordDonation() {
  return trpc.hrs.recordDonation.useMutation({
    retry: 1,
  });
}

// Update an existing verified profile (edit personal details, blood group, donor consent)
export function useUpdateProfile() {
  return trpc.hrs.updateProfile.useMutation({
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
  status: "Verified";
  consent: boolean;
  consentStatus: "Yes" | "No";
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

  // Determine status — every profile is verified at creation now
  const rawStatus = verificationStatus.toUpperCase();

  // Consent status
  const consentStatus =
    storageConsent.toUpperCase() === "YES"
      ? "Yes"
      : "No";

  // Donor consent
  const donorConsent = donationConsent.toUpperCase() === "YES";

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

  // Collect all donation dates dynamically. Values are IST wall-clock strings
  // in the CSV — normalize them through the same IST parse as the other
  // timestamp columns so they carry the correct absolute instant.
  const donationDates: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const dateKey = `Donation ${i} Date`;
    const dateValue = profile[dateKey];
    if (dateValue && typeof dateValue === 'string' && dateValue.trim()) {
      donationDates.push(
        parseSheetDate(dateValue)?.toISOString() ?? dateValue.trim()
      );
    }
  }

  // Availability is computed against the actual next-eligible date, not the
  // sheet's status string — Apps Script may not have run by the time the
  // optimistic UI is rendered, so we trust the timestamp.
  const nextEligibleMs = nextEligibleAt ? Date.parse(nextEligibleAt) : null;
  const isEligibleNow = nextEligibleMs === null || nextEligibleMs <= Date.now();
  const availability = isEligibleNow
    ? (donorConsent ? "Available" : "Unavailable")
    : "Unavailable";

  // Public visibility
  const publicVisible = Boolean(
    id &&
      rawStatus === "VERIFIED" &&
      donorConsent === true &&
      bloodGroup &&
      bloodGroup !== "—" &&
      publicVisibility.toUpperCase() === "YES" &&
      isEligibleNow
  );

  // Initials
  const initials =
    name
      .split(" ")
      .map(n => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";

  // Last donation (normalized through the IST parse like donationDates)
  const lastDonationAt =
    parseSheetDate(lastDonationTime)?.toISOString() ??
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
    status: "Verified",
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
