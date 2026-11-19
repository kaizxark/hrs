import { describe, expect, it } from "vitest";
import {
  convertApiProfileToAdminRecord,
  convertApiPublicProfileToDonor,
  type Profile,
  type PublicProfile,
} from "./api";

describe("convertApiProfileToAdminRecord", () => {
  it("converts a standard verified donor profile correctly", () => {
    const raw: Profile = {
      "HRS ID": "HRS-101",
      "Full Name": "Rahul Sharma",
      "Date of Birth": "1998-05-15",
      Gender: "Male",
      "Phone Number": "9876543210",
      Email: "rahul@example.com",
      City: "Tumakuru",
      Area: "Batawadi",
      "Registration Time": "2026-01-10 10:30:00",
      "Blood Group": "O+",
      "Data Storage Consent": "YES",
      "Donor Consent": "YES",
      "Verification Status": "VERIFIED",
      "Public Directory Visibility": "YES",
      "Blood Donation Count": "2",
      "Donation 1 Date": "2025-06-01",
      "Donation 2 Date": "2025-12-01",
    };

    const record = convertApiProfileToAdminRecord(raw);

    expect(record.id).toBe("HRS-101");
    expect(record.name).toBe("Rahul Sharma");
    expect(record.initials).toBe("RS");
    expect(record.group).toBe("O+");
    expect(record.location).toBe("Tumakuru");
    expect(record.area).toBe("Batawadi");
    expect(record.consent).toBe(true);
    expect(record.donorConsent).toBe(true);
    expect(record.donationCount).toBe(2);
    expect(record.donationDates).toHaveLength(2);
    expect(record.publicVisible).toBe(true);
  });

  it("handles missing or empty fields with sensible defaults", () => {
    const raw: Profile = {};
    const record = convertApiProfileToAdminRecord(raw);

    expect(record.id).toBeNull();
    expect(record.name).toBe("Unknown");
    expect(record.initials).toBe("U");
    expect(record.dateOfBirth).toBe("Not recorded");
    expect(record.age).toBe(0);
    expect(record.group).toBe("—");
    expect(record.consent).toBe(false);
    expect(record.donorConsent).toBe(false);
    expect(record.publicVisible).toBe(false);
    expect(record.donationCount).toBe(0);
    expect(record.donationDates).toEqual([]);
  });

  it("extracts 2-letter initials for single-word, multi-word, and empty names", () => {
    const single = convertApiProfileToAdminRecord({ "Full Name": "Fahad" });
    expect(single.initials).toBe("F");

    const multi = convertApiProfileToAdminRecord({ "Full Name": "Mohd Ali Khan" });
    expect(multi.initials).toBe("MA");

    const empty = convertApiProfileToAdminRecord({ "Full Name": "" });
    expect(empty.initials).toBe("U"); // Falls back to "Unknown" -> "U"
  });

  it("marks donor unavailable if donor consent is NO", () => {
    const raw: Profile = {
      "HRS ID": "HRS-102",
      "Full Name": "Sneha P",
      "Donor Consent": "NO",
      "Verification Status": "VERIFIED",
    };
    const record = convertApiProfileToAdminRecord(raw);
    expect(record.donorConsent).toBe(false);
    expect(record.availability).toBe("Unavailable");
    expect(record.publicVisible).toBe(false);
  });
});

describe("convertApiPublicProfileToDonor", () => {
  it("converts public profile and formats initials", () => {
    const pub: PublicProfile = {
      "HRS ID": "HRS-500",
      "Full Name": "Priya Nair",
      "Blood Group": "A+",
      City: "Tumakuru",
      Area: "Sira Gate",
      "Availability Status": "Available",
      "Last Donation Time": "2026-02-15",
    };

    const donor = convertApiPublicProfileToDonor(pub);
    expect(donor.id).toBe("HRS-500");
    expect(donor.name).toBe("Priya Nair");
    expect(donor.initials).toBe("PN");
    expect(donor.group).toBe("A+");
    expect(donor.location).toBe("Tumakuru");
    expect(donor.area).toBe("Sira Gate");
    expect(donor.availability).toBe("Available");
    expect(donor.lastDonation).toBe("2026-02-15");
  });
});
