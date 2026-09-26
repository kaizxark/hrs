/**
 * Staff Store — Supabase `staff` table is the single source of truth.
 *
 * Previously staff credentials lived in two Google Sheets tabs (Volunteer +
 * Admin) read through CSV caches with a one-time import seed — the whole
 * mirror/seed/buffer layer is gone now:
 *
 * - READS  → direct queries against the `staff` table (service-role client).
 * - WRITES → direct inserts/updates/deletes; no mirror, no lag, no buffer,
 *            no background seed. Deletions are permanent (nothing re-imports
 *            deleted accounts from anywhere).
 */
import type { Staff, InsertStaff } from "../../drizzle/schema";
import { supabase } from "./supabaseApi";
import { hashPassword, verifyPassword } from "./password";

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
/* READS                                                               */
/* ------------------------------------------------------------------ */

export async function getStaffByUsername(
  username: string
): Promise<Staff | undefined> {
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
