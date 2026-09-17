/**
 * Admin Sheet helpers
 *
 * Admin tab columns: Name, Username, Password
 *
 * Read path: published Google Sheet CSV (`fetchCsvTab("admin")`) — fast,
 * no Apps Script.
 */
import { fetchCsvTab } from "./googleSheetsApi";

/**
 * Fetch admin data from the Google Sheets Admin tab.
 * Returns the row whose Username matches the given username, or null.
 */
export async function getAdminFromSheet(username: string) {
  const res = await fetchCsvTab("admin", 30_000);
  if (!res.success) {
    console.log(
      `[AdminSheet] fetchCsvTab("admin") for "${username}": no data (${res.error})`
    );
    return null;
  }
  for (const row of res.data) {
    const u = (row.Username || row.username || "").trim();
    if (u === username.trim()) {
      console.log(
        `[AdminSheet] fetchCsvTab("admin") for "${username}": found match`,
        JSON.stringify({ name: row.Name || row.name })
      );
      return {
        username: u,
        name: row.Name || row.name || undefined,
        password: row.Password || row.password || undefined,
      };
    }
  }
  console.log(
    `[AdminSheet] no exact match for "${username}" in CSV rows:`,
    res.data.map((r) => r.Username || r.username)
  );
  return null;
}
