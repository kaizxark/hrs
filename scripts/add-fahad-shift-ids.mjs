/**
 * One-off: add Fahad as HRS-0001 (VERIFIED) and shift every existing profile
 * ID up by one (HRS-0001→0002 … HRS-0186→0187).
 *
 * Safety design:
 *  - Renumber in DESCENDING order so no update ever collides with an
 *    existing ID ("HRS ID" has a UNIQUE constraint).
 *  - The old→new mapping is saved to scripts/hrs-id-shift-mapping.csv for
 *    reversibility.
 *  - Fahad is only inserted AFTER every existing row has been renumbered,
 *    so a mid-run failure cannot create a duplicate 0001.
 */
import { createClient } from "/home/kaizxark/Desktop/hrs/node_modules/@supabase/supabase-js/dist/index.mjs";
import { appendFileSync, writeFileSync } from "node:fs";
import "/home/kaizxark/Desktop/hrs/node_modules/dotenv/config.js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const APPLY = process.argv.includes("--apply");

const FAHAD = {
  "HRS ID": "HRS-0001",
  "Full Name": "Fahad",
  "Date of Birth": "2002-04-13",
  gender: "Male",
  "Phone Number": "8123768320",
  email: "fahadahmed4803@gmail.com",
  city: "Tumakuru",
  area: "P.H. Rich Colony",
  "Registration Time": "2026-09-13T10:35:44+05:30",
  "Blood Group": "B+",
  "Blood Group Status": "Recorded",
  "Data Storage Consent": "YES",
  "Donor Consent": "YES",
  "Verification Status": "VERIFIED",
  "Verification Time": "2026-09-13T14:54:26+05:30",
  "Blood Donation Count": "0",
  "Last Donation Time": null,
  "Next Eligible Time": null,
  "Availability Status": "AVAILABLE",
  "Public Directory Visibility": "YES",
};

const { data: all, error } = await sb.from("profiles").select('"HRS ID","Full Name"');
if (error) { console.log("ERROR:", error.message); process.exit(1); }

// Parse numeric part, detect gaps or anomalies
const rows = (all ?? [])
  .map(r => ({ id: r["HRS ID"], name: r["Full Name"], num: parseInt(String(r["HRS ID"]).replace(/\D/g, ""), 10) }))
  .filter(r => !Number.isNaN(r.num));
const nums = rows.map(r => r.num).sort((a, b) => a - b);
const maxNum = nums.at(-1) ?? 0;
const expected = Array.from({ length: maxNum }, (_, i) => i + 1);
const missing = expected.filter(n => !nums.includes(n));
const dupes = nums.filter((n, i) => nums.indexOf(n) !== i);

console.log(`Rows: ${rows.length} | max ID: HRS-${String(maxNum).padStart(4, "0")}`);
if (missing.length) console.log(`⚠ Gaps in ID sequence: ${missing.map(n => `HRS-${String(n).padStart(4, "0")}`).join(", ")}`);
if (dupes.length) { console.log("✗ DUPLICATE IDs present — aborting:", dupes); process.exit(1); }

if (!APPLY) {
  console.log(`DRY RUN: would renumber HRS-0001…HRS-${String(maxNum).padStart(4, "0")} → +1 (${rows.length} updates), then insert Fahad as HRS-0001 (VERIFIED).`);
  process.exit(0);
}

writeFileSync("scripts/hrs-id-shift-mapping.csv", "old_id,new_id,name\n");
let done = 0;
for (const num of [...nums].sort((a, b) => b - a)) {
  const row = rows.find(r => r.num === num);
  const oldId = `HRS-${String(num).padStart(4, "0")}`;
  const newId = `HRS-${String(num + 1).padStart(4, "0")}`;
  const { error: upErr } = await sb.from("profiles").update({ "HRS ID": newId }).eq('"HRS ID"', oldId).select('"HRS ID"');
  if (upErr) {
    console.log(`✗ FAILED at ${oldId} → ${newId} (${row?.name}): ${upErr.message}`);
    console.log(`Run state: ${done}/${rows.length} renumbered. Re-run after inspecting scripts/hrs-id-shift-mapping.csv`);
    process.exit(1);
  }
  appendFileSync("scripts/hrs-id-shift-mapping.csv", `${oldId},${newId},"${row?.name ?? ""}"\n`);
  done += 1;
}
console.log(`Renumbered ${done}/${rows.length} rows (descending, no collisions).`);

const { error: insErr } = await sb.from("profiles").insert(FAHAD);
if (insErr) {
  console.log("✗ Fahad insert failed:", insErr.message);
  process.exit(1);
}
console.log("Inserted Fahad as HRS-0001 (VERIFIED).");

const { count: total } = await sb.from("profiles").select("*", { count: "exact", head: true });
const { data: fahad } = await sb.from("profiles").select('"HRS ID","Full Name"').eq('"HRS ID"', "HRS-0001");
const { data: sanity } = await sb.from("profiles").select('"HRS ID"').in('"HRS ID"', ["HRS-0187", "HRS-0002"]);
console.log(`Total: ${total} | HRS-0001 = ${fahad?.[0]?.["Full Name"]} | sanity (expect Fahad/0187): ${JSON.stringify(sanity?.map(r => r["HRS ID"]))}`);
