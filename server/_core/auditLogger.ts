/**
 * Audit Logger
 *
 * Central helper for recording privileged actions (directory mutations,
 * verifications, donations, etc.).
 *
 * Design notes:
 * - The Google Sheets Audit Log tab is the source of truth for the audit
 *   trail, written by the Apps Script on each mutation.  This module
 *   exists to keep call sites compiling and logAudit is now a no-op
 *   (the sheet is the only read and write path for audit data).
 * - Writing a log entry NEVER throws / never breaks the caller's flow.
 * - The actor is taken from the authenticated request context (when present),
 *   so entries remain useful even for procedures that are technically public.
 */
import type { User } from "../../drizzle/schema";

export type AuditActor = Pick<User, "id" | "openId" | "name" | "role"> | null;

export interface AuditLogEntry {
  /** Machine-readable action key, e.g. "profile.verify". */
  action: string;
  /** Human-readable label shown in the audit log UI, e.g. "Verified profile". */
  actionLabel: string;
  actor?: AuditActor;
  /** What kind of object was acted on: profile | user | system. */
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  success?: boolean;
  ipAddress?: string;
}

/**
 * Record one audit log entry.  The primary audit trail lives in the
 * Google Sheets Audit Log tab (written by the Apps Script on each
 * mutation).  This function is retained to keep all call sites compiling;
 * in a sheets-only deployment the audit data is read from the sheet via
 * `auditLogCache.ts`.
 */
export async function logAudit(_entry: AuditLogEntry): Promise<void> {
  // No-op — the Google Sheets Audit Log tab is the sole audit trail.
}

/**
 * Convenience wrapper for audit entries that target a directory profile.
 */
export async function logProfileAudit(
  hrsId: string,
  entry: Omit<AuditLogEntry, "targetType" | "targetId">
): Promise<void> {
  return logAudit({
    ...entry,
    targetType: "profile",
    targetId: hrsId,
  });
}
