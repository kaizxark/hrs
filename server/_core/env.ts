export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Google Apps Script API configuration
  googleAppsScriptUrl:
    process.env.GOOGLE_APPS_SCRIPT_URL ??
    "https://script.google.com/macros/s/AKfycbyvYdKPNHePIlXO40Ra9zAPUfzeG4yU4PktzfutXHIdhs15Ri6cpMmSmjZMGUUmDswf/exec",
  googleAppsScriptSecret: process.env.GOOGLE_APPS_SCRIPT_SECRET ?? "",
};
