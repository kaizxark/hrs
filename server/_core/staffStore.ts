/**
 * Staff Store — unified interface for staff accounts.
 *
 * Uses the database when available (DATABASE_URL configured); falls back to an
 * in-memory Map so the feature works in no-DB environments (local dev, demo).
 * All operations are async for a uniform API.
 */
import * as db from "../db";
import type { Staff, InsertStaff } from "../../drizzle/schema";

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
let seeded = false;

function getMemoryStore(): Map<string, InMemoryStaff> {
  if (!memoryStore) {
    memoryStore = new Map();
  }
  return memoryStore;
}

/** Seed a default admin account the first time the in-memory store is used. */
async function ensureSeeded(): Promise<void> {
  // Disabled: rely solely on Google Sheets for authentication
  return;
}

/** Check whether a real database connection is available. */
async function hasDb(): Promise<boolean> {
  const conn = await db.getDb();
  return conn !== null;
}

/**
 * Get staff by username (lowercase normalized).
 */
export async function getStaffByUsername(username: string): Promise<Staff | undefined> {
  const norm = username.trim().toLowerCase();

  if (await hasDb()) {
    return db.getStaffByUsername(norm);
  }

  await ensureSeeded();
  const entry = getMemoryStore().get(norm);
  return entry ? toStaff(entry) : undefined;
}

/** Get staff by numeric id. */
export async function getStaffById(id: number): Promise<Staff | undefined> {
  if (await hasDb()) {
    return db.getStaffById(id);
  }

  await ensureSeeded();
  const entries = Array.from(getMemoryStore().values());
  const found = entries.find(e => e.id === id);
  return found ? toStaff(found) : undefined;
}

/** List all staff accounts. */
export async function listStaff(): Promise<Staff[]> {
  if (await hasDb()) {
    return db.listStaff();
  }

  await ensureSeeded();
  return Array.from(getMemoryStore().values())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(toStaff);
}

/** Insert a new staff account. */
export async function createStaff(entry: InsertStaff): Promise<Staff | undefined> {
  const norm = entry.username.trim().toLowerCase();

  if (await hasDb()) {
    return db.createStaff({ ...entry, username: norm });
  }

  await ensureSeeded();
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

/** Delete a staff account by id. Returns rows deleted (0 or 1). */
export async function deleteStaff(id: number): Promise<number> {
  if (await hasDb()) {
    return db.deleteStaff(id);
  }

  await ensureSeeded();
  const store = getMemoryStore();
  const entries = Array.from(store.entries());
  for (const [key, entry] of entries) {
    if (entry.id === id) {
      store.delete(key);
      return 1;
    }
  }
  return 0;
}

/** Update a staff account's display name. Returns the updated row or undefined. */
export async function updateStaffDisplayName(
  id: number,
  displayName: string
): Promise<Staff | undefined> {
  if (await hasDb()) {
    return db.updateStaffDisplayName(id, displayName);
  }

  await ensureSeeded();
  const entries = Array.from(getMemoryStore().values());
  const entry = entries.find(e => e.id === id);
  if (!entry) return undefined;
  entry.displayName = displayName;
  entry.updatedAt = new Date();
  return toStaff(entry);
}

/** Replace a staff account's password hash. Returns the updated row or undefined. */
export async function updateStaffPassword(
  id: number,
  passwordHash: string
): Promise<Staff | undefined> {
  if (await hasDb()) {
    return db.updateStaffPassword(id, passwordHash);
  }

  await ensureSeeded();
  const entries = Array.from(getMemoryStore().values());
  const entry = entries.find(e => e.id === id);
  if (!entry) return undefined;
  entry.passwordHash = passwordHash;
  entry.updatedAt = new Date();
  return toStaff(entry);
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
