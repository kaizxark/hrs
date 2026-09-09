import { and, count, desc, eq, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  auditLogs,
  InsertAuditLog,
  InsertStaff,
  InsertUser,
  staff,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ---------- Staff (admin-created volunteer accounts) ----------

/** Look up a staff row by unique username (for login). */
export async function getStaffByUsername(username: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get staff: database not available");
    return undefined;
  }
  const result = await db
    .select()
    .from(staff)
    .where(eq(staff.username, username))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/** Look up a staff row by primary key id. */
export async function getStaffById(id: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get staff: database not available");
    return undefined;
  }
  const result = await db
    .select()
    .from(staff)
    .where(eq(staff.id, id))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/** List all staff rows (used by the admin "Staff & Access" view). */
export async function listStaff() {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot list staff: database not available");
    return [];
  }
  return db.select().from(staff).orderBy(desc(staff.createdAt));
}

/** Insert a new staff account. */
export async function createStaff(entry: InsertStaff) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot create staff: database not available");
    throw new Error("Database not available");
  }
  const [result] = await db.insert(staff).values(entry);
  const id = Number(result.insertId);
  return getStaffById(id);
}

/**
 * Delete a staff account by id.
 * Returns the number of rows deleted (0 if none, e.g. already gone).
 */
export async function deleteStaff(id: number): Promise<number> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot delete staff: database not available");
    return 0;
  }
  const result = await db.delete(staff).where(eq(staff.id, id));
  return result[0]?.affectedRows ?? 0;
}

/** Update a staff account's display name. Returns the updated row or null. */
export async function updateStaffDisplayName(id: number, displayName: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot update staff: database not available");
    return undefined;
  }
  await db.update(staff).set({ displayName }).where(eq(staff.id, id));
  return getStaffById(id);
}

/** Replace a staff account's password hash. Returns the updated row or null. */
export async function updateStaffPassword(id: number, passwordHash: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot update staff password: database not available");
    return undefined;
  }
  await db.update(staff).set({ passwordHash }).where(eq(staff.id, id));
  return getStaffById(id);
}

/**
 * Ensure the owner user also has a staff admin login (for the admin to
 * sign in with username/password alongside OAuth).
 */
export async function ensureOwnerStaffAdmin(
  ownerOpenId?: string | null
): Promise<void> {
  if (!ownerOpenId || !process.env.DATABASE_URL) return;
  const db = await getDb();
  if (!db) return;

  try {
    const existing = await db
      .select()
      .from(staff)
      .where(
        or(
          eq(staff.username, "admin"),
          eq(staff.username, String(ownerOpenId).toLowerCase())
        )
      )
      .limit(1);
    if (existing.length > 0) return;
    // The owner's staff password is not auto-set; admin creates/updates via UI.
  } catch (error) {
    console.error("[Database] ensureOwnerStaffAdmin failed:", error);
  }
}

// TODO: add feature queries here as your schema grows.

/** Number of audit log rows returned per page by default. */
export const AUDIT_PAGE_SIZE = 50;

export async function insertAuditLog(entry: InsertAuditLog): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot insert audit log: database not available");
    return;
  }

  try {
    await db.insert(auditLogs).values(entry);
  } catch (error) {
    console.error("[Database] Failed to insert audit log:", error);
  }
}

export interface ListAuditLogsOptions {
  limit?: number;
  offset?: number;
  action?: string;
  search?: string;
}

export async function listAuditLogs(options: ListAuditLogsOptions = {}) {
  const db = await getDb();
  if (!db) {
    return { logs: [], total: 0 };
  }

  const { limit = AUDIT_PAGE_SIZE, offset = 0, action, search } = options;

  const conditions = [];
  if (action && action !== "all") {
    conditions.push(eq(auditLogs.action, action));
  }
  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    conditions.push(
      or(
        like(auditLogs.actorName, term),
        like(auditLogs.actorOpenId, term),
        like(auditLogs.targetId, term),
        like(auditLogs.actionLabel, term)
      )
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  const safeOffset = Math.max(offset, 0);

  try {
    const [rows, totalRows] = await Promise.all([
      db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(safeLimit)
        .offset(safeOffset),
      db
        .select({ count: count() })
        .from(auditLogs)
        .where(where),
    ]);

    return {
      logs: rows,
      total: totalRows[0]?.count ?? 0,
    };
  } catch (error) {
    console.error("[Database] Failed to list audit logs:", error);
    return { logs: [], total: 0 };
  }
}

export async function clearAuditLogs(): Promise<number> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot clear audit logs: database not available");
    return 0;
  }

  try {
    const result = await db.delete(auditLogs);
    return result[0]?.affectedRows ?? 0;
  } catch (error) {
    console.error("[Database] Failed to clear audit logs:", error);
    return 0;
  }
}
