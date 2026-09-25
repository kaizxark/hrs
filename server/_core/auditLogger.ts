/**
 * Audit Logger
 *
 * Central helper for recording privileged actions (directory mutations,
 * verifications, donations, staff changes, …) in the Supabase `audit_logs`
 * table.
 *
 * Design notes:
 * - The previous implementation was a no-op stub: the Sheets/Apps-Script era
 *   wrote audit rows from the Apps Script, which this codebase no longer
 *   calls — so NO audit trail was being recorded at all. Every privileged
 *   action now lands in `audit_logs`.
 * - Writing a log entry NEVER throws / never breaks the caller's flow.
 * - `logProfileAudit` keeps its old signature so all call sites stay valid.
 */
import type { User } from "../../drizzle/schema";
import { supabase } from "./supabaseApi";

export type AuditActor = Pick<User, "id" | "openId" | "name" | "role"> | null;

export interface AuditLogEntry {
  /** Machine-readable action key, e.g. "profile.verify". */
  action: string;
  /** Human-readable label shown in the audit log UI, e.g. "Verified profile". */
  actionLabel: string;
  actor?: AuditActor;
  /** What kind of object was acted on: profile | staff | system. */
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  success?: boolean;
  ipAddress?: string;
}

/**
 * Record one audit log entry. Failures are logged and swallowed — auditing
 * must not take down the request that produced the event.
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    const actor = entry.actor ?? null;
    await supabase.from("audit_logs").insert({
      action: entry.action,
      action_label: entry.actionLabel,
      actor_id: null,
      actor_open_id: actor?.openId ?? null,
      actor_name: actor?.name ?? null,
      actor_role: actor?.role ?? null,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      details: entry.details ?? null,
      success: entry.success ?? true,
      ip_address: entry.ipAddress ?? null,
    });
  } catch (error) {
    console.error("[auditLogger] Failed to write audit log:", error);
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
