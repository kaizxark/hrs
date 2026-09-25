/**
 * Strip a literal "\n" (backslash + n) and surrounding whitespace that can
 * sneak into env values when they are pasted into a dashboard or added via a
 * shell `echo` with a trailing newline. Without this, nodemailer would try to
 * resolve host "smtp.gmail.com\n" and every SMTP send would throw.
 */
function cleanSmtpValue(value: string | undefined): string {
  return (value ?? "").replace(/\\n/g, "").trim();
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Supabase configuration
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  // Google Sheets CSV — publicly shared sheet export URL (read-only, fast)
  // Can be overridden via GOOGLE_SHEETS_CSV_URL env var.
  googleSheetsCsvUrl:
    process.env.GOOGLE_SHEETS_CSV_URL ??
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTI9MNntfRcNQsCJCPBhNIbsc-ZCh5kqw28-x7Aa3kfeUwBCXDd7TPAt2pb6ag8HWdwkcpgsqeSKQmF/pub?output=csv",
  // Google Apps Script API — write path only (verify, donate, delete)
  googleAppsScriptUrl:
    process.env.GOOGLE_APPS_SCRIPT_URL ??
    "https://script.google.com/macros/s/AKfycbxFyg9eR8ceIUevuQ0QfJHEz8MihFU1la_vE968HHawb5zeL9PixIy5DzH-VrqbQc7n/exec",
  googleAppsScriptSecret: process.env.GOOGLE_APPS_SCRIPT_SECRET ?? "",

  // SMTP (nodemailer) — sends the rich HTML verification email card from the
  // server. Leave unset to keep the Google Apps Script email as a fallback.
  //
  // Env values sometimes arrive with a literal trailing "\n" (newline pasted
  // into a dashboard or CLI). That one character makes nodemailer fail DNS /
  // auth resolution (e.g. host "smtp.gmail.com\n"), so every SMTP send throws
  // and silently falls back to Apps Script. Normalize by stripping "\n" and
  // trimming whitespace around all SMTP values.
  smtpHost: cleanSmtpValue(process.env.SMTP_HOST),
  smtpPort: Number(cleanSmtpValue(process.env.SMTP_PORT) || 587),
  smtpSecure: cleanSmtpValue(process.env.SMTP_SECURE) === "true",
  smtpUser: cleanSmtpValue(process.env.SMTP_USER),
  smtpPass: cleanSmtpValue(process.env.SMTP_PASS),
  smtpFrom:
    cleanSmtpValue(process.env.SMTP_FROM) ||
    "HRS Blood Donor Portal <no-reply@hrs.org>",
  // Public site URL linked from the email card ("link to this website").
  appUrl: process.env.APP_URL ?? "https://hrs-camp.vercel.app",
  // Admin reset password for security-sensitive operations
  adminResetPassword: process.env.ADMIN_RESET_PASSWORD ?? "",

  // Google Forms pending submissions — a SEPARATE published spreadsheet that
  // receives Google Form entries. The auto-sync background job reads this
  // sheet, maps fields, and appends new profiles to the main Profiles tab.
  pendingGoogleSheetsCsvUrl:
    process.env.GOOGLE_SHEETS_PENDING_CSV_URL ??
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTbcxSz8zvNpukdEboD3ayPGYa1Ozj1OMgzIVNOteUK5ILsIBvoKuGcTTF4GoOfPsg-LShmcBHg6beA/pub?output=csv",
};
