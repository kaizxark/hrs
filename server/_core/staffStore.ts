/**
 * Staff Store — Supabase `staff` table is the single source of truth.
 *
 * Previously staff credentials lived in two Google Sheets tabs (Volunteer +
 * Admin) read through CSV caches, with an ephemeral in-memory write buffer to
 * bridge the CSV publication lag. That layer is gone:
 *
 * - READS  → direct queries against the `staff` table (service-role client).
 * - WRITES → direct inserts/updates/deletes; no mirror, no lag, no buffer.
 *
 * A one-time idempotent seed imports the legacy sheet accounts on first use:
 * every row of the Volunteer tab becomes an active volunteer (any plaintext
 * password is re-hashed with scrypt), and the Admin tab account becomes the
 * seed admin. The seed is guarded by a `staff_seed_done` row in the audit
 * trail metadata — safer than a separate settings table — and never blocks
 * a failing read: if the sheets are unreachable, we simply serve the table.
 *
 * Because the seed marker can be wiped by "Clear audit log", deletions are
 * additionally recorded as `staff.deleted:<username>` tombstone rows (also in
 * audit_logs, preserved by the clear endpoint) and the seed skips those
 * usernames. This prevents deleted sheet volunteers from being resurrected.
 */
import type { Staff, InsertStaff } from "../../drizzle/schema";
import { supabase } from "./supabaseApi";
import { hashPassword, verifyPassword } from "./password";

/**
 * Marker rows written to `audit_logs` when a volunteer/admin account is
 * deleted. The one-time sheet seed checks them and skips those usernames, so
 * a deleted legacy account is never resurrected from the Google Sheet —
 * even after the admin clears the audit trail (the clear endpoint preserves
 * tombstones for this reason).
 */
const DELETED_STAFF_MARKER_PREFIX = "staff.deleted:";

/** Record a tombstone so the sheet seed skips `username` forever. */
async function markStaffDeleted(username: string): Promise<void> {
  try {
    await supabase.from("audit_logs").insert({
      action: `${DELETED_STAFF_MARKER_PREFIX}${username.trim().toLowerCase()}`,
      action_label: "Staff account deleted (tombstone)",
      actor_role: "admin",
      target_type: "staff",
      target_id: username.trim().toLowerCase(),
      success: true,
    });
  } catch (error) {
    console.warn("[staffStore] Could not record deletion tombstone:", error);
  }
}

/** Remove the tombstone when the same username is (re-)created. */
async function clearStaffDeletedMarker(username: string): Promise<void> {
  try {
    await supabase
      .from("audit_logs")
      .delete()
      .eq(
        "action",
        `${DELETED_STAFF_MARKER_PREFIX}${username.trim().toLowerCase()}`
      );
  } catch (error) {
    console.warn("[staffStore] Could not clear deletion tombstone:", error);
  }
}

/** Usernames that must never be re-imported from the legacy sheet. */
async function listDeletedStaffUsernames(): Promise<Set<string>> {
  try {
    const { data, error } = await supabase
      .from("audit_logs")
      .select("action")
      .like("action", `${DELETED_STAFF_MARKER_PREFIX}%`);
    if (error) throw error;
    return new Set(
      ((data ?? []) as { action: string }[]).map(r =>
        r.action.slice(DELETED_STAFF_MARKER_PREFIX.length)
      )
    );
  } catch (error) {
    console.warn("[staffStore] Could not list deletion tombstones:", error);
    return new Set(); // fail open — behaves like before, no worse
  }
}
import {
  ensureFreshStaffCache,
  findAdminFromCache,
  listVolunteersFromCache,
} from "./staffCredentialCache";

/* ------------------------------------------------------------------ */
/* Row mapping (snake_case columns → Drizzle `Staff` shape)            */
/* ------------------------------------------------------------------ */

type StaffRow = {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  role: string;
  active: boolean;
  mobile: string | null;
  created_at: string;
  updated_at: string;
};

