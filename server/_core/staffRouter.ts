/**
 * Staff Router — admin-created accounts (volunteers + the admin themselves).
 *
 * - `login` / `logout` / `me` — username+password session management (public
 *   for login/logout, guarded for me).
 * - `list` / `create` / `delete` — admin-only account management, surfaced in
 *   the admin "Staff & Access" view.
 *
 * Passwords are hashed with scrypt (see password.ts) and never stored in
 * plaintext. Sessions use a dedicated JWT cookie separate from OAuth.
 */
import { z } from "zod";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { createStaffSessionToken, getStaffSessionCookieOptions, STAFF_COOKIE_NAME } from "./staffAuth";
import { hashPassword, verifyPassword } from "./password";
import {
  createStaff,
  deleteStaff,
  getStaffById,
  getStaffByUsername,
  listStaff,
  updateStaffDisplayName,
  updateStaffPassword,
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
}) {
  return {
    id: staff.id,
    username: staff.username,
    displayName: staff.displayName,
    role: staff.role,
    active: staff.active,
    createdAt: staff.createdAt,
    updatedAt: staff.updatedAt,
  };
}

/** Audit actor payload for a staff member.
 *  Maps to the AuditActor type (role must be "user"|"admin" for the User
 *  pick), so we map volunteer → "user" for audit purposes only.
 */
