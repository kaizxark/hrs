/**
 * Staff Router — admin-created accounts (volunteers + the admin themselves).
 *
 * Supabase `staff` table is the sole source of truth (the Google Sheets
 * Volunteer/Admin tabs were the previous store; they are imported once by
 * `staffStore.seedFromSheets` and no longer consulted for auth).
 *
 * - `login` / `logout` / `me` — username+password session management.
 * - `list` / `create` / `delete` / `update` — account management.
 *
 * Passwords are scrypt-hashed (see password.ts); sessions use a dedicated JWT
 * cookie separate from OAuth.
 */
import { z } from "zod";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { createStaffSessionToken, getStaffSessionCookieOptions, STAFF_COOKIE_NAME } from "./staffAuth";
import { hashPassword, verifyPassword } from "./password";
import {
  countActiveAdmins,
  createStaff,
  deleteStaffByUsername,
  getStaffById,
  getStaffByUsername,
  listStaff,
  updateStaffDisplayName,
  updateStaffPassword,
  verifyStaffPassword,
} from "./staffStore";
import { logAudit } from "./auditLogger";

/** Strip the password hash before returning a staff row to clients. */
function toPublicStaff(staff: {
  id: number;
  username: string;
  displayName: string;
  role: "volunteer" | "admin";
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  mobile?: string;
}) {
  return {
    id: staff.id,
    username: staff.username,
    displayName: staff.displayName,
    role: staff.role,
    active: staff.active,
    createdAt: staff.createdAt,
    updatedAt: staff.updatedAt,
    mobile: staff.mobile ?? "",
  };
}

/** Audit actor payload for a staff member. */
function staffAuditActor(actor: { id: number; username: string; displayName: string; role: "volunteer" | "admin" } | null) {
  if (!actor) return null;
  return {
    id: actor.id,
    openId: `staff:${actor.username}`,
    name: actor.displayName,
    role: actor.role === "admin" ? "admin" as const : "user" as const,
  };
}

