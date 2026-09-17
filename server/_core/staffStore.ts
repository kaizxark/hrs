/**
 * Staff Store — Google Sheets is the sole source of truth.
 *
 * READS resolve from the published Google Sheets CSV caches (Volunteer +
 * Admin tabs) via `staffCredentialCache`. No database, no `hasDb()` branch.
 * If an account isn't in the sheet it doesn't exist.
 *
 * WRITES use an in-memory buffer as an ephemeral bridge: when the admin
 * creates a volunteer account the mirror (Apps Script) writes to the
 * Volunteer tab, but the published CSV may take up to 60 s to reflect the
 * new row. The in-memory buffer lets the current serverless instance
 * immediately resolve that account for login and list. It is never a
 * source of truth — the Google Sheet is.
 */
import type { Staff, InsertStaff } from "../../drizzle/schema";
import {
  ensureFreshStaffCache,
  findAdminFromCache,
  findVolunteerFromCache,
} from "./staffCredentialCache";

/* ------------------------------------------------------------------ */
/* Ephemeral write buffer (UI-created accounts awaiting sheet pickup)  */
/* ------------------------------------------------------------------ */

interface InMemoryStaff {
  id: number;
  username: string;
  passwordHash: string;
  displayName: string;
  role: "volunteer" | "admin";
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

let memoryStore: Map<string, InMemoryStaff> | null = null;
let nextId = 1;

function getMemoryStore(): Map<string, InMemoryStaff> {
  if (!memoryStore) memoryStore = new Map();
  return memoryStore;
}

/** Convert in-memory record to the Drizzle `Staff` shape. */
function toStaff(entry: InMemoryStaff): Staff {
  return {
    id: entry.id,
    username: entry.username,
    passwordHash: entry.passwordHash,
    displayName: entry.displayName,
    role: entry.role,
    active: entry.active,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

/* ------------------------------------------------------------------ */
/* READS — 100% Google Sheets (Volunteer + Admin tab CSV caches)      */
/* ------------------------------------------------------------------ */

/**
 * Look up a staff member by username.
 * Returns a Staff-shaped object derived from the Volunteer or Admin tab
 * cache.  Google Sheets accounts carry id 0 (no numeric PK in the sheet).
 * If the username isn't in any sheet cache, falls back to the ephemeral
 * in-memory buffer for accounts created this instance before CSV pickup.
 */
export async function getStaffByUsername(
  username: string
): Promise<Staff | undefined> {
  const norm = username.trim().toLowerCase();

  // Google Sheets — the ONLY read source.
  await ensureFreshStaffCache();

  const vol = findVolunteerFromCache(norm);
  if (vol) {
    return {
      id: 0,
      username: vol.username,
      displayName: vol.displayName,
      passwordHash: vol.passwordHash,
      role: "volunteer",
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  const admin = findAdminFromCache(norm);
  if (admin) {
    return {
      id: 0,
      username: admin.username,
      displayName: admin.displayName,
      passwordHash: "", // admin passwords are plaintext in the sheet
      role: "admin",
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  // Ephemeral write buffer (accounts created this instance, not yet in CSV cache).
  const entry = getMemoryStore().get(norm);
  return entry ? toStaff(entry) : undefined;
}

/**
 * Get staff by numeric id.
 * Only resolves against the ephemeral in-memory buffer (positive ids
 * from UI creates). Google Sheets accounts always have id 0.
 */
export async function getStaffById(
  id: number
): Promise<Staff | undefined> {
  const entries = Array.from(getMemoryStore().values());
  const found = entries.find((e) => e.id === id);
  return found ? toStaff(found) : undefined;
}

/**
 * List all staff from the ephemeral write buffer only.
 * In production the buffer is empty unless an account was created
 * on this serverless instance. The Staff & Access view lists
 * volunteers from the Google Sheets cache directly.
 */
export async function listStaff(): Promise<Staff[]> {
  return Array.from(getMemoryStore().values())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(toStaff);
}

/* ------------------------------------------------------------------ */
/* WRITES — in-memory buffer (mirrors are handled by the caller)      */
/* ------------------------------------------------------------------ */

/** Insert a new staff account into the ephemeral write buffer. */
export async function createStaff(
  entry: InsertStaff
): Promise<Staff | undefined> {
  const norm = entry.username.trim().toLowerCase();
  const store = getMemoryStore();
  if (store.has(norm)) return undefined;

  const now = new Date();
  const record: InMemoryStaff = {
    id: nextId++,
    username: norm,
    passwordHash: entry.passwordHash,
    displayName: entry.displayName,
    role: entry.role ?? "volunteer",
    active: entry.active ?? true,
    createdAt: now,
    updatedAt: now,
  };
  store.set(norm, record);
  return toStaff(record);
}

/** Delete a staff account from the ephemeral buffer by id. Returns 0 or 1. */
export async function deleteStaff(id: number): Promise<number> {
  const store = getMemoryStore();
  for (const [key, entry] of Array.from(store.entries())) {
    if (entry.id === id) {
      store.delete(key);
      return 1;
    }
  }
  return 0;
}

/** Update a staff account's display name in the ephemeral buffer. */
export async function updateStaffDisplayName(
  id: number,
  displayName: string
): Promise<Staff | undefined> {
  const entries = Array.from(getMemoryStore().values());
  const entry = entries.find((e) => e.id === id);
  if (!entry) return undefined;
  entry.displayName = displayName;
  entry.updatedAt = new Date();
  return toStaff(entry);
}

/** Replace a staff account's password hash in the ephemeral buffer. */
export async function updateStaffPassword(
  id: number,
  passwordHash: string
): Promise<Staff | undefined> {
  const entries = Array.from(getMemoryStore().values());
  const entry = entries.find((e) => e.id === id);
  if (!entry) return undefined;
  entry.passwordHash = passwordHash;
  entry.updatedAt = new Date();
  return toStaff(entry);
}