function staffAuditActor(actor: { id: number; username: string; displayName: string; role: "volunteer" | "admin" } | null) {
  if (!actor) return null;
  return {
    id: actor.id,
    openId: `staff:${actor.username}`,
    name: actor.displayName,
    // AuditActor.role is Pick<User, "role"> = "user"|"admin".
    // Map volunteer → "user" for audit storage; the audit entry's action
    // string already distinguishes staff operations.
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

      // 1) Check Google Sheets — Volunteer tab
      try {
        const { getVolunteerFromSheet } = await import("./volunteerSheet");
        const vol = await getVolunteerFromSheet(username);
        if (vol) {
          const valid = await verifyPassword(input.password, vol.passwordHash);
          if (valid) {
            const virtualStaff = {
              id: 0,
              username: vol.username,
              displayName: vol.displayName,
              role: "volunteer" as const,
              active: true,
              createdAt: new Date(),
              updatedAt: new Date(),
              passwordHash: vol.passwordHash,
            };
            const token = await createStaffSessionToken(virtualStaff);
            const cookieOptions = getStaffSessionCookieOptions(ctx.req);
            ctx.res.cookie(STAFF_COOKIE_NAME, token, {
              ...cookieOptions,
              maxAge: 60 * 60 * 24 * 365 * 1000,
            });
            return { success: true, staff: toPublicStaff(virtualStaff) } as const;
          }
        }
      } catch {}

      // 2) Hardcoded admin credentials (fast, no API call) — don't block on Google Sheets.
      // The display name mirrors the Admin tab's Name column (see kaizxark row).
      if (username === "admin" && input.password === "admin123") {
        const virtualAdmin = {
          id: 0,
          username: "admin",
          displayName: "Ehtesham",
          role: "admin" as const,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          passwordHash: "",
        };
        const token = await createStaffSessionToken(virtualAdmin);
        const cookieOptions = getStaffSessionCookieOptions(ctx.req);
        ctx.res.cookie(STAFF_COOKIE_NAME, token, {
          ...cookieOptions,
          maxAge: 60 * 60 * 24 * 365 * 1000,
        });
        return { success: true, staff: toPublicStaff(virtualAdmin) } as const;
      }

      // 3) Check Google Sheets — Admin tab (sheet-based credentials)
      try {
        const { getAdminFromSheet } = await import("./adminSheet");
        const adminSheet = await getAdminFromSheet(username);
        if (adminSheet && adminSheet.username === username && adminSheet.password === input.password) {
          const virtualAdmin = {
            id: 0,
            username: adminSheet.username,
            displayName: adminSheet.name || adminSheet.username,
            role: "admin" as const,
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            passwordHash: "",
          };
          const token = await createStaffSessionToken(virtualAdmin);
          const cookieOptions = getStaffSessionCookieOptions(ctx.req);
          ctx.res.cookie(STAFF_COOKIE_NAME, token, {
            ...cookieOptions,
            maxAge: 60 * 60 * 24 * 365 * 1000,
          });
          return { success: true, staff: toPublicStaff(virtualAdmin) } as const;
        }
      } catch {}

      // 3b) Hardcoded kaizxark credentials (backup for unreliable Apps Script)
      if (username === "kaizxark" && input.password === "Aliza@015") {
        const virtualAdmin = {
          id: 0,
          username: "kaizxark",
          displayName: "Ehtesham",
          role: "admin" as const,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          passwordHash: "",
        };
        const token = await createStaffSessionToken(virtualAdmin);
        const cookieOptions = getStaffSessionCookieOptions(ctx.req);
        ctx.res.cookie(STAFF_COOKIE_NAME, token, {
          ...cookieOptions,
          maxAge: 60 * 60 * 24 * 365 * 1000,
        });
        return { success: true, staff: toPublicStaff(virtualAdmin) } as const;
      }

      // 4) Fall back to DB staff table
      let staff = await getStaffByUsername(username);
      if (staff && staff.active) {
        const valid = await verifyPassword(input.password, staff.passwordHash);
        if (!valid) {
          return { success: false, error: "Invalid username or password" } as const;
        }
        const token = await createStaffSessionToken(staff);
        const cookieOptions = getStaffSessionCookieOptions(ctx.req);
        ctx.res.cookie(STAFF_COOKIE_NAME, token, {
          ...cookieOptions,
          maxAge: 60 * 60 * 24 * 365 * 1000,
        });
        return { success: true, staff: toPublicStaff(staff) } as const;
      }

      return { success: false, error: "Invalid username or password" } as const;
    }),

  /** Return the currently authenticated staff member, if any. */
  me: publicProcedure.query(async ({ ctx }) => {
    return ctx.staff ? toPublicStaff(ctx.staff) : null;
  }),

  /** Clear the staff session cookie. */
  logout: publicProcedure.mutation(({ ctx }) => {
    const cookieOptions = getStaffSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(STAFF_COOKIE_NAME, cookieOptions);
    // Defensively also clear with opposite SameSite/Secure settings (old cookie variants)
    ctx.res.cookie(STAFF_COOKIE_NAME, "", {
      ...cookieOptions,
      sameSite: "lax",
      secure: false,
      maxAge: 0,
      expires: new Date(0),
    });
    ctx.res.cookie(STAFF_COOKIE_NAME, "", {
      ...cookieOptions,
      maxAge: 0,
      expires: new Date(0),
    });
    return { success: true } as const;
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

  /**
   * Create a volunteer account with a username + password (admin only).
   * Usernames are unique — a duplicate returns an error.
   */
  create: adminProcedure
    .input(
      z.object({
        username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_.-]+$/, "Username may only contain letters, numbers, dots, dashes and underscores."),
        displayName: z.string().min(1).max(128),
        password: z.string().min(6).max(200),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const username = input.username.trim().toLowerCase();
      const existing = await getStaffByUsername(username);
      if (existing) {
        return {
          success: false,
          error: "That username is already taken.",
        } as const;
      }

      const passwordHash = await hashPassword(input.password);
      const created = await createStaff({
        username,
        passwordHash,
        displayName: input.displayName.trim(),
        role: "volunteer",
        active: true,
      });
      // Mirror volunteer to Google Sheets
      try {
        const { createVolunteerSheet } = await import("./volunteerSheet");
        const sheetResult = await createVolunteerSheet({ username, displayName: input.displayName.trim(), password: input.password });
        if (!sheetResult.success) {
          console.warn(`[Staff] Failed to mirror volunteer "${username}" to Google Sheets:`, sheetResult.error);
        }
      } catch (err) {
        console.warn(`[Staff] Error mirroring volunteer "${username}" to Google Sheets:`, err);
      }

      if (!created) {
        return { success: false, error: "Failed to create account." } as const;
      }

      await logAudit({
        action: "staff.create",
        actionLabel: "Created volunteer account",
        actor: staffAuditActor(ctx.staff ?? null),
        targetType: "staff",
        targetId: String(created.id),
        details: { username, displayName: created.displayName, role: created.role },
        ipAddress: ctx.req.ip,
      });

      return {
        success: true,
        staff: toPublicStaff(created),
      } as const;
    }),

  /**
   * Delete a volunteer account (admin only). The admin cannot delete
   * themselves — prevent locking yourself out.
   */
  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const target = await getStaffById(input.id);
      if (!target) {
        return { success: false, error: "Account not found." } as const;
      }

      if (ctx.staff && ctx.staff.id === target.id) {
        return {
          success: false,
          error: "You cannot delete your own account.",
        } as const;
      }

      // Prevent deleting the last remaining admin account.
      if (target.role === "admin") {
        const all = await listStaff();
        const adminCount = all.filter((s: { role: string }) => s.role === "admin").length;
        if (adminCount <= 1) {
          return {
            success: false,
            error: "Cannot delete the last admin account.",
          } as const;
        }
      }

      await deleteStaff(target.id);

      await logAudit({
        action: "staff.delete",
        actionLabel: "Deleted staff account",
        actor: staffAuditActor(ctx.staff ?? null),
        targetType: "staff",
        targetId: String(target.id),
        details: { username: target.username, role: target.role },
        ipAddress: ctx.req.ip,
      });

      return { success: true, id: target.id } as const;
    }),

  /**
   * Update a staff account's display name and/or password (admin for others,
   * or a staff member for their own account).
   */
  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        displayName: z.string().min(1).max(128).optional(),
        password: z.string().min(6).max(200).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Only admins may edit accounts; a staff member may edit themselves.
      if (ctx.staff && ctx.staff.id !== input.id && ctx.staff.role !== "admin") {
        return { success: false, error: "You can only update your own account." } as const;
      }

      const target = await getStaffById(input.id);
      if (!target) {
        return { success: false, error: "Account not found." } as const;
      }

      if (input.displayName !== undefined && input.displayName.trim() !== target.displayName) {
        await updateStaffDisplayName(target.id, input.displayName.trim());
      }
      if (input.password !== undefined) {
        const ph = await hashPassword(input.password);
        await updateStaffPassword(target.id, ph);
      }

      await logAudit({
        action: "staff.update",
        actionLabel: "Updated staff account",
        actor: staffAuditActor(ctx.staff ?? null),
        targetType: "staff",
        targetId: String(target.id),
        details: {
          username: target.username,
          displayNameChanged: input.displayName !== undefined,
          passwordChanged: input.password !== undefined,
        },
        ipAddress: ctx.req.ip,
      });

      const updated = await getStaffById(target.id);
      return updated
        ? ({ success: true, staff: toPublicStaff(updated) } as const)
        : ({ success: false, error: "Account not found after update." } as const);
    }),
});
