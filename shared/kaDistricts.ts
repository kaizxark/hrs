/**
 * Karnataka districts + talukas for city/area dropdowns.
 *
 * "City" = one of Karnataka's 31 districts (official spelling).
 * "Area" = the district's talukas, plus well-known localities of Tumakuru
 *          city used by earlier records (SIT, SS Puram, …) so existing rows
 *          keep their exact area value.
 *
 * Sources: en.wikipedia.org/wiki/List_of_districts_of_Karnataka (31 districts),
 * en.wikipedia.org/wiki/List_of_taluks_of_Karnataka (~239 talukas).
 *
 * Older records store anglicized spellings ("Tumkur", "Bangalore", …).
 * kaNormalizeDistrict() maps every known legacy spelling to the official
 * district name, so filters written for the new list still match old rows.
 */

/** District (official name) → its areas (talukas + Tumakuru localities). */
export const KA_AREAS_BY_DISTRICT: Readonly<
  Record<string, readonly string[]>
> = {
  Bagalkote: [
    "Bagalkote",
    "Badami",
    "Bilagi",
    "Hunagunda",
    "Ilkal",
    "Jamkhandi",
    "Mudhol",
    "Rabkavi Banhatti",
    "Terdal",
  ],
  Ballari: ["Ballari", "Kampli", "Kurugodu", "Sanduru", "Siruguppa"],
  Belagavi: [
    "Belagavi",
    "Athani",
    "Bailhongal",
    "Chikkodi",
    "Gokak",
    "Hukkeri",
    "Kagawada",
    "Kitturu",
    "Mudalagi",
    "Nippani",
    "Ramadurga",
    "Rayabaga",
    "Savadatti",
    "Yaragatti",
  ],
  "Bengaluru North": [
    "Doddaballapura",
    "Devanahalli",
    "Hosakote",
    "Nelamangala",
  ],
  "Bengaluru South": [
    "Ramanagara",
    "Bidadi",
    "Channapatna",
    "Harohalli",
    "Kanakapura",
    "Magadi",
  ],
  "Bengaluru Urban": [
    "Bengaluru",
    "Anekal",
    "Kengeri",
    "Krishnarajapura",
    "Sarjapura",
    "Yelahanka",
  ],
  Bidar: [
    "Bidar",
    "Aurad",
    "Basavakalyana",
    "Bhalki",
    "Chitgoppa",
    "Hulsuru",
    "Humnabad",
    "Kamalanagara",
  ],
  Chamarajanagara: [
    "Chamarajanagara",
    "Gundlupete",
    "Hanuru",
    "Kollegala",
    "Yelanduru",
  ],
  Chikkaballapura: [
    "Chikkaballapura",
    "Bagepalli",
    "Cheluru",
    "Chintamani",
    "Gauribidanuru",
    "Gudibanda",
    "Manchenahalli",
    "Sidlaghatta",
  ],
  Chikkamagaluru: [
    "Chikkamagaluru",
    "Ajjampura",
    "Kaduru",
    "Kalasa",
    "Koppa",
    "Mudigere",
    "Narasimharajapura",
    "Sringeri",
    "Tarikere",
  ],
  Chitradurga: [
    "Chitradurga",
    "Challakere",
    "Hiriyur",
    "Holalkere",
    "Hosadurga",
    "Molakalmuru",
  ],
  "Dakshina Kannada": [
    "Mangaluru",
    "Bantwala",
    "Belathangadi",
    "Kadaba",
    "Moodbidri",
    "Mulki",
    "Putturu",
    "Sulya",
    "Ullal",
  ],
  Davanagere: [
    "Davanagere",
    "Channagiri",
    "Harihara",
    "Honnali",
    "Jagaluru",
    "Nyamathi",
  ],
  Dharwad: [
    "Dharwad",
    "Hubballi",
    "Alnavara",
    "Annigeri",
    "Kalghatgi",
    "Kundagolu",
    "Navalgunda",
  ],
  Gadag: [
    "Gadag",
    "Gajendragada",
    "Lakshmeshwara",
    "Mundaragi",
    "Naragunda",
    "Rona",
    "Shirahatti",
  ],
  Hassan: [
    "Hassan",
    "Aluru",
    "Arakalagudu",
    "Arasikere",
    "Beluru",
    "Channarayapattana",
    "Holenarsipura",
    "Sakleshpura",
  ],
  Haveri: [
    "Haveri",
    "Byadgi",
    "Hangala",
    "Hirekeruru",
    "Ranibennur",
    "Rattihalli",
    "Savanuru",
    "Shiggavi",
  ],
  Kalaburagi: [
    "Kalaburagi",
    "Afzalpura",
    "Alanda",
    "Chincholi",
    "Chitapura",
    "Jevargi",
    "Kalgi",
    "Sedam",
    "Yedrami",
  ],
  Kodagu: [
    "Madikeri",
    "Kushalnagara",
    "Ponnammapete",
    "Somawarapete",
    "Virajapete",
  ],
  Kolar: [
    "Kolar",
    "Bangarapete",
    "Kolar Gold Fields",
    "Maluru",
    "Mulabagilu",
    "Srinivasapura",
  ],
  Koppala: [
    "Koppala",
    "Gangavathi",
    "Kanakagiri",
    "Karatagi",
    "Kukanuru",
    "Kushtagi",
    "Yelaburga",
  ],
  Mandya: [
    "Mandya",
    "Krishnarajapete",
    "Madduru",
    "Malavalli",
    "Nagamangala",
    "Pandavapura",
    "Srirangapattana",
  ],
  Mysuru: [
    "Mysuru",
    "Heggadadevanakote",
    "Hunasuru",
    "Krishnarajanagara",
    "Nanjanagodu",
    "Piriyapattana",
    "Saligrama",
    "Saraguru",
    "Tirumakudalu Narasipura",
  ],
  Raichuru: [
    "Raichuru",
    "Devadurga",
    "Lingasaguru",
    "Manvi",
    "Maski",
    "Mudgal",
    "Sirawara",
    "Sindhanuru",
  ],
  Shivamogga: [
    "Shivamogga",
    "Bhadravathi",
    "Hosanagara",
    "Sagara",
    "Shikaripura",
    "Soraba",
    "Tirthahalli",
  ],
  Tumakuru: [
    "Tumakuru",
    "SIT",
    "SS Puram",
    "Ashok Nagar",
    "Kyathsandra",
    "Gulur",
    "Gubbi Gate",
    "Chikkanayakanahalli",
    "Gubbi",
    "Kunigal",
    "Koratagere",
    "Madhugiri",
    "Pavagada",
    "Sira",
    "Tipturu",
    "Turuvekere",
  ],
  Udupi: [
    "Udupi",
    "Brahmavara",
    "Bynduru",
    "Hebri",
    "Kapu",
    "Karkala",
    "Kundapura",
  ],
  "Uttara Kannada": [
    "Karwara",
    "Ankola",
    "Bhatkal",
    "Dandeli",
    "Haliyal",
    "Honnavara",
    "Joida",
    "Kumta",
    "Mundagodu",
    "Siddapura",
    "Sirsi",
    "Yellapura",
  ],
  Vijayanagara: [
    "Hosapete",
    "Hagaribommanahalli",
    "Harapanahalli",
    "Hoovina Hadagali",
    "Kotturu",
    "Kudligi",
  ],
  Vijayapura: [
    "Vijayapura",
    "Alamela",
    "Babaleshwara",
    "Basavana Bagewadi",
    "Chadchana",
    "Devara Hipparagi",
    "Indi",
    "Kolhara",
    "Muddebihala",
    "Nidagundi",
    "Sindgi",
    "Talikote",
    "Tikote",
  ],
  Yadagiri: [
    "Yadagiri",
    "Gurmitkala",
    "Hunsagi",
    "Shahapura",
    "Surapura",
    "Vadagera",
  ],
};