export const staffRouter = router({
  /** Authenticate a staff account with username + password, set the session cookie. */
  login: publicProcedure
    .input(
      z.object({
        username: z.string().min(1).max(64),
        password: z.string().min(1).max(200),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const username = input.username.trim();

      const staff = await getStaffByUsername(username);
      const valid = staff ? await verifyStaffPassword(staff, input.password) : false;

      if (!staff || !valid) {
        await logAudit({
          action: "staff.login_failed",
          actionLabel: "Failed staff login",
          actor: null,
          targetType: "staff",
          targetId: username,
          success: false,
          details: { username },
          ipAddress: ctx.req.ip,
        });
        return { success: false, error: "Invalid username or password" } as const;
      }

      const token = await createStaffSessionToken(staff);
      const cookieOptions = getStaffSessionCookieOptions(ctx.req);
      ctx.res.cookie(STAFF_COOKIE_NAME, token, {
        ...cookieOptions,
        maxAge: 60 * 60 * 24 * 365 * 1000,
      });

      await logAudit({
        action: "staff.login",
        actionLabel: "Staff signed in",
        actor: staffAuditActor(staff),
        targetType: "staff",
        targetId: staff.username,
        ipAddress: ctx.req.ip,
      });

      return { success: true, staff: toPublicStaff(staff) } as const;
    }),

  /** Return the currently authenticated staff member, if any. */
  me: publicProcedure.query(async ({ ctx }) => {
    return ctx.staff ? toPublicStaff(ctx.staff) : null;
  }),

  /** Clear the staff session cookie. */
  logout: publicProcedure.mutation(({ ctx }) => {
    const cookieOptions = getStaffSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(STAFF_COOKIE_NAME, cookieOptions);
    ctx.res.cookie(STAFF_COOKIE_NAME, "", {
      ...cookieOptions,
      maxAge: 0,
      expires: new Date(0),
    });
    return { success: true } as const;
  }),

  /** Public emergency contacts — active volunteers with a mobile number. */
  emergencyContacts: publicProcedure.query(async () => {
    const staff = await listStaff();
    return staff
      .filter(s => s.active && s.role === "volunteer" && (s.mobile ?? "").trim().length > 0)
      .map(s => ({ name: s.displayName || s.username, phone: s.mobile.trim() }));
  }),

  /** List all staff accounts (admin only). */
  list: adminProcedure.query(async ({ ctx }) => {
    const all = await listStaff();

    const actor = ctx.staff ?? null;
    await logAudit({
      action: "staff.list",
      actionLabel: "Viewed staff & access",
      actor: staffAuditActor(actor),
      targetType: "system",
      details: { count: all.length },
      ipAddress: ctx.req.ip,
    });
    return all.map(toPublicStaff);
  }),

  /** Create a volunteer account (admin only). */
  create: adminProcedure
    .input(
      z.object({
        username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_.-]+$/, "Username may only contain letters, numbers, dots, dashes and underscores."),
        displayName: z.string().min(1).max(128),
        password: z.string().min(6).max(200),
        mobile: z.string().max(20).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const username = input.username.trim().toLowerCase();

      const existing = await getStaffByUsername(username);
      if (existing) {
        return { success: false, error: "That username is already taken." } as const;
      }

      const passwordHash = await hashPassword(input.password);
      const created = await createStaff({
        username,
        passwordHash,
        displayName: input.displayName.trim(),
        role: "volunteer",
        active: true,
        mobile: input.mobile?.trim() ?? "",
      });

      if (!created) {
        return { success: false, error: "Failed to create account." } as const;
      }

      await logAudit({
        action: "staff.create",
        actionLabel: "Created volunteer account",
        actor: staffAuditActor(ctx.staff ?? null),
        targetType: "staff",
        targetId: username,
        details: { username, displayName: created.displayName, role: created.role, mobile: created.mobile },
        ipAddress: ctx.req.ip,
      });

      return { success: true, staff: toPublicStaff(created) } as const;
    }),

  /** Delete a staff account (admin only). Resolves by username (stable key). */
  delete: adminProcedure
    .input(
      z.object({
        id: z.number().optional(),
        username: z.string().trim().toLowerCase().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Resolve by username first (stable), fall back to id.
      let target = input.username ? await getStaffByUsername(input.username) : undefined;
      if (!target && input.id !== undefined) target = await getStaffById(input.id);

      if (!target) {
        return { success: false, error: "Account not found." } as const;
      }

      if (
        ctx.staff &&
        ctx.staff.username.toLowerCase() === target.username.toLowerCase()
      ) {
        return { success: false, error: "You cannot delete your own account." } as const;
      }

      if (target.role === "admin" && (await countActiveAdmins()) <= 1) {
        return { success: false, error: "Cannot delete the last admin account." } as const;
      }

      const ok = await deleteStaffByUsername(target.username);
      if (!ok) {
        return { success: false, error: "Failed to delete account." } as const;
      }

      await logAudit({
        action: "staff.delete",
        actionLabel: "Deleted staff account",
        actor: staffAuditActor(ctx.staff ?? null),
        targetType: "staff",
        targetId: target.username,
        details: { username: target.username, role: target.role },
        ipAddress: ctx.req.ip,
      });

      return { success: true, id: target.id } as const;
    }),

  /** Update a staff account's display name and/or password (admin only). */
  update: adminProcedure
    .input(
      z.object({
        id: z.number().optional(),
        username: z.string().trim().toLowerCase().optional(),
        displayName: z.string().min(1).max(128).optional(),
        password: z.string().min(6).max(200).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      let resolved = input.username ? await getStaffByUsername(input.username) : undefined;
      if (!resolved && input.id !== undefined) resolved = await getStaffById(input.id);

      if (!resolved) {
        return { success: false, error: "Account not found." } as const;
      }

      // The sheet-era flow allowed non-admins to edit themselves; the UI only
      // calls this from the admin panel, so keep it admin-gated.
      if (ctx.staff && ctx.staff.id !== resolved.id && ctx.staff.role !== "admin") {
        return { success: false, error: "You can only update your own account." } as const;
      }

      if (input.displayName !== undefined && input.displayName.trim() !== resolved.displayName) {
        await updateStaffDisplayName(resolved.id, input.displayName.trim());
      }
      if (input.password !== undefined) {
        const ph = await hashPassword(input.password);
        await updateStaffPassword(resolved.id, ph);
      }

      await logAudit({
        action: "staff.update",
        actionLabel: "Updated staff account",
        actor: staffAuditActor(ctx.staff ?? null),
        targetType: "staff",
        targetId: resolved.username,
        details: {
          username: resolved.username,
          displayNameChanged: input.displayName !== undefined,
          passwordChanged: input.password !== undefined,
        },
        ipAddress: ctx.req.ip,
      });

      const updated = await getStaffById(resolved.id);
      return updated
        ? ({ success: true, staff: toPublicStaff(updated) } as const)
        : ({ success: false, error: "Account not found after update." } as const);
    }),
});
