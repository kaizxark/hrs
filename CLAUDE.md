# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Commands

### Development

| Command | Description |
|---|---|
| `pnpm dev` | Run the app in development mode (Vite + Express with hot reload) |
| `pnpm build` | Build the production bundle (Vite + esbuild) |
| `pnpm start` | Start the production server |
| `pnpm check` | Type-check the entire project with tsc |
| `pnpm format` | Format all files with Prettier |
| `pnpm test` | Run all tests with Vitest |
| `pnpm test -- <file>` | Run a specific test file |
| `pnpm db:push` | Generate and run Drizzle MySQL migrations |

### Single Test

```bash
pnpm test -- client/src/components/ComponentName.test.ts
```

or

```bash
pnpm test -- server/auth.logout.test.ts
```

---

## High-Level Architecture

### Overview

HRS Blood Donor Portal is a full-stack web application for managing blood donor records. It uses a **dual-path data architecture**:

- **Read path (fast)**: Google Sheets CSV export polled every 10–15 seconds. Used for all read operations — profiles, locations, statistics, exports.
- **Write path (slow, 10–40s)**: Google Apps Script API. Used only for mutations — verify profiles, record donations, delete profiles, send verification emails.

The app integrates with Google Sheets for data storage and Google Apps Script for write operations. Authentication is via Manus OAuth with JWT sessions.

### Directory Structure

```
client/src/           # React frontend
  pages/             # Route-level components (Home, Admin, About, Volunteer)
  components/ui/     # Radix-based shadcn/ui components
  lib/               # Utilities (api.ts, trpc.ts, utils.ts, staffAuth.ts)
  contexts/          # React contexts (ThemeContext)
  hooks/             # Custom hooks

server/_core/         # Server infrastructure
  trpc.ts            # tRPC procedures (public, protected, admin)
  context.ts         # Request context with authenticated user
  hrsRouter.ts       # HRS data operations (profiles, donations)
  systemRouter.ts    # System operations (notify owner)
  auditRouter.ts     # Audit log read/write (Google Sheets)
  googleAppsScriptApi.ts  # Google Apps Script API (write path)
  googleSheetsApi.ts # Google Sheets CSV polling (read path)
  oauth.ts           # OAuth callback handler
  env.ts             # Environment variables
  cookies.ts         # Cookie management
  sdk.ts             # OAuth SDK utilities

drizzle/             # Database schema and migrations
  schema.ts          # Table definitions (users, audit_logs, staff)

shared/              # Shared code between client and server
  const.ts           # Constants (cookie names, error messages, OAuth state)
```

### Path Aliases

- `@/` → `client/src/`
- `@shared/` → `shared/`
- `@assets/` → `attached_assets/`

### Authentication Flow

1. Client initiates OAuth via SDK (`server/_core/sdk.ts`)
2. OAuth callback at `/api/oauth/callback` exchanges code for token
3. User is upserted into MySQL `users` table with their `openId`
4. JWT session cookie (`app_session_id`) is set as HTTP-only cookie
5. Context extracts user from cookie on each request via `sdk.authenticateRequest()`
6. Safari ITP fallback: session token is mirrored to `sessionStorage` as Bearer token

### tRPC Procedures

- `publicProcedure` — No authentication required
- `protectedProcedure` — Requires authenticated user (any role)
- `adminProcedure` — Requires authenticated user with `role === 'admin'`
- `volunteerProcedure` — Requires authenticated volunteer or admin
- `staffProcedure` — Staff username/password authentication

### Key Routers

- **hrs router** (all `publicProcedure`): `health`, `profiles`, `profile`, `publicProfiles`, `statistics`, `syncProfiles`, `verifyProfile`, `recordDonation`, `deleteProfiles`, `updateProfile`, `sendVerificationEmail`
- **auth router** (public): `me`, `logout`
- **system router** (admin): `health`, `notifyOwner`
- **audit router** (public): `list`, `clear`
- **staff router** (auth): `login`, `logout`, `me`, `list`, `create`, `delete`, `update`

### Environment Variables

Key variables in `.env` (see `server/_core/env.ts`):

| Variable | Description |
|---|---|
| `DATABASE_URL` | MySQL connection string |
| `JWT_SECRET` | Cookie signing secret |
| `OAUTH_SERVER_URL` | Manus OAuth server URL |
| `OWNER_OPEN_ID` | Admin user's OpenID (for owner detection) |
| `GOOGLE_SHEETS_CSV_URL` | Public Google Sheet CSV export URL (read path) |
| `GOOGLE_APPS_SCRIPT_URL` | Google Apps Script endpoint (write path) |
| `GOOGLE_APPS_SCRIPT_SECRET` | API secret for write operations |

---

## Data Architecture

### Read Path (Google Sheets CSV)

- `googleSheetsApi.ts` fetches the publicly-shared CSV export URL
- CSV is parsed and cached in memory
- Background poller runs every 10 seconds (configurable) to keep cache fresh
- SSE broadcaster at `/api/sync-events` pushes notifications to admin clients when cache updates
- Pre-converts raw profiles to `AdminRecord` shape on server (avoids client-side O(N) conversion)
- Exported as CSV (.csv) or XLSX (.xlsx) via `buildDirectoryCsv()` / `buildDirectoryXlsx()`

