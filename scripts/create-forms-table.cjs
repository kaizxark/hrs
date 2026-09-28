/**
 * Creates the `forms` table for the admin form-activation feature.
 *
 * Run: node scripts/create-forms-table.cjs
 *
 * Design:
 *  - id: uuid primary key → doubles as the unguessable public form token
 *    (/form/<id>), so no separate secret column is needed.
 *  - type: 'pending' | 'registration'
 *  - active: only one active form at a time (server enforces atomically).
 *  - RLS enabled with NO policies → anon/authenticated roles are denied;
 *    only the service role (server) can read/write.
 */
const { Pool } = require('pg');
require('dotenv').config();

const TABLE_SQL = `
create table if not exists public.forms (
    id uuid primary key default uuid_generate_v4(),
    type text not null check (type in ('pending', 'registration')),
    active boolean not null default true,
    created_by text,
    created_at timestamptz not null default now(),
    terminated_at timestamptz,
    submissions integer not null default 0
);
alter table public.forms enable row level security;
drop trigger if exists forms_default_deny on public.forms;
`;

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await pool.query(TABLE_SQL);
    const { rows } = await pool.query(
      `select column_name, data_type from information_schema.columns where table_name = 'forms' order by ordinal_position`
    );
    console.log("forms table ready. Columns:");
    for (const r of rows) console.log(`  ${r.column_name}: ${r.data_type}`);
    const { rows: rls } = await pool.query(
      `select schemaname, tablename, rowsecurity from pg_tables where tablename = 'forms'`
    );
    console.log("RLS enabled:", rls[0]?.rowsecurity ?? false);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
