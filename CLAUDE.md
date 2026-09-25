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

HRS Blood Donor Portal is a full-stack web application for managing blood donor records. It uses a **Supabase PostgreSQL database** for both read and write operations.

The app integrates with Supabase for data storage and authentication. Authentication is via Manus OAuth with JWT sessions.

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
  auditRouter.ts     # Audit log read/write (Supabase)
  supabaseApi.ts     # Supabase PostgreSQL API (data operations)
  emailService.ts    # Email service (SMTP)
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
| `DATABASE_URL` | MySQL connection string (for drizzle) |
| `JWT_SECRET` | Cookie signing secret |
| `OAUTH_SERVER_URL` | Manus OAuth server URL |
| `OWNER_OPEN_ID` | Admin user's OpenID (for owner detection) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anonymous key (for client-side operations) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (for server-side operations) |
| `GOOGLE_APPS_SCRIPT_URL` | Google Apps Script endpoint (legacy - fallback for email) |
| `GOOGLE_APPS_SCRIPT_SECRET` | API secret for Google Apps Script (fallback) |

---

## Data Architecture

### Supabase PostgreSQL Database

All data operations (both read and write) go directly to the Supabase PostgreSQL database:

- **Read operations**: Direct SQL queries to the `profiles` table via `supabaseApi.ts`
- **Write operations**: Direct SQL updates/inserts/deletes to the `profiles` table via `supabaseApi.ts`
- **Real-time queries**: No polling needed - data is always current
- **Background tasks**: Only email sending and periodic audits run in background

### Database Schema (`drizzle/schema.ts`)

- `users` table — backs OAuth auth flow (openId, name, email, role, loginMethod)
- `audit_logs` table — append-only record of every privileged action
- `staff` table — admin-created volunteer accounts (username/password login)
- `profiles` table — stores donor profiles (HRS ID, blood group, contact info, donation history, etc.)

### Key Data Operations

**Profile Operations**:
- `getProfiles()` - Fetch all donor profiles
- `getProfileByHrsId()` - Fetch single profile by HRS ID
- `getPublicProfiles()` - Fetch profiles visible in public directory
- `verifyProfile()` - Mark profile as verified
- `recordDonation()` - Increment donation count for a profile
- `updateProfile()` - Edit profile details
- `deleteProfiles()` - Remove profiles by HRS ID
- `addPerson()` - Add new verified profile

**Statistics & Reporting**:
- `getStatistics()` - Calculate donor statistics (blood groups, cities, availability, etc.)
- `getLocations()` - Get cities and areas with donor counts
- `dataHealth()` - Run data quality checks on profiles table

**Export Operations**:
- `buildDirectoryCsv()` - Generate CSV export of all profiles
- `buildDirectoryXlsx()` - Generate Excel export of all profiles

### Email Service

- Primary: Direct SMTP via `emailService.ts` (configured via SMTP env vars)
- Fallback: Google Apps Script (if SMTP not configured)
- Used for verification emails and notifications

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
3. **Data path changes**: Edit `server/_core/supabaseApi.ts` — this controls all Supabase operations.
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
2. Import necessary functions from `supabaseApi.ts` or `emailService.ts`
3. Add the router to `server/routers.ts`
4. Expose the type via `AppRouter`

### Modifying the data layer

- Edit `server/_core/supabaseApi.ts` — this controls all database operations via Supabase
- Edit `drizzle/schema.ts` for schema changes, then run `pnpm db:push`

### Adding a UI component

1. Create in `client/src/components/ui/` following shadcn/ui patterns
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

## Supabase Integration

### Client Initialization

- Public client (anon key): Used in `supabaseApi.ts` for read operations
- Admin client (service role key): Used in `supabaseApi.ts` for write operations (bypasses RLS)

### Security

- Row Level Security (RLS) policies should be defined in Supabase dashboard
- Service role key is only used on the backend for admin operations
- Anon key is safe to expose to frontend as RLS policies protect data

### Migration Notes

- Migrated from Google Sheets CSV (read path) and Google Apps Script (write path)
- All operations now go directly to Supabase PostgreSQL
- No more caching layer or background poller needed for data freshness
- Export functions still generate CSV/XLSX from database query results