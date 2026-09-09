// Quick volunteer-sheet integration using Apps Script write + read
// Volunteer tab columns: Full Name, Username, Password
import { callApi, postApi } from "./googleAppsScriptApi";
import { hashPassword } from "./password";
import { ENV } from "./env";

export async function createVolunteerSheet(data: { username: string; displayName: string; password: string }) {
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
  });
}

export async function getVolunteerFromSheet(username: string) {
  // Volunteers live in the "Volunteer" tab of the spreadsheet (not the
  // donor Profiles tab), so read via the Apps Script `listVolunteers` endpoint
  // — mirroring how admin credentials are read with `listAdmins`.
  const res = await callApi("listVolunteers", { username: username.trim() });
  if (!res.success || !res.data) {
    console.log(
      `[VolunteerSheet] listVolunteers for "${username}": no data (success=${res.success}, error=${res.error})`
    );
    return null;
  }
  const list = Array.isArray(res.data) ? res.data : [res.data];
  for (const row of list as any[]) {
    const u = (row.Username || row.username)?.toString();
    if (u === username.trim()) {
      return {
        username: u,
        displayName: (row["Full Name"] || row.fullName || row.Name || row.name)?.toString(),
        passwordHash: (row.Password || row.password)?.toString(),
      };
    }
  }
  console.log(
    `[VolunteerSheet] no exact match for "${username}" in rows:`,
    list.map((r: any) => r.Username || r.username)
  );
  return null;
}