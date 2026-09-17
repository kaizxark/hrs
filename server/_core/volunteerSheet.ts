/**
 * Volunteer Sheet helpers
 *
 * Volunteer tab columns: Full Name, Username, Password
 *
 * Read path: published Google Sheet CSV (`fetchCsvTab("volunteer")`) — fast,
 * no Apps Script. Write path: Apps Script API (`postApi`) for mutations.
 */
import { postApi } from "./googleAppsScriptApi";
import { fetchCsvTab } from "./googleSheetsApi";
import { hashPassword } from "./password";
import { ENV } from "./env";

/* ------------------------------------------------------------------ */
/* Write (Apps Script)                                                  */
/* ------------------------------------------------------------------ */

export async function createVolunteerSheet(data: {
  username: string;
  displayName: string;
  password: string;
  mobile?: string;
}) {
  const ph = await hashPassword(data.password);
  return postApi("create_volunteer", {
    // postApi's first argument is only used for error logging — the Apps
    // Script backend dispatches on `action` and authorizes via `api_secret`,
    // so BOTH must be present in the POST body for every write call.
    action: "create_volunteer",
    api_secret: ENV.googleAppsScriptSecret,
    username: data.username.trim(),
    full_name: data.displayName.trim(),
    password_hash: ph,
    mobile: (data.mobile || "").trim(),
  });
}

/** Delete a volunteer from the Google Sheet Volunteer tab by username. */
export async function deleteVolunteerSheet(username: string) {
  return postApi("delete_volunteer", {
    action: "delete_volunteer",
    api_secret: ENV.googleAppsScriptSecret,
    username: username.trim(),
  });
}

/* ------------------------------------------------------------------ */
/* Read (CSV)                                                          */
/* ------------------------------------------------------------------ */

export async function getVolunteerFromSheet(username: string) {
  const res = await fetchCsvTab("volunteer", 30_000);
  if (!res.success) {
    console.log(
      `[VolunteerSheet] fetchCsvTab("volunteer") for "${username}": no data (${res.error})`
    );
    return null;
  }
  for (const row of res.data) {
    const u = (row.Username || row.username || "").trim();
    if (u === username.trim()) {
      return {
        username: u,
        displayName:
          row["Full Name"] || row.fullName || row.Name || row.name || undefined,
        passwordHash: row.Password || row.password || undefined,
      };
    }
  }
  console.log(
    `[VolunteerSheet] no exact match for "${username}" in CSV rows:`,
    res.data.map((r) => r.Username || r.username)
  );
  return null;
}

/**
 * List every volunteer from the Google Sheets Volunteer tab.
 * Used by the admin "Staff & Access" view so accounts added directly in the
 * Google Sheet show up alongside DB-created accounts.
 */
export async function listVolunteersFromSheet(): Promise<
  { username: string; displayName: string }[]
> {
  const res = await fetchCsvTab("volunteer", 30_000);
  if (!res.success) {
    console.log(
      `[VolunteerSheet] fetchCsvTab("volunteer") list: no data (${res.error})`
    );
    return [];
  }
  const out: { username: string; displayName: string }[] = [];
  for (const row of res.data) {
    const u = (row.Username || row.username || "").trim();
    if (!u) continue;
    out.push({
      username: u,
      displayName:
        row["Full Name"] || row.fullName || row.Name || row.name || u,
    });
  }
  return out;
}
