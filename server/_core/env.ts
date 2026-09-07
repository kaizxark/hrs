export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Google Sheets CSV — publicly shared sheet export URL (read-only, fast)
  // Can be overridden via GOOGLE_SHEETS_CSV_URL env var.
  googleSheetsCsvUrl:
    process.env.GOOGLE_SHEETS_CSV_URL ??
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTI9MNntfRcNQsCJCPBhNIbsc-ZCh5kqw28-x7Aa3kfeUwBCXDd7TPAt2pb6ag8HWdwkcpgsqeSKQmF/pub?output=csv",
  // Google Apps Script API — write path only (verify, donate, delete)
  googleAppsScriptUrl:
    process.env.GOOGLE_APPS_SCRIPT_URL ??
    "https://script.google.com/macros/s/AKfycbyvYdKPNHePIlXO40Ra9zAPUfzeG4yU4PktzfutXHIdhs15Ri6cpMmSmjZMGUUmDswf/exec",
  googleAppsScriptSecret: process.env.GOOGLE_APPS_SCRIPT_SECRET ?? "",
};
