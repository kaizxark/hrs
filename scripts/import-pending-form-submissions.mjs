/**
 * One-off import: pending Google Form submissions → test Supabase `profiles`.
 *
 * Source: the SAME published pending-form CSV the old pendingFormSync read
 * (read-only fetch from Google — production app and its Sheets are untouched).
 * Field mapping mirrors server/_core/pendingFormSync.ts (Sheets edition):
 * phone country-code strip, consent TRUE→YES, Submission time → Registration
 * Time, Dedup by phone.
 *
 * Column targets follow the restored pending flow: Verification PENDING,
 * Availability PENDING, Visibility NO, Blood Group empty — awaiting admin
 * verification in the dashboard.
 */
import { createClient } from "/home/kaizxark/Desktop/hrs/node_modules/@supabase/supabase-js/dist/index.mjs";
import { readFileSync } from "node:fs";
import "/home/kaizxark/Desktop/hrs/node_modules/dotenv/config.js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const APPLY = process.argv.includes("--apply");

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

function stripCountryCode(phone) {
  const digits = String(phone).replace(/\D/g, "");
  return digits.length >= 12 && digits.startsWith("91") ? digits.slice(2) : digits;
}

const text = readFileSync("/tmp/pending-sheet.csv", "utf8");
const table = parseCsv(text);
const headers = table[0];
const consentCol = headers.findIndex(h => h.startsWith("Consent"));
const col = name => headers.indexOf(name);

const rows = table.slice(1).map(r => ({
  submissionId: r[col("Submission ID")],
  submittedAt: r[col("Submission time")],
  fullName: (r[col("Full Name")] ?? "").trim(),
  dob: r[col("Date of Birth")],
  gender: r[col("Gender")],
  phone: stripCountryCode(r[col("Phone number")]),
  email: r[col("Email")],
  city: r[col("City")],
  area: r[col("Area / Locality")],
  consent: (r[consentCol] ?? "").trim().toUpperCase() === "TRUE" ? "YES" : "NO",
}));

// Dedup by phone, keep earliest submission
const byPhone = new Map();
for (const r of rows) {
  if (!r.fullName || !r.phone) continue;
  const prev = byPhone.get(r.phone);
  if (!prev || r.submittedAt < prev.submittedAt) byPhone.set(r.phone, r);
}
const unique = [...byPhone.values()];
console.log(`Form rows: ${rows.length}, unique donors by phone: ${unique.length}`);

// Existing phones in test DB
const { data: existing } = await sb.from("profiles").select('"HRS ID","Phone Number"');
const existingPhones = new Set((existing ?? []).map(r => String(r["Phone Number"] ?? "").replace(/\D/g, "")));

// Next HRS ID
let maxNum = 0;
for (const r of existing ?? []) {
  const n = parseInt(String(r["HRS ID"] ?? "").replace(/\D/g, ""), 10);
  if (!Number.isNaN(n) && n > maxNum) maxNum = n;
}

const CITY_MAP = { Tumkur: "Tumakuru", Bangalore: "Bengaluru Urban", Mysore: "Mysuru" };

const toInsert = [];
for (const r of unique) {
  if (existingPhones.has(r.phone)) {
    console.log(`SKIP (phone exists in test DB): ${r.fullName} ${r.phone}`);
    continue;
  }
  maxNum += 1;
  toInsert.push({
    "HRS ID": `HRS-${String(maxNum).padStart(4, "0")}`,
    "Full Name": r.fullName,
    "Date of Birth": r.dob || null,
    gender: r.gender || null,
    "Phone Number": r.phone,
    email: r.email || null,
    city: CITY_MAP[r.city?.trim()] ?? r.city ?? null,
    area: r.area || null,
    "Registration Time": r.submittedAt ? r.submittedAt.replace(" ", "T") + "+05:30" : new Date().toISOString(),
    "Blood Group": "",
    "Blood Group Status": "",
    "Data Storage Consent": r.consent,
    "Donor Consent": "YES",
    "Verification Status": "PENDING",
    "Verification Time": null,
    "Blood Donation Count": "0",
    "Availability Status": "PENDING",
    "Public Directory Visibility": "NO",
  });
}

if (!APPLY) {
  console.log("DRY RUN — rows that would be inserted:");
  for (const row of toInsert) console.log(` ${row["HRS ID"]} ${row["Full Name"]} ${row["Phone Number"]} ${row.city}/${row.area} ${row["Verification Status"]}`);
  console.log("Run with --apply to insert.");
  process.exit(0);
}

for (const row of toInsert) {
  const { error } = await sb.from("profiles").insert(row);
  if (error) console.log(`ERROR inserting ${row["HRS ID"]}:`, error.message);
  else console.log(`IMPORTED ${row["HRS ID"]} — ${row["Full Name"]} (${row["Phone Number"]}) as PENDING`);
}
console.log("Done.");