function toStaff(row: StaffRow): Staff {
  return {
    id: stableId(row.id),
    username: row.username,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    mobile: row.mobile ?? "",
    role: row.role === "admin" ? "admin" : "volunteer",
    active: row.active,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Map the UUID primary key to the numeric id the rest of the app expects.
 * The low 32 bits of the UUID are stable for a given row, so ids survive
 * round-trips (client sends the id back; we resolve by username anyway for
 * mutations that matter).
 */
function stableId(uuid: string): number {
  let h = 0;
  for (let i = 0; i < uuid.length; i++) {
    h = (h * 31 + uuid.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/* ------------------------------------------------------------------ */
/* One-time seed from the legacy Google Sheets tabs                    */
/* ------------------------------------------------------------------ */

const SEED_MARKER = "staff_seed_done";

async function isSeeded(): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("audit_logs")
      .select("id")
      .eq("action", SEED_MARKER)
      .limit(1);
    return (data ?? []).length > 0;
  } catch {
    return false; // if the check fails, attempt the seed anyway (idempotent)
  }
}

async function markSeeded(): Promise<void> {
  try {
    await supabase.from("audit_logs").insert({
      action: SEED_MARKER,
      action_label: "One-time staff seed from Google Sheets",
      actor_role: "admin",
      target_type: "system",
      success: true,
    });
  } catch (error) {
    console.warn("[staffStore] Could not record seed marker:", error);
  }
}

/**
 * Import sheet volunteers + the admin account into the `staff` table.
 * Runs at most once per deployment (guarded by the marker row) and is
 * safe to run concurrently: every step is upsert-or-skip by username.
 */
async function seedFromSheets(): Promise<void> {
  if (await isSeeded()) return;

  try {
    await ensureFreshStaffCache();

    // Volunteers: sheet rows may carry a scrypt hash OR a plaintext password
    // (added directly in the sheet). Plaintext is detected by the missing
    // "scrypt:" prefix and hashed on import. Accounts the admin deleted are
    // skipped — without this the seed would resurrect them on every fresh
    // deployment (the seed re-runs whenever its audit-log marker is gone).
    const deletedUsernames = await listDeletedStaffUsernames();
    const volunteers = listVolunteersFromCache();
    for (const v of volunteers) {
      if (!v.username || !v.passwordHash) continue;
      const uname = v.username.trim().toLowerCase();
      if (deletedUsernames.has(uname)) continue;
      const hash = v.passwordHash.startsWith("scrypt:")
        ? v.passwordHash
        : await hashPassword(v.passwordHash);
      await supabase.from("staff").upsert(
        {
          username: uname,
          password_hash: hash,
          display_name: v.displayName || v.username,
          mobile: v.mobile ?? "",
          role: "volunteer",
          active: true,
        },
        { onConflict: "username" }
      );
    }

    // Seed admin: plaintext password in the sheet → hash it. If the sheet has
    // no admin row, nothing is created (the admin account is created via UI).
    const admin = findAdminFromCache("admin");
    if (admin?.password) {
      await supabase.from("staff").upsert(
        {
          username: admin.username.trim().toLowerCase(),
          password_hash: await hashPassword(admin.password),
          display_name: admin.displayName || admin.username,
          role: "admin",
          active: true,
        },
        { onConflict: "username" }
      );
    }

    await markSeeded();
    console.log(
      `[staffStore] Seeded ${volunteers.length} volunteer(s) from Google Sheets.`
    );
  } catch (error) {
    // Never break auth because the legacy sheet is down.
    console.warn("[staffStore] Sheet seed skipped:", error);
  }
}

/* ------------------------------------------------------------------ */
/* READS                                                               */
/* ------------------------------------------------------------------ */

async function ensureSeeded(): Promise<void> {
  // Fire-and-forget from the caller's perspective — awaited so that the very
  // first login/list after a cold start already sees sheet accounts.
  await seedFromSheets();
}

export async function getStaffByUsername(
  username: string
): Promise<Staff | undefined> {
  await ensureSeeded();
  const norm = username.trim().toLowerCase();
  if (!norm) return undefined;
  const { data, error } = await supabase
    .from("staff")
    .select("*")
    .ilike("username", norm)
    .limit(1);
  if (error) {
    console.error("[staffStore] getStaffByUsername failed:", error);
    return undefined;
  }
  const row = (data as StaffRow[] | null)?.[0];
  return row && row.active ? toStaff(row) : undefined;
}

export async function getStaffById(id: number): Promise<Staff | undefined> {
  await ensureSeeded();
  // The numeric id is a hash of the UUID — resolve by scanning (staff tables
  // are tiny); exact-match primary key lookups are not possible through
  // PostgREST with a derived id.
  const { data, error } = await supabase.from("staff").select("*");
  if (error) {
    console.error("[staffStore] getStaffById failed:", error);
    return undefined;
  }
  const row = (data as StaffRow[] | null)?.find(r => stableId(r.id) === id);
  return row ? toStaff(row) : undefined;
}

export async function listStaff(): Promise<Staff[]> {
  await ensureSeeded();
  const { data, error } = await supabase
    .from("staff")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[staffStore] listStaff failed:", error);
    return [];
  }
  return ((data ?? []) as StaffRow[]).map(toStaff);
}

/** Count of active admin accounts (used to protect the last admin). */
export async function countActiveAdmins(): Promise<number> {
  const { data, error } = await supabase
    .from("staff")
    .select("id")
    .eq("role", "admin")
    .eq("active", true);
  if (error) return 0;
  return (data ?? []).length;
}

/* ------------------------------------------------------------------ */
/* WRITES                                                              */
/* ------------------------------------------------------------------ */

export async function createStaff(
  entry: InsertStaff
): Promise<Staff | undefined> {
  const norm = entry.username.trim().toLowerCase();
  // The account exists again — lift its deletion tombstone (if any) so a
  // future seed re-import is allowed.
  await clearStaffDeletedMarker(norm);
  const { data, error } = await supabase
    .from("staff")
    .upsert(
      {
        username: norm,
        password_hash: entry.passwordHash,
        display_name: entry.displayName,
        mobile: (entry as { mobile?: string }).mobile ?? "",
        role: entry.role ?? "volunteer",
        active: entry.active ?? true,
      },
      { onConflict: "username" }
    )
    .select("*")
    .single();
  if (error) {
    console.error("[staffStore] createStaff failed:", error);
    return undefined;
  }
  return toStaff(data as StaffRow);
}

export async function deleteStaffByUsername(
  username: string
): Promise<boolean> {
  const norm = username.trim().toLowerCase();
  const { error } = await supabase
    .from("staff")
    .delete()
    .ilike("username", norm);
  if (error) {
    console.error("[staffStore] deleteStaffByUsername failed:", error);
    return false;
  }
  // Tombstone the deletion so the one-time sheet seed never re-imports this
  // account on a fresh deployment (the seed marker lives in audit_logs and
  // can be cleared by the admin).
  await markStaffDeleted(norm);
  return true;
}

export async function deleteStaff(id: number): Promise<number> {
  const staff = await getStaffById(id);
  if (!staff) return 0;
  return (await deleteStaffByUsername(staff.username)) ? 1 : 0;
}

export async function updateStaffDisplayName(
  id: number,
  displayName: string
): Promise<Staff | undefined> {
  const staff = await getStaffById(id);
  if (!staff) return undefined;
  const { data, error } = await supabase
    .from("staff")
    .update({ display_name: displayName })
    .ilike("username", staff.username)
    .select("*")
    .single();
  if (error) {
    console.error("[staffStore] updateStaffDisplayName failed:", error);
    return undefined;
  }
  return toStaff(data as StaffRow);
}

export async function updateStaffPassword(
  id: number,
  passwordHash: string
): Promise<Staff | undefined> {
  const staff = await getStaffById(id);
  if (!staff) return undefined;
  const { data, error } = await supabase
    .from("staff")
    .update({ password_hash: passwordHash })
    .ilike("username", staff.username)
    .select("*")
    .single();
  if (error) {
    console.error("[staffStore] updateStaffPassword failed:", error);
    return undefined;
  }
  return toStaff(data as StaffRow);
}

/** Verify a login attempt against the stored hash. */
export async function verifyStaffPassword(
  staff: Staff,
  password: string
): Promise<boolean> {
  return verifyPassword(password, staff.passwordHash);
}
