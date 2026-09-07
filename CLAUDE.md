# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HRS Blood Donor Portal - A full-stack web application for managing blood donor records. The app integrates with Google Sheets (via CSV export) for data storage and Google Apps Script for write operations. Uses Manus OAuth for authentication.

## Stack

- **Frontend**: React 19, Vite 7, Tailwind CSS v4, Radix UI components, Recharts for analytics
- **Backend**: Express.js, tRPC v11, Drizzle ORM, MySQL
- **Auth**: Manus OAuth with JWT sessions (via `jose` library) and HTTP-only cookies
- **Monorepo**: Single package with pnpm, aliased imports via `@/` and `@shared/`

## Commands

```bash
# Development (runs server + Vite dev server with hot reload)
pnpm dev

# Production build (bundles both client and server)
pnpm build

# Start production server
pnpm start

# Type checking
pnpm check

# Formatting (Prettier)
pnpm format

# Tests (Vitest)
pnpm test              # Run all tests
pnpm test -- <file>    # Run specific test file

# Database migrations
pnpm db:push           # Generate and run Drizzle migrations
```

## Architecture

### Directory Structure

```
client/src/          # React frontend
  pages/             # Route-level components (Home, Admin, About)
  components/ui/     # Radix-based shadcn/ui components
  lib/               # Utilities (api.ts, trpc.ts, utils.ts)
  contexts/          # React contexts (ThemeContext)
  hooks/             # Custom hooks

server/              # Express + tRPC backend
  _core/             # Server infrastructure
    trpc.ts          # tRPC procedures (public, protected, admin)
    context.ts       # Request context with authenticated user
    hrsRouter.ts     # HRS data operations (profiles, donations)
    googleAppsScriptApi.ts  # Google Apps Script API (write path)
    googleSheetsApi.ts      # Google Sheets CSV polling (read path)
    oauth.ts         # OAuth callback handler
    env.ts           # Environment variables
  routers.ts         # Root tRPC router combining all sub-routers

drizzle/             # Database schema and migrations
  schema.ts          # Table definitions (users table)

shared/              # Shared code between client and server
  const.ts           # Constants (cookie names, error messages, OAuth state)
```

### Path Aliases

- `@/` → `client/src/`
- `@shared/` → `shared/`
- `@assets/` → `attached_assets/`

### Dual-Path Data Architecture

The app uses two data sources for HRS donor data:

1. **Read Path (Fast)**: Google Sheets CSV export polled every 5 seconds
   - `googleSheetsApi.ts` fetches the publicly-shared CSV
   - Parses CSV and caches profiles in memory
   - SSE broadcaster at `/api/sync-events` pushes notifications to admin clients
   - Pre-converts raw profiles to `AdminRecord` shape on server (avoids client-side O(N) conversion)

2. **Write Path (Slow, ~10-40s)**: Google Apps Script API
   - Used only for mutations: verify, update, record donation, delete
   - Requires `GOOGLE_APPS_SCRIPT_SECRET` env var
   - All write operations are POST requests with form-urlencoded bodies

### tRPC Procedures

- `publicProcedure` - No authentication required
- `protectedProcedure` - Requires authenticated user (any role)
- `adminProcedure` - Requires authenticated user with `role === 'admin'`

### Key Routers

- **hrs router** (all publicProcedure): `health`, `profiles`, `profile`, `publicProfiles`, `statistics`, `syncProfiles`, `verifyProfile`, `recordDonation`, `deleteProfiles`, `updateProfile`, `sendVerificationEmail`
- **auth router** (public): `me`, `logout`
- **system router** (admin): system operations

### Authentication Flow

1. Client initiates OAuth via SDK (`server/_core/sdk.ts`)
2. OAuth callback at `/api/oauth/callback` exchanges code for token
3. User is upserted into MySQL `users` table with their `openId`
4. JWT session cookie (`app_session_id`) is set as HTTP-only cookie
5. Context extracts user from cookie on each request via `sdk.authenticateRequest()`
6. Safari ITP fallback: session token is mirrored to `sessionStorage` as Bearer token

### Environment Variables

Key variables in `.env`:
- `DATABASE_URL` - MySQL connection string
- `JWT_SECRET` - Cookie signing secret
- `OAUTH_SERVER_URL` - Manus OAuth server URL
- `OWNER_OPEN_ID` - Admin user's OpenID (for owner detection)
- `GOOGLE_SHEETS_CSV_URL` - Public Google Sheet CSV export URL
- `GOOGLE_APPS_SCRIPT_URL` - Google Apps Script endpoint
- `GOOGLE_APPS_SCRIPT_SECRET` - API secret for write operations

## Key Files for Common Tasks

- **Add a new tRPC endpoint**: Add to `server/_core/hrsRouter.ts` or create new router
- **Modify data read path**: Edit `server/_core/googleSheetsApi.ts`
- **Modify data write path**: Edit `server/_core/googleAppsScriptApi.ts`
- **Add UI component**: Add to `client/src/components/ui/` following shadcn patterns
- **Add page**: Create in `client/src/pages/` and register route in `client/src/App.tsx`
- **Database schema change**: Edit `drizzle/schema.ts`, then run `pnpm db:push`
- **Environment variables**: Set in `.env` (see `server/_core/env.ts` for all options)

## Testing

Tests use Vitest. Test files are co-located: `server/auth.logout.test.ts`. Run with `pnpm test`.
