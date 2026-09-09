/**
 * Audit Logger
 *
 * Central helper for recording privileged actions (directory mutations,
 * verifications, donations, etc.) into the `audit_logs` table so admins can
 * review everything that happens in the website.
 *
 * Design notes:
 * - Writing a log entry NEVER throws / never breaks the caller's flow. If the
 *   database is unavailable the entry is dropped with a console warning.
 * - The actor is taken from the authenticated request context (when present),
 *   so entries remain useful even for procedures that are technically public.
 */
import type { User } from "../../drizzle/schema";
import { insertAuditLog } from "../db";

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
 * Write one audit log entry. Safe to call from any mutation handler:
 * failures are logged, never thrown.
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    await insertAuditLog({
      action: entry.action,
      actionLabel: entry.actionLabel,
      actorId: entry.actor?.id ?? null,
      actorOpenId: entry.actor?.openId ?? null,
      actorName: entry.actor?.name ?? null,
      actorRole: entry.actor?.role ?? "admin",
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      details: (entry.details as object) ?? null,
      success: entry.success ?? true,
      ipAddress: entry.ipAddress ?? null,
    });
  } catch (error) {
    console.error("[Audit] Failed to record audit entry:", error);
  }
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