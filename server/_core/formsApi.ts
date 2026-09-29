/**
 * Data-access layer for the `forms` table (multi-form, per-camp feature).
 *
 * MANY forms can be live at once — every camp/generation gets its own form
 * with its own link, title and description. Each row's uuid `id` doubles as
 * the unguessable public form token served at /form/<id>. RLS is
 * default-deny; every access here goes through the service-role client, so
 * only this server can read or write forms.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "./env";

export type FormType = "pending" | "registration";

export interface FormRow {
  id: string;
  type: FormType;
  active: boolean;
  title: string | null;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
  terminatedAt: string | null;
  submissions: number;
}

const ROW_COLUMNS = "id, type, active, title, description, created_by, created_at, terminated_at, submissions";

let _admin: SupabaseClient | null = null;
function adminClient(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(ENV.supabaseUrl, ENV.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

function mapRow(row: Record<string, unknown>): FormRow {
  return {
    id: row.id as string,
    type: row.type as FormType,
    active: row.active === true,
    title: (row.title as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: row.created_at as string,
    terminatedAt: (row.terminated_at as string | null) ?? null,
    submissions: (row.submissions as number | null) ?? 0,
  };
}

/** All forms, newest first — live and terminated, for the admin manager. */
export async function listForms(limit = 50): Promise<FormRow[]> {
  const { data, error } = await adminClient()
    .from("forms")
    .select(ROW_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

/** All currently-live forms (any type). */
export async function getActiveForms(): Promise<FormRow[]> {
  const { data, error } = await adminClient()
    .from("forms")
    .select(ROW_COLUMNS)
    .eq("active", true)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

/** Back-compat: the newest active form, or null. */
export async function getActiveForm(): Promise<FormRow | null> {
  const rows = await getActiveForms();
  return rows[0] ?? null;
}

export interface CreateFormInput {
  type: FormType;
  title?: string | null;
  description?: string | null;
}

/** Create a new form. Any number of forms may be live concurrently. */
export async function createForm(
  input: CreateFormInput,
  createdBy: string | null
): Promise<FormRow> {
  const title = input.title?.trim() || null;
  const description = input.description?.trim() || null;
  const { data, error } = await adminClient()
    .from("forms")
    .insert({
      type: input.type,
      active: true,
      title,
      description,
      created_by: createdBy,
    })
    .select(ROW_COLUMNS)
    .single();
  if (error) throw error;
  return mapRow(data);
}

/** Update a form's custom title/description. Returns the updated row. */
export async function updateForm(
  id: string,
  patch: { title?: string | null; description?: string | null }
): Promise<FormRow | null> {
  const update: Record<string, string | null> = {};
  if (patch.title !== undefined) update.title = patch.title?.trim() || null;
  if (patch.description !== undefined)
    update.description = patch.description?.trim() || null;
  if (Object.keys(update).length === 0) {
    const { data } = await adminClient()
      .from("forms")
      .select(ROW_COLUMNS)
      .eq("id", id)
      .limit(1);
    return data?.[0] ? mapRow(data[0]) : null;
  }
  const { data, error } = await adminClient()
    .from("forms")
    .update(update)
    .eq("id", id)
    .select(ROW_COLUMNS)
    .single();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

/** Set a form live or closed. Returns the updated row, or null if unknown. */
export async function setFormActive(
  id: string,
  active: boolean
): Promise<FormRow | null> {
  const { data, error } = await adminClient()
    .from("forms")
    .update({
      active,
      terminated_at: active ? null : new Date().toISOString(),
    })
    .eq("id", id)
    .select(ROW_COLUMNS)
    .single();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

/** Terminate a single form by id. Returns the form that was closed. */
export async function terminateForm(id: string): Promise<FormRow | null> {
  return setFormActive(id, false);
}

/** Permanently delete a form row. Returns true if a row was removed. */
export async function deleteForm(id: string): Promise<boolean> {
  const { data, error } = await adminClient()
    .from("forms")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/** Terminate every live form (used by legacy single-form flows). */
export async function terminateActiveForms(): Promise<number> {
  const { data, error } = await adminClient()
    .from("forms")
    .update({ active: false, terminated_at: new Date().toISOString() })
    .eq("active", true)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * Resolve a form token to an ACTIVE form of the expected type, including
 * its custom title/description. Inactive or unknown tokens resolve to
 * null — the submission endpoint rejects those.
 */
export async function resolveActiveForm(
  token: string,
  type: FormType
): Promise<FormRow | null> {
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return null;
  const { data, error } = await adminClient()
    .from("forms")
    .select(ROW_COLUMNS)
    .eq("id", token)
    .eq("active", true)
    .eq("type", type)
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  return row ? mapRow(row) : null;
}

/** Resolve a token to any active form regardless of type (public page). */
export async function resolveAnyActiveForm(
  token: string
): Promise<FormRow | null> {
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return null;
  const { data, error } = await adminClient()
    .from("forms")
    .select(ROW_COLUMNS)
    .eq("id", token)
    .eq("active", true)
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  return row ? mapRow(row) : null;
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
