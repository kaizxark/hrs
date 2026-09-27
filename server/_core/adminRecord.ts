/**
 * AdminRecord — the canonical shape of a donor record as the admin UI,
 * volunteer directory, and email templates consume it.
 *
 * It used to live in googleSheetsApi.ts (the legacy Google Sheets read path).
 * That module is gone now that every read/write goes straight to Supabase;
 * the type itself is still the app-wide contract, so it lives here.
 */
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
