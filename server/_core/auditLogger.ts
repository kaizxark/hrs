/**
 * Audit Logger
 *
 * Central helper for recording privileged actions in the Supabase
 * `audit_logs` table.
 *
 * Scope (product decision): the audit log tracks ONLY the four donor-record
 * lifecycle events —
 *   1. profile.add_person  → a donor registers (public form or admin)
 *   2. profile.update      → a profile is edited
 *   3. profile.donation    → a donation is recorded
 *   4. profile.delete      → a profile is deleted
 * Everything else (staff logins, listing, syncs, diagnostics, …) is
 * deliberately NOT recorded — `logAudit` silently skips any other action,
 * so stray call sites can never pollute the trail.
 *
 * Writing a log entry NEVER throws / never breaks the caller's flow.
 */
import type { User } from "../../drizzle/schema";
import { supabase } from "./supabaseApi";

/** The only actions that may be written to the audit trail. */
const AUDITED_ACTIONS = new Set([
  "profile.add_person",
  "profile.update",
  "profile.donation",
  "profile.delete",
]);

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
    // Scope enforcement: anything outside the four donor-record lifecycle
    // events is intentionally not audited.
    if (!AUDITED_ACTIONS.has(entry.action)) return;

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