/** All 31 districts, alphabetically sorted (safe for dropdowns). */
export const KA_DISTRICTS: readonly string[] = Object.keys(
  KA_AREAS_BY_DISTRICT
).sort((a, b) => a.localeCompare(b));

/** Unique, sorted areas across all districts — used by the "All districts" area filter. */
export const KA_ALL_AREAS: readonly string[] = Array.from(
  new Set(Object.values(KA_AREAS_BY_DISTRICT).flat())
).sort((a, b) => a.localeCompare(b));

/** Legacy / anglicized spellings → official district name (lookup key is lowercase). */
const DISTRICT_ALIASES: Readonly<Record<string, string>> = {
  // canonical names, lowercase → themselves (case-insensitive direct hits)
  ...Object.fromEntries(KA_DISTRICTS.map(d => [d.toLowerCase(), d])),
  // Bengaluru (city)
  bangalore: "Bengaluru Urban",
  "bangalore city": "Bengaluru Urban",
  "bangalore urban": "Bengaluru Urban",
  bengaluru: "Bengaluru Urban",
  "bengaluru city": "Bengaluru Urban",
  // Bengaluru Rural / Ramanagara renames
  "bangalore rural": "Bengaluru North",
  "bengaluru rural": "Bengaluru North",
  ramanagar: "Bengaluru South",
  ramanagara: "Bengaluru South",
  // anglicized district spellings
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
  // coastal / coastal-city spellings → their district
  "canara": "Uttara Kannada",
  "north kanara": "Uttara Kannada",
  karwar: "Uttara Kannada",
  "south kanara": "Dakshina Kannada",
  mangalore: "Dakshina Kannada",
  mangaluru: "Dakshina Kannada",
  hubli: "Dharwad",
  hubballi: "Dharwad",
  "hubli dharwad": "Dharwad",
  "hubballi-dharwad": "Dharwad",
};

/** Legacy area spellings → official area spelling (lookup key is lowercase). */
const AREA_ALIASES: Readonly<Record<string, string>> = {
  "tumkur city": "Tumakuru",
  tumkur: "Tumakuru",
};

/** Collapse whitespace + trim ("  Tumkur   City " → "Tumkur City"). */
function clean(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Map any known spelling of a Karnataka district (legacy or official, any
 * case) to its official name. Unknown values pass through trimmed, so data
 * recorded outside the list never breaks display.
 */
export function kaNormalizeDistrict(raw: string | null | undefined): string {
  const value = clean(raw);
  if (!value) return "";
  const hit = DISTRICT_ALIASES[value.toLowerCase()];
  return hit ?? value;
}

/**
 * Map any known spelling of an area to its official spelling. Unknown
 * values pass through trimmed.
 */
export function kaNormalizeArea(raw: string | null | undefined): string {
  const value = clean(raw);
  if (!value) return "";
  const hit = AREA_ALIASES[value.toLowerCase()];
  return hit ?? value;
}

/** Curated area options for a district (already official spellings). */
export function kaAreasForDistrict(district: string | null | undefined): readonly string[] {
  return KA_AREAS_BY_DISTRICT[kaNormalizeDistrict(district)] ?? [];
}
