# 🩸 HRS BLOOD DONOR PORTAL

[![React](https://img.shields.io/badge/React-v19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-v5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4.0-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com)
[![tRPC](https://img.shields.io/badge/tRPC-v11-2596BE?logo=trpc&logoColor=white)](https://trpc.io)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-v0.44-C5F74F?logo=drizzle&logoColor=black)](https://orm.drizzle.team)
[![Vite](https://img.shields.io/badge/Vite-v7-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![Vitest](https://img.shields.io/badge/Vitest-v2-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

A high-reliability, full-stack blood donation management portal engineered to streamline donor onboarding, real-time blood group matching, volunteer coordination, verification workflows, and automated reporting.

---

## 🏗️ System Architecture & Dual-Path Data Pipeline

The HRS Blood Donor Portal implements a **dual-path data architecture** that separates high-frequency read queries from slow transactional mutations to ensure instantaneous page loads and rock-solid consistency:

```mermaid
flowchart TD
    subgraph Client["Frontend (React 19 + shadcn/ui + Tailwind v4)"]
        UI["Public Donor Search / Admin Dashboard / Volunteer Portal"]
    end

    subgraph Server["Backend (Node.js + Express + tRPC v11)"]
        Router["tRPC Procedures (Public / Protected / Admin / Staff)"]
        MemCache["In-Memory CSV Cache (10-15s Auto-Poller)"]
        AuditLogger["Audit Logger & Security Middleware"]
    end

    subgraph DataStorage["External Storage & APIs"]
        SheetsRead["Google Sheets CSV Export (Fast Read Path)"]
        GASWrite["Google Apps Script Endpoint (Secure Write Path)"]
        MySQL[("MySQL Database (Drizzle ORM: Users, Staff, Audit Logs)")]
    end

    UI -->|1. Fast Query| Router
    Router -->|2. In-Memory Lookup| MemCache
    MemCache -.->|Polls every 10-15s| SheetsRead

    UI -->|3. Mutation Request| Router
    Router -->|4. Authenticate & Log| AuditLogger
    AuditLogger --> MySQL
    Router -->|5. Execute Mutation| GASWrite
    GASWrite -->|Appends / Modifies| SheetsRead
```

### ⚡ Read Path (Ultra-Fast)
* **Google Sheets CSV Polling**: In-memory caching engine polls the public CSV export every 10–15 seconds with `cache: "no-store"` to eliminate stale browser responses.
* **Instant Filter Execution**: Zero-latency searching and filtering across donor profiles, blood groups (`A+`, `A-`, `B+,` `B-`, `O+`, `O-`, `AB+`, `AB-`), localities, and donation eligibility.

### 🛡️ Write Path (Transactional & Audited)
* **Google Apps Script Bridge**: All mutations (profile verification, donation history updates, profile removals, verification email dispatches) execute via authenticated POST requests with `GOOGLE_APPS_SCRIPT_SECRET`.
* **Append-Only Audit Logging**: Every administrative and staff modification is durably logged with timestamp, actor OpenID/username, IP address, target profile, and execution payload.

---

## ✨ Key Features & Capabilities

* **🩸 Comprehensive Donor Directory**: Searchable directory with real-time multi-facet filtering (blood group, city, district, availability status, and last donation date).
* **📋 Volunteer & Staff Management**: Dedicated staff authentication portal with scrypt-hashed password security, session cookies, and role-based permissions (`admin`, `volunteer`, `staff`).
* **📊 Analytics & Real-Time Statistics**: Dynamic calculation of active donor counts, regional blood type distribution, and upcoming eligible donors.
* **📥 Multi-Format Directory Export**:
  * **CSV Export**: Instant download of sanitized directory datasets.
  * **XLSX Export**: Native binary spreadsheet generation powered by zero-dependency `xlsxWriter`.
* **🔐 Dual Authentication Stack**:
  * **Manus OAuth**: Full OAuth flow storing users in MySQL with JWT session cookies (`app_session_id`).
  * **Safari ITP Fallback**: Dual-mirrors session tokens to `sessionStorage` as Bearer tokens to withstand aggressive third-party cookie restrictions.

---

## 📂 Project Organization

```
hrs/
├── client/                     # Frontend Single Page Application
│   └── src/
│       ├── pages/              # Route views (Home, Admin, About, Volunteer)
│       ├── components/ui/      # Radix UI + shadcn design system
│       ├── contexts/           # React ThemeContext (Dark/Light mode)
│       ├── hooks/              # Custom hooks for tRPC and session state
│       └── lib/                # API client, staff auth helpers, formatters
├── server/                     # Backend Server Infrastructure
│   ├── _core/
│   │   ├── trpc.ts             # tRPC procedure definitions & access control
│   │   ├── hrsRouter.ts        # HRS donor profiles, donations, sync queries
│   │   ├── auditRouter.ts      # Audit log endpoints
│   │   ├── googleSheetsApi.ts  # CSV polling, parsing, caching & queries
│   │   ├── googleAppsScriptApi.ts # Secure write-path mutations
│   │   ├── oauth.ts            # OAuth token exchange & user sync
│   │   └── sdk.ts              # Authentication & token verification
├── drizzle/                    # Database Schema & Migrations
│   └── schema.ts               # Drizzle table schemas (users, staff, audit_logs)
├── shared/                     # Shared Universal Constants & Types
│   └── const.ts                # Session cookie names, OAuth constants, error codes
└── attached_assets/            # Brand graphics, logos, and UI assets
```

---

## 🚀 Quick Start Guide

### Prerequisites
* **Node.js**: v20.x or newer
* **pnpm**: v9.x or v10.x
* **MySQL Database**: Local or remote instance (PlanetScale, AWS RDS, Railway)

### Installation & Local Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/kaizxark/hrs.git
   cd hrs
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

3. **Configure Environment Variables**:
   Create a `.env` file in the root directory:
   ```env
   DATABASE_URL=mysql://user:password@localhost:3306/hrs_database
   JWT_SECRET=your_super_secret_jwt_key
   OAUTH_SERVER_URL=https://oauth.example.com
   OWNER_OPEN_ID=your_owner_open_id
   GOOGLE_SHEETS_CSV_URL=https://docs.google.com/spreadsheets/d/e/.../pub?output=csv
   GOOGLE_APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
   GOOGLE_APPS_SCRIPT_SECRET=your_google_apps_script_secret
   ```

4. **Initialize Database Schema**:
   ```bash
   pnpm db:push
   ```

5. **Start Development Server**:
   ```bash
   pnpm dev
   ```
   Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🛠️ Development & Quality Scripts

| Command | Purpose |
| :--- | :--- |
| `pnpm dev` | Launch Vite frontend and Express server with Hot Module Replacement |
| `pnpm build` | Generate production bundle with Vite and esbuild |
| `pnpm start` | Execute production server from `dist/` |
| `pnpm check` | Perform full TypeScript static type analysis (`tsc --noEmit`) |
| `pnpm format` | Auto-format entire codebase with Prettier |
| `pnpm test` | Execute test suites with Vitest runner |
| `pnpm db:push` | Synchronize Drizzle schema directly with MySQL database |

---

## 📜 License & Credits

Developed with ❤️ by **Shaik Mohammed Ehtesham** ([@kaizxark](https://github.com/kaizxark)) under the **MIT License**.
