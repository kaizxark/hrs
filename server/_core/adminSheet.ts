import { callApi } from "./googleAppsScriptApi";

/**
 * Fetch admin data from the Google Sheets Admin tab.
 * Returns the row whose Username matches the given username, or null.
 */
export async function getAdminFromSheet(username: string) {
  const res = await callApi("listAdmins", { username: username.trim() });
  if (!res.success || !res.data) {
    console.log(`[AdminSheet] listAdmins for "${username}": no data (success=${res.success}, error=${res.error})`);
    return null;
  }
  const list = Array.isArray(res.data) ? res.data : [res.data];
  console.log(`[AdminSheet] listAdmins for "${username}": found ${list.length} row(s)`, JSON.stringify(list[0]));
  for (const row of list as any[]) {
    const u = (row.Username || row.username)?.toString();
    if (u === username.trim()) {
      return {
        username: u,
        name: (row.Name || row.name)?.toString(),
        password: (row.Password || row.password)?.toString(),
      };
    }
  }
  console.log(`[AdminSheet] no exact match for "${username}" in rows:`, list.map((r: any) => r.Username || r.username));
  return null;
}
