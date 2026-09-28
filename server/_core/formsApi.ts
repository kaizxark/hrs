/**
 * Data-access layer for the `forms` table (admin form-activation feature).
 *
 * Only ONE form is active at a time: activating a new form terminates the
 * previous one atomically (single UPDATE ... WHERE active = true RETURNING).
 * The row's uuid `id` doubles as the unguessable public form token served at
 * /form/<id>. RLS is default-deny; every access here goes through the
 * service-role client, so only this server can read or write forms.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "./env";

export type FormType = "pending" | "registration";

export interface ActiveForm {
  id: string;
  type: FormType;
  createdAt: string;
  submissions: number;
}

let _admin: SupabaseClient | null = null;
function adminClient(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(ENV.supabaseUrl, ENV.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

export async function getActiveForm(): Promise<ActiveForm | null> {
  const { data, error } = await adminClient()
    .from("forms")
    .select("id, type, created_at, submissions")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return {
    id: row.id,
    type: row.type as FormType,
    createdAt: row.created_at,
    submissions: row.submissions ?? 0,
  };
}

/**
 * Start a new form of `type`. Any currently active form is terminated first
 * (single atomic UPDATE, server-side) so exactly one form can be live.
 */
export async function activateForm(
  type: FormType,
  createdBy: string | null
): Promise<ActiveForm> {
  const client = adminClient();
  // Terminate whatever is active right now (atomic, server-side).
  await client
    .from("forms")
    .update({ active: false, terminated_at: new Date().toISOString() })
    .eq("active", true);

  const { data, error } = await client
    .from("forms")
    .insert({ type, active: true, created_by: createdBy })
    .select("id, type, created_at, submissions")
    .single();
  if (error) throw error;
  return {
    id: data.id,
    type: data.type as FormType,
    createdAt: data.created_at,
    submissions: data.submissions ?? 0,
  };
}

/** Terminate the active form (if any). Returns the form that was closed. */
export async function terminateActiveForm(): Promise<ActiveForm | null> {
  const active = await getActiveForm();
  if (!active) return null;
  const { error } = await adminClient()
    .from("forms")
    .update({ active: false, terminated_at: new Date().toISOString() })
    .eq("id", active.id)
    .eq("active", true);
  if (error) throw error;
  return active;
}

/**
 * Resolve a form token to an ACTIVE form of the expected type. Inactive or
 * unknown tokens resolve to null — the submission endpoint rejects those.
 */
export async function resolveActiveForm(
  token: string,
  type: FormType
): Promise<ActiveForm | null> {
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return null;
  const { data, error } = await adminClient()
    .from("forms")
    .select("id, type, created_at, submissions")
    .eq("id", token)
    .eq("active", true)
    .eq("type", type)
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return {
    id: row.id,
    type: row.type as FormType,
    createdAt: row.created_at,
    submissions: row.submissions + 1,
  };
}

/** Count a submission against the form row (best-effort; never blocks). */
export async function incrementFormSubmissions(formId: string): Promise<void> {
  try {
    const { data } = await adminClient()
      .from("forms")
      .select("submissions")
      .eq("id", formId)
      .single();
    const current = (data as { submissions?: number } | null)?.submissions ?? 0;
    await adminClient()
      .from("forms")
      .update({ submissions: current + 1 })
      .eq("id", formId);
  } catch {
    // counters are informational; never fail a submission over them
  }
}
