import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = pgTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: varchar("role", { length: 20 }).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
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
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    /** Machine-readable action key, e.g. "profile.verify", "profile.delete". */
    action: varchar("action", { length: 64 }).notNull(),
    /** Human-readable action label, e.g. "Verified profile". */
    actionLabel: varchar("actionLabel", { length: 128 }).notNull(),
    /** id of the acting user (nullable for system-triggered entries). */
    actorId: integer("actor_id"),
    /** OpenID of the acting user, persists even if the users row is pruned. */
    actorOpenId: varchar("actorOpenId", { length: 64 }),
    /** Display name of the acting user. */
    actorName: text("actorName"),
    /** Role the actor held at the time of the action (user | admin). */
    actorRole: varchar("actorRole", { length: 20 }).default("admin").notNull(),
    /** What kind of object was acted on: profile | user | system. */
    targetType: varchar("targetType", { length: 32 }),
    /** Identifier of the target object (e.g. HRS ID like "TN-2024-001"). */
    targetId: varchar("targetId", { length: 128 }),
    /** Free-form structured context (changed fields, counts, etc.). */
    details: jsonb("details"),
    /** Whether the underlying operation succeeded. */
    success: boolean("success").default(true).notNull(),
    /** Request IP address when available. */
    ipAddress: varchar("ipAddress", { length: 45 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
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
export const staff = pgTable(
  "staff",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    /** Unique login username chosen by the admin. */
    username: varchar("username", { length: 64 }).notNull().unique(),
    /** Scrypt-hashed password (never stored in plaintext). */
    passwordHash: varchar("passwordHash", { length: 128 }).notNull(),
    /** Human-readable display name. */
    displayName: varchar("displayName", { length: 128 }).notNull(),
    /** Role: admin (full access) or volunteer (home-like read + call). */
    role: varchar("role", { length: 20 }).default("volunteer").notNull(),
    /** Whether the account is active. Soft-delete by deactivating. */
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => ({
    usernameIdx: index("staff_username_idx").on(table.username),
  })
);

export type Staff = typeof staff.$inferSelect;
export type InsertStaff = typeof staff.$inferInsert;

/**
 * Profiles table for donor information (mirrors Google Sheets structure)
 */
export const profiles = pgTable("profiles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  /** HRS ID - unique identifier like HRS-0001 */
  hrsId: varchar("hrs_id", { length: 20 }).notNull().unique(),
  fullName: varchar("full_name", { length: 100 }).notNull(),
  dateOfBirth: timestamp("date_of_birth"),
  gender: varchar("gender", { length: 20 }),
  phoneNumber: varchar("phone_number", { length: 20 }),
  email: varchar("email", { length: 100 }),
  city: varchar("city", { length: 50 }),
  area: varchar("area", { length: 50 }),
  registrationTime: timestamp("registration_time"),
  bloodGroup: varchar("blood_group", { length: 10 }),
  bloodGroupStatus: varchar("blood_group_status", { length: 20 }),
  dataStorageConsent: varchar("data_storage_consent", { length: 10 }),
  donorConsent: varchar("donor_consent", { length: 10 }),
  verificationStatus: varchar("verification_status", { length: 20 }),
  verificationTime: timestamp("verification_time"),
  bloodDonationCount: integer("blood_donation_count").default(0),
  lastDonationTime: timestamp("last_donation_time"),
  nextEligibleTime: timestamp("next_eligible_time"),
  availabilityStatus: varchar("availability_status", { length: 30 }),
  publicDirectoryVisibility: varchar("public_directory_visibility", { length: 10 }),
  // Individual donation tracking (keeping sheet structure for simplicity)
  donation1Date: timestamp("donation_1_date"),
  donation1EligibleTime: timestamp("donation_1_eligible_time"),
  donation2Date: timestamp("donation_2_date"),
  donation2EligibleTime: timestamp("donation_2_eligible_time"),
  donation3Date: timestamp("donation_3_date"),
  donation3EligibleTime: timestamp("donation_3_eligible_time"),
  donation4Date: timestamp("donation_4_date"),
  donation4EligibleTime: timestamp("donation_4_eligible_time"),
  donation5Date: timestamp("donation_5_date"),
  donation5EligibleTime: timestamp("donation_5_eligible_time"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Profile = typeof profiles.$inferSelect;
export type InsertProfile = typeof profiles.$inferInsert;