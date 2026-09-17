/**
 * Staff Router — admin-created accounts (volunteers + the admin themselves).
 *
 * Every read resolves from the Google Sheets Volunteer + Admin tab CSV
 * caches. No database. No MySQL. The sheet is the sole source of truth.
 *
 * - `login` / `logout` / `me` — username+password session management.
 * - `list` / `create` / `delete` / `update` — account management.
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
  updateStaffDisplayName,
  updateStaffPassword,
} from "./staffStore";
import { logAudit } from "./auditLogger";
import {
  adminCountFromCache,
  ensureFreshStaffCache,
  findVolunteerFromCache,
  findAdminFromCache,
  listVolunteersFromCache,
} from "./staffCredentialCache";

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

      // Ensure the staff credential cache is fresh (stale-while-revalidate).
      await ensureFreshStaffCache();

      // Helper to set the session cookie and return the success payload.
      const issueSession = async (staff: { id: number; username: string; displayName: string; role: "volunteer" | "admin"; active: boolean; createdAt: Date; updatedAt: Date; passwordHash: string }) => {
        const token = await createStaffSessionToken(staff as any);
        const cookieOptions = getStaffSessionCookieOptions(ctx.req);
        ctx.res.cookie(STAFF_COOKIE_NAME, token, {
          ...cookieOptions,
          maxAge: 60 * 60 * 24 * 365 * 1000,
        });
        return { success: true, staff: toPublicStaff(staff) } as const;
      };

      // 1) Check Volunteer credential cache (Google Sheets Volunteer tab).
      const vol = findVolunteerFromCache(username);
      if (vol) {
        try {
          const valid = await verifyPassword(input.password, vol.passwordHash);
          if (valid) {
            return issueSession({
              id: 0,
              username: vol.username,
              displayName: vol.displayName,
              role: "volunteer",
              active: true,
              createdAt: new Date(),
              updatedAt: new Date(),
              passwordHash: vol.passwordHash,
            });
          }
        } catch {}
      }

      // 2) Check Admin credential cache (Google Sheets Admin tab).
      const adminSheet = findAdminFromCache(username);
      if (adminSheet && adminSheet.username === username && adminSheet.password === input.password) {
        return issueSession({
          id: 0,
          username: adminSheet.username,
          displayName: adminSheet.displayName || adminSheet.username,
          role: "admin",
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          passwordHash: "",
        });
      }

      // 3) The Volunteer/Admin tabs are the ONLY credential store.  Accounts
      //    just mirrored to the sheet by the UI (or edited directly in the
      //    sheet) may still be inside the 60 s cache TTL — retry once with a
      //    forced refresh.  Still 100% Google Sheets.
      await ensureFreshStaffCache(true);

      const freshVol = findVolunteerFromCache(username);
      if (freshVol) {
        try {
          const valid = await verifyPassword(input.password, freshVol.passwordHash);
          if (valid) {
            return issueSession({
              id: 0,
              username: freshVol.username,
              displayName: freshVol.displayName,
              role: "volunteer",
              active: true,
              createdAt: new Date(),
              updatedAt: new Date(),
              passwordHash: freshVol.passwordHash,
            });
          }
        } catch {}
      }

      const freshAdmin = findAdminFromCache(username);
      if (freshAdmin && freshAdmin.username === username && freshAdmin.password === input.password) {
        return issueSession({
          id: 0,
          username: freshAdmin.username,
          displayName: freshAdmin.displayName || freshAdmin.username,
          role: "admin",
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          passwordHash: "",
        });
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

  /** Public emergency contacts — volunteers with a mobile number.
   *  No auth required. Returns {name, phone}[] for the Home page popup.
   */
  emergencyContacts: publicProcedure.query(async () => {
    await ensureFreshStaffCache();
    const volunteers = listVolunteersFromCache();
    return volunteers
      .filter(v => v.mobile && v.mobile.trim().length > 0)
      .map(v => ({ name: v.displayName || v.username, phone: v.mobile }));
  }),

  /** List all staff accounts (admin only).
   *  100% Google Sheets: reads volunteers from the Volunteer tab CSV cache.
   *  Every account shown is a sheet-managed account (source: "sheet").
   */
  list: adminProcedure.query(async ({ ctx }) => {
    // Google Sheets Volunteer tab — the sole source of staff accounts.
    await ensureFreshStaffCache();
    const sheetVolunteers = listVolunteersFromCache();

    type StaffListRow = ReturnType<typeof toPublicStaff> & { source: "sheet"; mobile: string };
    const merged = new Map<string, StaffListRow>();

    let sheetId = -1;
    for (const v of sheetVolunteers) {
      const key = v.username.trim().toLowerCase();
      if (!key || merged.has(key)) continue;
      merged.set(key, {
        id: sheetId--,
        username: v.username,
        displayName: v.displayName || v.username,
        role: "volunteer" as const,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        source: "sheet",
        mobile: v.mobile || "",
      });
    }

    const all = Array.from(merged.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const actor = ctx.staff ?? null;
    await logAudit({
      action: "staff.list",
      actionLabel: "Viewed staff & access",
      actor: staffAuditActor(actor),
      targetType: "system",
      details: {
        count: all.length,
        sheetVolunteers: sheetVolunteers.length,
      },
      ipAddress: ctx.req.ip,
    });
    return all;
  }),

  /**
   * Create a volunteer account (admin only).
   * Writes to the Google Sheet first via Apps Script, then warms the
   * credential cache so login/list pick up the new account immediately.
   */
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

      // Uniqueness check — resolves against both sheet caches + the
      // ephemeral write buffer (covers the 60 s CSV-cache lag window).
      const existing = await getStaffByUsername(username);
      if (existing) {
        return { success: false, error: "That username is already taken." } as const;
      }

      const passwordHash = await hashPassword(input.password);

      // Mirror to Google Sheets FIRST — the sheet is the source of truth.
      try {
        const { createVolunteerSheet } = await import("./volunteerSheet");
        const sheetResult = await createVolunteerSheet({ username, displayName: input.displayName.trim(), password: input.password, mobile: input.mobile?.trim() || "" });
        if (!sheetResult.success) {
          return { success: false, error: `Failed to write to Google Sheets: ${sheetResult.error ?? "unknown error"}` } as const;
        }
      } catch (err) {
        console.error(`[Staff] Error mirroring volunteer "${username}" to Google Sheets:`, err);
        return { success: false, error: "Failed to write to Google Sheets. The account was not created." } as const;
      }

      // Force-refresh the staff cache so the new volunteer appears in
      // login/list on this instance immediately (Google CSV lag can be
      // several seconds after Apps Script append).
      await ensureFreshStaffCache(true);

      // Ephemeral write buffer — bridges the gap until the published CSV
      // reflects the new row (up to 60 s).
      const created = await createStaff({
        username,
        passwordHash,
        displayName: input.displayName.trim(),
        role: "volunteer",
        active: true,
      });

      if (!created) {
        return { success: false, error: "Failed to create account." } as const;
      }

      await logAudit({
        action: "staff.create",
        actionLabel: "Created volunteer account",
        actor: staffAuditActor(ctx.staff ?? null),
        targetType: "staff",
        targetId: String(created.id),
        details: { username, displayName: created.displayName, role: created.role, mobile: input.mobile?.trim() || "" },
        ipAddress: ctx.req.ip,
      });

      return { success: true, staff: toPublicStaff(created) } as const;
    }),

  /**
   * Delete a volunteer account (admin only).
   * All accounts live in the Google Sheet. The row is removed from the
   * Volunteer tab via Apps Script, then the cache is force-refreshed
   * so the deletion is reflected immediately in the UI.
   */
  delete: adminProcedure
    .input(
      z.object({
        id: z.number(),
        // Optional stable identifier passed by the client so deletes survive
        // cache-order shifts (sheet ids are positional and can move while the
        // CSV refreshes); used only for resolution, ignored beyond it.
        username: z.string().trim().toLowerCase().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // TEMP instrumentation (volunteer-delete diagnosis) — remove after RCA.
      console.log(`[staff.delete] arrived`, {
        id: input.id,
        username: input.username ?? null,
        actor: ctx.staff?.username ?? "UNAUTHED",
        origin:
          (ctx.req.headers as Record<string, string> | undefined)?.origin ??
          (ctx.req.headers as Record<string, string> | undefined)?.referer ??
          "unknown",
      });

      // Resolve the account.  Username is the preferred, stable key (sheet ids
      // are positional and shift whenever the cache order changes).  Negative
      // ids are sheet-native rows assigned in `list` order (id -1 = first
      // volunteer in the cache, -2 = second, ...); positive ids are ephemeral
      // write-buffer rows from UI creates (also mirrored to the sheet).
      let target: { id: number; username: string; displayName: string; role: "volunteer" | "admin" } | undefined;

      if (input.username) {
        // Preferred path — the client passes the exact username it displayed,
        // so the delete hits the right account even if the cache reordered.
        const buffered = await getStaffByUsername(input.username);
        if (buffered) {
          target = {
            id: buffered.id,
            username: buffered.username,
            displayName: buffered.displayName,
            role: buffered.role,
          };
        } else {
          const volunteers = listVolunteersFromCache();
          const v = volunteers.find(
            (vol: { username: string }) => vol.username.toLowerCase() === input.username
          );
          if (v) {
            target = {
              id: input.id,
              username: v.username,
              displayName: v.displayName || v.username,
              role: "volunteer",
            };
          }
        }
      } else if (input.id < 0) {
        // Sheet-native row — replicate the exact id ordering from `list`.
        const volunteers = listVolunteersFromCache();
        let sheetId = -1;
        for (const v of volunteers) {
          if (sheetId === input.id) {
            target = {
              id: input.id,
              username: v.username,
              displayName: v.displayName || v.username,
              role: "volunteer",
            };
            break;
          }
          sheetId--;
        }
      } else {
        // Ephemeral write-buffer row from a UI create.
        const buffered = await getStaffById(input.id);
        if (buffered) {
          target = {
            id: buffered.id,
            username: buffered.username,
            displayName: buffered.displayName,
            role: buffered.role,
          };
        }
      }

      if (!target) {
        return { success: false, error: "Account not found." } as const;
      }

      // Prevent an admin from deleting their own account.  Compare by
      // username — NOT by id: Google Sheets accounts (admin + volunteers)
      // all carry id 0, so an id comparison is always 0 === 0 and wrongly
      // blocks deletion of every sheet volunteer.
      if (
        ctx.staff &&
        ctx.staff.username.toLowerCase() === target.username.toLowerCase()
      ) {
        return {
          success: false,
          error: "You cannot delete your own account.",
        } as const;
      }

      // Prevent deleting the last remaining admin account.
      if (target.role === "admin") {
        const adminCount = adminCountFromCache();
        if (adminCount <= 1) {
          return {
            success: false,
            error: "Cannot delete the last admin account.",
          } as const;
        }
      }

      // Remove the row from the Google Sheet Volunteer tab (source of truth).
      try {
        const { deleteVolunteerSheet } = await import("./volunteerSheet");
        const sheetResult = await deleteVolunteerSheet(target.username);
        if (!sheetResult.success) {
          return {
            success: false,
            error: `Failed to delete from Google Sheets: ${sheetResult.error ?? "unknown error"}`,
          } as const;
        }
      } catch (err) {
        console.error(`[Staff] Error deleting volunteer "${target.username}" from Google Sheets:`, err);
        return {
          success: false,
          error: "Failed to delete from Google Sheets. The account was not removed.",
        } as const;
      }

      // Drop the ephemeral buffer row (if any) for positive ids.
      if (input.id >= 0) {
        await deleteStaff(target.id);
      }

      // Force-refresh the staff cache so login/list reflect the removal
      // immediately (Google CSV lag can be several seconds).
      await ensureFreshStaffCache(true);

      await logAudit({
        action: "staff.delete",
        actionLabel: "Deleted staff account",
        actor: staffAuditActor(ctx.staff ?? null),
        targetType: "staff",
        targetId: String(target.id),
        details: { username: target.username, role: target.role },
        ipAddress: ctx.req.ip,
      });

      console.log(`[staff.delete] SUCCESS`, { id: target.id, username: target.username });

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
