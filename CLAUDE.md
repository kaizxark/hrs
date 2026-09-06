# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HRS Blood Donor Portal - A full-stack web application for managing blood donor records. The app integrates with a Google Apps Script backend for data operations and uses Manus OAuth for authentication.

## Stack

- **Frontend**: React 19, Vite 7, Tailwind CSS v4, Radix UI components
- **Backend**: Express.js, tRPC v11, Drizzle ORM, MySQL
- **Auth**: Manus OAuth with JWT sessions (via `jose` library)
- **Monorepo**: Single package with pnpm, aliased imports via `@/` and `@shared/`

## Commands

```bash
# Development (runs server + Vite dev server)
pnpm dev

# Production build
pnpm build

# Start production server
pnpm start

# Type checking
pnpm check

# Formatting
pnpm format

# Tests
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
    trpc.ts          # tRPC initialization, procedures (public, protected, admin)
    context.ts       # Request context with authenticated user
    hrsRouter.ts     # HRS data operations (profiles, donations)
    googleAppsScriptApi.ts  # Google Apps Script API client
    oauth.ts         # OAuth callback handler
    env.ts           # Environment variables
  routers.ts         # Root tRPC router combining all sub-routers

drizzle/             # Database schema and migrations
  schema.ts          # Table definitions (users table)

shared/              # Shared code between client and server
  types.ts           # Type exports
  const.ts           # Constants (cookie names, error messages)
```

### Path Aliases

- `@/` → `client/src/`
- `@shared/` → `shared/`
- `@assets/` → `attached_assets/`

### API Design

The app uses tRPC for type-safe API communication. Key routers:

1. **auth router** (public): `me`, `logout`
2. **hrs router** (mixed): `health`, `profiles`, `profile`, `publicProfiles`, `statistics`, `verifyProfile`, `recordDonation`
3. **system router** (protected/admin): system operations

#### tRPC Procedures

- `publicProcedure` - No authentication required
- `protectedProcedure` - Requires authenticated user
- `adminProcedure` - Requires authenticated user with `role === 'admin'`

### Authentication Flow

1. Client initiates OAuth via SDK (`server/_core/sdk.ts`)
2. OAuth callback at `/api/oauth/callback` exchanges code for token
3. User is upserted into MySQL `users` table
4. JWT session cookie (`app_session_id`) is set
5. Context extracts user from cookie on each request

### Data Flow

HRS data is stored in Google Sheets, accessed via Google Apps Script API:

- `googleAppsScriptApi.ts` calls the Apps Script endpoint
- `hrsRouter.ts` exposes these operations as tRPC procedures
- Client uses `trpc.hrs.*` hooks from `client/src/lib/api.ts`

## Key Files for Common Tasks

- **Add a new tRPC endpoint**: Add to `server/_core/hrsRouter.ts` or create new router in `server/_core/`
- **Add UI component**: Add to `client/src/components/ui/` following shadcn patterns
- **Add page**: Create in `client/src/pages/` and register route in `client/src/App.tsx`
- **Database schema change**: Edit `drizzle/schema.ts`, then run `pnpm db:push`
- **Environment variables**: Set in `.env` (see `server/_core/env.ts` for all options)

## Testing

Tests use Vitest. Test files are co-located: `server/auth.logout.test.ts`. Run with `pnpm test`.
