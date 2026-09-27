import { createClient } from "/home/kaizxark/Desktop/hrs/node_modules/@supabase/supabase-js/dist/index.mjs";
import "/home/kaizxark/Desktop/hrs/node_modules/dotenv/config.js";

// One-off DB migration: rewrite legacy spellings in the `profiles` table to
// the official district names used by the new dropdowns. Run with --apply.
const APPLY = process.argv.includes("--apply");

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Mirror of shared/kaDistricts.ts alias maps (script runs outside the app).
const DISTRICT_ALIASES = {
  bangalore: "Bengaluru Urban",
  "bangalore city": "Bengaluru Urban",
  "bangalore urban": "Bengaluru Urban",
  bengaluru: "Bengaluru Urban",
  "bengaluru city": "Bengaluru Urban",
  "bangalore rural": "Bengaluru North",
  "bengaluru rural": "Bengaluru North",
  ramanagar: "Bengaluru South",
  ramanagara: "Bengaluru South",
  belgaum: "Belagavi",
  bellary: "Ballari",
  chamarajanagar: "Chamarajanagara",
  chikballapur: "Chikkaballapura",
  chikkaballapur: "Chikkaballapura",
  chikmagalur: "Chikkamagaluru",
  chikmagaluru: "Chikkamagaluru",
  coorg: "Kodagu",
  gulbarga: "Kalaburagi",
  mysore: "Mysuru",
  raichur: "Raichuru",
  shimoga: "Shivamogga",
  tumkur: "Tumakuru",
  "tumkur city": "Tumakuru",
  vijayanagar: "Vijayanagara",
  yadgir: "Yadagiri",
  canara: "Uttara Kannada",
  "north kanara": "Uttara Kannada",
  karwar: "Uttara Kannada",
  "south kanara": "Dakshina Kannada",
  mangalore: "Dakshina Kannada",
  mangaluru: "Dakshina Kannada",
  hubli: "Dharwad",
  hubballi: "Dharwad",
  "hubli dharwad": "Dharwad",
  "hubballi-dharwad": "Dharwad",
  // official names → themselves (case-insensitive canonicalization)
  ...Object.fromEntries(
    [
      "Bagalkote", "Ballari", "Belagavi", "Bengaluru North", "Bengaluru South",
      "Bengaluru Urban", "Bidar", "Chamarajanagara", "Chikkaballapura",
      "Chikkamagaluru", "Chitradurga", "Dakshina Kannada", "Davanagere",
      "Dharwad", "Gadag", "Hassan", "Haveri", "Kalaburagi", "Kodagu", "Kolar",
      "Koppala", "Mandya", "Mysuru", "Raichuru", "Shivamogga", "Tumakuru",
      "Udupi", "Uttara Kannada", "Vijayanagara", "Vijayapura", "Yadagiri",
    ].map(d => [d.toLowerCase(), d])
  ),
};

const AREA_ALIASES = {
  "tumkur city": "Tumakuru",
  tumkur: "Tumakuru",
};

const clean = s => (s ?? "").replace(/\s+/g, " ").trim();
const normCity = s => {
  const v = clean(s);
  if (!v) return v;
  return DISTRICT_ALIASES[v.toLowerCase()] ?? v;
};
const normArea = s => {
  const v = clean(s);
  if (!v) return v;
  return AREA_ALIASES[v.toLowerCase()] ?? v;
};

// ---- Probe ----
const { data: rows, error } = await sb
  .from("profiles")
  .select('"HRS ID", "Full Name", city, area');
if (error) {
  console.error("select error:", error.message);
  process.exit(1);
}

const cityBuckets = new Map(); // current -> [{id, name}]
const areaBuckets = new Map();
for (const r of rows) {
  const c = clean(r.city);
  const a = clean(r.area);
  if (c && c !== normCity(c)) {
    if (!cityBuckets.has(c)) cityBuckets.set(c, []);
    cityBuckets.get(c).push(r);
  }
  if (a && a !== normArea(a)) {
    if (!areaBuckets.has(a)) areaBuckets.set(a, []);
    areaBuckets.get(a).push(r);
  }
}

console.log(`profiles scanned: ${rows.length}`);
console.log("\nCity values needing rewrite:");
for (const [from, list] of [...cityBuckets.entries()].sort()) {
  console.log(`  "${from}" -> "${normCity(from)}" (${list.length} rows)`);
}
if (!cityBuckets.size) console.log("  (none)");
console.log("\nArea values needing rewrite:");
for (const [from, list] of [...areaBuckets.entries()].sort()) {
  console.log(`  "${from}" -> "${normArea(from)}" (${list.length} rows)`);
}
if (!areaBuckets.size) console.log("  (none)");

if (!APPLY) {
  console.log("\n(dry run — rerun with --apply to write changes)");
  process.exit(0);
}

// ---- Apply: group rows by (from -> to) pair, one update per pair ----
let updated = 0;
for (const [from, list] of cityBuckets) {
  const to = normCity(from);
  const ids = list.map(r => r["HRS ID"]);
  const { error: ue } = await sb
    .from("profiles")
    .update({ city: to })
    .in('"HRS ID"', ids);
  if (ue) console.error(`city "${from}" -> "${to}" FAILED:`, ue.message);
  else {
    console.log(`city "${from}" -> "${to}": ${ids.length} rows updated`);
    updated += ids.length;
  }
}
for (const [from, list] of areaBuckets) {
  const to = normArea(from);
  const ids = list.map(r => r["HRS ID"]);
  const { error: ue } = await sb
    .from("profiles")
    .update({ area: to })
    .in('"HRS ID"', ids);
  if (ue) console.error(`area "${from}" -> "${to}" FAILED:`, ue.message);
  else {
    console.log(`area "${from}" -> "${to}": ${ids.length} rows updated`);
    updated += ids.length;
  }
}

console.log(`\ndone: ${updated} column updates written`);

// Re-probe to confirm
const { data: after } = await sb
  .from("profiles")
  .select('"HRS ID", city, area');
const leftover = (after ?? []).filter(
  r =>
    (clean(r.city) && clean(r.city) !== normCity(r.city)) ||
    (clean(r.area) && clean(r.area) !== normArea(r.area))
);
console.log(`leftover legacy rows after migration: ${leftover.length}`);