### Write Path (Google Apps Script)

- All write operations are POST requests with form-urlencoded bodies
- Operations: `verifyProfile`, `recordDonation`, `deleteProfiles`, `updateProfile`, `sendVerificationEmail`
- Requires `GOOGLE_APPS_SCRIPT_SECRET` env var
- All write operations go through `server/_core/googleAppsScriptApi.ts`
- Write path is slow (~10–40s), so use sparingly

### Database Schema (`drizzle/schema.ts`)

- `users` table — backs OAuth auth flow (openId, name, email, role, loginMethod)
- `audit_logs` table — append-only record of every privileged action
- `staff` table — admin-created volunteer accounts (username/password login)

---

## Development Workflow

### Starting the app

```bash
pnpm dev
```

Runs the Vite dev server with hot reload on the client and Express on the server.

### Making changes

1. **Frontend changes**: Edit files in `client/src/`. Components go in `client/src/components/ui/`, pages in `client/src/pages/`.
2. **Backend API changes**: Modify procedures in `server/_core/hrsRouter.ts` or create new routers.
3. **Data path changes**: Edit `server/_core/googleSheetsApi.ts` (read path) or `server/_core/googleAppsScriptApi.ts` (write path).
4. **Database schema**: Edit `drizzle/schema.ts`, then run `pnpm db:push`.

### Testing

- Tests use Vitest. Test files are co-located with the code they test.
- Example: `server/auth.logout.test.ts`
- Run all tests: `pnpm test`
- Run a specific test: `pnpm test -- <file-path>`

### Type checking

```bash
pnpm check
```

---

## Key Files for Common Tasks

### Adding a new tRPC endpoint

1. Add the procedure to `server/_core/hrsRouter.ts` (or create a new router)
2. Import necessary functions from `googleSheetsApi.ts` or `googleAppsScriptApi.ts`
3. Add the router to `server/routers.ts`
4. Expose the type via `AppRouter`

### Modifying the data read path

- Edit `server/_core/googleSheetsApi.ts` — this controls CSV fetching, caching, polling, and all derived queries (profiles, statistics, locations, public profiles, exports)

### Modifying the data write path

- Edit `server/_core/googleAppsScriptApi.ts` — this controls all mutations to Google Sheets via Apps Script

### Adding a UI component

1. Create in `client/src/components/ui/` following shadcn patterns
2. Add to `client/src/pages/` if it's a page-level component
3. Register the route in `client/src/App.tsx`

### Adding a page

1. Create in `client/src/pages/`
2. Register route in `client/src/App.tsx`

### Database schema change

1. Edit `drizzle/schema.ts`
2. Run `pnpm db:push` to generate and run migrations

---

## Code Quality Notes

- **Prettier** is configured for formatting (`pnpm format`)
- **ESLint** / type checking via `pnpm check`
- **Superjson** is used as the tRPC transformer for automatic serialization of complex types
- **Date-fns** is used for date manipulation throughout the codebase
- The codebase uses **Tailwind CSS v4** with `tailwind-merge` for class name composition
- **Radix UI** components are used through shadcn/ui patterns

---

## Google Sheets Integration

### Read Path Details

- The publicly shared Google Sheet CSV URL is in `ENV.googleSheetsCsvUrl` (defaults to a specific URL, can be overridden via `GOOGLE_SHEETS_CSV_URL` env var)
- CSV is fetched with `cache: "no-store"` to prevent browser caching
- Parse uses a custom CSV parser that handles quoted fields
- Background poller interval is configurable via the admin panel (`setAutoSync` tRPC procedure) or via `setPollInterval()` function

### Write Path Details

- All mutations go through Google Apps Script
- API endpoint: `ENV.googleAppsScriptUrl` (default, can be overridden)
- Secret: `ENV.googleAppsScriptSecret` (required env var)
- Form-urlencoded bodies are used
- All write operations include audit logging via `logAudit()`

---

## Authentication Details

### Manus OAuth

- OAuth flow handled by `@vitejs/plugin-manus-runtime`
- User info stored in MySQL `users` table
- Session cookie: `app_session_id` (HTTP-only)
- Role-based access: `role === 'admin'` for admin procedures

### Staff (username/password) Login

- Separate from OAuth — uses Google Sheets Volunteer/Admin tabs or DB `staff` table
- Session cookie: `hrs_staff_session_v2` (HTTP-only)
- Passwords hashed with scrypt
- Admin account credentials stored in Google Sheets Admin tab

---

## Export Format

### CSV Export

- `buildDirectoryCsv()` returns `{ filename, csv }`
- Includes all columns from the in-memory cache
- Date formatted as `YYYY-MM-DD` in filename

### XLSX Export

- `buildDirectoryXlsx()` returns `{ filename, data }` where data is base64-encoded
- Uses zero-dependency `xlsxWriter`
- Same columns as CSV export

---

## Audit Logging

- All privileged actions are logged via `logAudit()` in `server/_core/auditLogger.ts`
- Logs written to Google Sheets Audit Log tab (append-only)
- Includes: action, actor, target, success status, IP address, details
- Readable via the `auditRouter.list` procedure