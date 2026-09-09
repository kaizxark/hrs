import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Audit log table — an append-only record of every privileged action taken
 * in the website (directory changes, donations, verifications, etc.).
 * Rows are written by logAudit() on the server and are only ever read
 * through the admin-only audit router.
 */
export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Machine-readable action key, e.g. "profile.verify", "profile.delete". */
    action: varchar("action", { length: 64 }).notNull(),
    /** Human-readable action label, e.g. "Verified profile". */
    actionLabel: varchar("actionLabel", { length: 128 }).notNull(),
    /** id of the acting user (nullable for system-triggered entries). */
    actorId: int("actor_id"),
    /** OpenID of the acting user, persists even if the users row is pruned. */
    actorOpenId: varchar("actorOpenId", { length: 64 }),
    /** Display name of the acting user. */
    actorName: text("actorName"),
    /** Role the actor held at the time of the action (user | admin). */
    actorRole: mysqlEnum("actorRole", ["user", "admin", "volunteer"]).default("admin").notNull(),
    /** What kind of object was acted on: profile | user | system. */
    targetType: varchar("targetType", { length: 32 }),
    /** Identifier of the target object (e.g. HRS ID like "TN-2024-001"). */
    targetId: varchar("targetId", { length: 128 }),
    /** Free-form structured context (changed fields, counts, etc.). */
    details: json("details"),
    /** Whether the underlying operation succeeded. */
    success: boolean("success").default(true).notNull(),
    /** Request IP address when available. */
    ipAddress: varchar("ipAddress", { length: 45 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    actionIdx: index("action_idx").on(table.action, table.createdAt),
    createdIdx: index("created_idx").on(table.createdAt),
  })
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

/**
 * Staff table for admin-created volunteer accounts.
 * Volunteers log in with username/password (not OAuth).
 * The admin account is also stored here for username/password login.
 */
export const staff = mysqlTable(
  "staff",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Unique login username chosen by the admin. */
    username: varchar("username", { length: 64 }).notNull().unique(),
    /** Scrypt-hashed password (never stored in plaintext). */
    passwordHash: varchar("passwordHash", { length: 128 }).notNull(),
    /** Human-readable display name. */
    displayName: varchar("displayName", { length: 128 }).notNull(),
    /** Role: admin (full access) or volunteer (home-like read + call). */
    role: mysqlEnum("role", ["admin", "volunteer"]).default("volunteer").notNull(),
    /** Whether the account is active. Soft-delete by deactivating. */
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    usernameIdx: index("staff_username_idx").on(table.username),
  })
);

export type Staff = typeof staff.$inferSelect;
export type InsertStaff = typeof staff.$inferInsert;
