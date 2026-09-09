# Deploying HRS on Vercel

This file documents how to run the HRS Blood Donor Portal on Vercel's
serverless platform, what works out of the box, and what degrades compared to
the long-running Node server (`pnpm start`).

> **Before you start** — the app is engineered around a long-running process
> (a background poller refreshes the Google Sheets cache every 10–15s and SSE
> pushes updates to admin clients). Vercel has no always-on process, so the
> deployment below approximates that behaviour with lazy per-request cache
> top-ups and client-side polling. Expect **~90–95% parity** — not byte-for-byte
> identical. If you need identical behaviour, a persistent host (Railway,
> Render, a $5 VPS) runs the existing `pnpm start` unchanged.

---

## How the Vercel adaptation works

| Concern | Local (`pnpm start`) | Vercel |
|---|---|---|
| Cache freshness | Background poller every 10–15s | Lazy: each read tops up the cache if it is older than 15s (`ensureFreshCache`, one shared fetch per instance) |
| Admin live updates | SSE push on every cache update | SSE works per-instance; the admin UI **also polls every 15s** (`refetchInterval`), so updates arrive ≤15s late across instances |
| Writes (verify / donate / delete / update / email) | Apps Script POST, 10–40s | Same, but the function needs `maxDuration` raised (fluid compute) |
| Staff accounts (login/list/create) | DB `staff` table, falls back to in-memory store | Same — **in-memory fallback only without a database** (accounts are ephemeral per instance) |
| OAuth logins (Manus) | MySQL `users` table | Needs `DATABASE_URL` (external MySQL). Without it, OAuth sign-in silently does nothing — the site's staff login still works |
| Audit trail | Apps Script + sheet | Same (App-Script-backed, DB-less) |
| Sync & Data panel | Full poller controls | `setAutoSync` starts/stops a poller only for that instance — treated as advisory |

### Files added/changed

- `api/index.ts` — Vercel function entry. Mounts the same Express app from the
  pre-built `dist/index.js` (`import { createApp }`); never binds a port or
  starts the poller (`server/_core/index.ts` skips both when `VERCEL === "1"`).
- `vercel.json` — build command, static output dir, and rewrites:
  - `/api/*` → the function (tRPC, OAuth, SSE)
  - `/assets/*` → static files
  - everything else (incl. `/admin`, `/about`, `/volunteer` deep links) →
    `/index.html` (SPA routing)
- `server/_core/googleSheetsApi.ts` — `ensureFreshCache()` (15s TTL + shared
  in-flight fetch) called by every read procedure in `hrsRouter` and by
  `auditRouter.list`.
- `client/src/pages/Admin.tsx` — 15s `refetchInterval` fallback on the
  profiles/locations queries (SSE upgrades it to instant when it works).

---

## Env vars to configure on Vercel

Required (project → Settings → Environment Variables, then redeploy):

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Session cookie signing (any long random string) |
| `GOOGLE_APPS_SCRIPT_SECRET` | Write-path secret shared with your Apps Script |
| `GOOGLE_SHEETS_CSV_URL` *(optional)* | Overrides the built-in spreadsheet CSV URL |
| `GOOGLE_APPS_SCRIPT_URL` *(optional)* | Overrides the Apps Script endpoint |
| `DATABASE_URL` *(recommended)* | External MySQL (TiDB Cloud free tier, PlanetScale, DigitalOcean) — restores OAuth users + persistent staff accounts |
| `VITE_OAUTH_PORTAL_URL`, `VITE_APP_ID` | Only if OAuth sign-in is part of your prod setup |

> The client bundle also expects `VITE_ANALYTICS_ENDPOINT` and
> `VITE_ANALYTICS_WEBSITE_ID` as build-time vars; without them the analytics
> snippet stays as literal placeholders (harmless).

**Do not copy `.env`** — set values directly in the Vercel dashboard or via
`vercel env add`.

---

## Deploy steps

1. Install the CLI: `npm i -g vercel` (or push to a GitHub repo and import it
   in the Vercel dashboard — the repo already contains `vercel.json`).
2. From the repo root: `vercel` (first run) — it picks up `vercel.json`
   automatically, installs with pnpm, and runs `pnpm build`.
3. Set the env vars above (dashboard or `vercel env add`), then `vercel --prod`.
4. Verify:
   - `https://<your-app>.vercel.app/` — homepage loads with donor stats
   - `/admin` — deep link works (SPA rewrite)
   - `/api/trpc/hrs.health` — returns the Apps Script ping result
   - Log in with a staff/admin account (Google Sheets credentials)
   - The Sync button and profile edits round-trip (writes)

### Fluid compute (important for writes)

Node functions default to a **10s** hard timeout on Vercel, but the Apps
Script write path takes 10–40s. `api/index.ts` already exports
`export const maxDuration = 60`. To make that effective:

- **Hobby:** opt in to *Fluid compute* under Project → Settings → Functions
  (limits: 60s max duration) — otherwise functions are capped at 10s.
- **Pro:** fluid compute allows up to 300s — edit `maxDuration` in
  `api/index.ts` if you ever observe write timeouts.

(The exact limits change over time — double-check
https://vercel.com/docs/functions/fluid-compute and
https://vercel.com/docs/functions/limitations when you deploy.)

---

## Known trade-offs on Vercel (read before you commit to this path)

1. **Cold starts add one CSV fetch.** The first read on a cold instance blocks
   ~2.5s (up to 35s worst case if Google is slow). Warm instances answer from
   cache in <100ms. Vercel keeps instances warm for a while after traffic, so
   this mostly matters after idle gaps.
2. **No cross-instance SSE.** The 15s admin polling covers it; "Sync" status
   latency on the Sync & Data panel can lag one poll cycle.
3. **Staff accounts & OAuth without MySQL are ephemeral** — created accounts
   disappear when the instance is recycled. Add `DATABASE_URL` to fix both.
4. **There is no Vercel-native always-on cron poller** (Hobby cron runs about
   once a day) — that's why freshness is lazy per-request instead.
5. `vercel.json` serves static assets for `/admin`-style SPA routes client-side;
   the pre-built `dist/public` is only for Vercel's static hosting — do not
   serve it from the function.

---

## Alternatives

- **Persistent host (zero code changes):** Railway / Render / any VPS running
  `pnpm start` — identical behaviour to today, 10s polling, SSE everywhere,
  no fluid-compute dance. This is the "deploy it just like now" option.
- **Hybrid:** keep this Vercel deployment for the public site and run the
  poller/SSE on a tiny always-on host pointed at the same Google Sheet — more
  moving parts, not needed for the current traffic.