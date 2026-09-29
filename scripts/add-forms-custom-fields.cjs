/**
 * Extends the `forms` table with per-form customization columns.
 *
 * Run: node scripts/add-forms-custom-fields.cjs
 *
 *  - title:       admin-set heading shown on the public form page
 *                 (e.g. "HRS Blood Donation Camp — Sept 2026")
 *  - description: admin-set sub-heading shown under the title
 *
 * Both nullable with safe defaults: existing rows keep working and the
 * public form falls back to the standard headings when they are null.
 * Idempotent — uses IF NOT EXISTS.
 */
const { Pool } = require('pg');
require('dotenv').config();

const SQL = `
alter table public.forms add column if not exists title text;
alter table public.forms add column if not exists description text;
`;

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await pool.query(SQL);
    const { rows } = await pool.query(
      `select column_name, data_type from information_schema.columns where table_name = 'forms' order by ordinal_position`
    );
    console.log("forms table columns:");
    for (const r of rows) console.log(`  ${r.column_name}: ${r.data_type}`);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
