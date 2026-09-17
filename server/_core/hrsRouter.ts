/**
 * HRS Data Router
 * Server-side routes for HRS data operations
 *
 * Read path:  Google Sheets CSV (via googleSheetsApi) — fast, auto-refreshed every 15s
 * Write path: Google Apps Script API — called only on mutations (verify, donate, delete)
 */
import { z } from "zod";
import {
  publicProcedure,
  router,
  volunteerProcedure,
} from "./trpc";
import * as gasApi from "./googleAppsScriptApi";
import * as emailService from "./emailService";
import { logAudit, logProfileAudit, type AuditActor } from "./auditLogger";
import {
  ensureFreshCache,
  forceRefresh,
  getCachedAdminRecords,
  getCachedLocations,
  getCachedProfiles,
  getCachedPublicProfiles,
  getCachedStatistics,
  getDataHealth,
  getSyncStats,
  buildDirectoryCsv,
  buildDirectoryXlsx,
  stopPoller,
  resumePoller,
  setPollInterval,
  getPollerState,
} from "./googleSheetsApi";
import {
  triggerPendingFormSync,
  getPendingFormSyncStatus,
} from "./pendingFormSync";

/** Build the standard audit actor payload from the tRPC context user. */
function auditActor(
  user: { id: number; openId: string; name: string | null; role: string } | null
): AuditActor {
  if (!user) return null;
  return {
    id: user.id,
    openId: user.openId,
    name: user.name,
    role: user.role as "user" | "admin",
  };
}

/**
 * Read procedure builders — top up the read cache before answering.
 *
 * On the long-running Node server this is a cheap no-op (the background poller
 * keeps the cache fresh). On serverless (Vercel) there is no poller, so each
 * read lazily re-fetches the Google Sheets CSV when the cache is older than
 * READ_FRESHNESS_MS; `ensureFreshCache` coalesces parallel requests into one
 * fetch per instance. Mutations are intentionally left on plain
 * `publicProcedure` — they already round-trip through the Apps Script write
 * path and never depend on the cache.
 */
const read = publicProcedure.use(async ({ next }) => {
  await ensureFreshCache();
  return next();
});

const readVolunteer = volunteerProcedure.use(async ({ next }) => {
  await ensureFreshCache();
  return next();
});

export const hrsRouter = router({
  // Health check
  health: publicProcedure.query(async () => {
    const result = await gasApi.ping();
    return result;
  }),

  // Get admin records — pre-converted to the shape Admin.tsx uses.
  // Smaller payload, so SSE-triggered refetches land in <200ms.
  profiles: read.query(async () => {
    return getCachedAdminRecords();
  }),

  // Force-refresh profiles from Google Sheets now
  syncProfiles: publicProcedure.mutation(async ({ ctx }) => {
    const before = getCachedAdminRecords().data?.records.length ?? 0;
    await forceRefresh();
    const after = getCachedAdminRecords().data?.records.length ?? 0;
    await logAudit({
      action: "directory.sync",
      actionLabel: "Forced directory sync",
      actor: auditActor(ctx.user),
      targetType: "system",
      details: { before, after },
      ipAddress: ctx.req.ip,
    });
    return getCachedAdminRecords();
  }),

  // Get Tumkur locations with real-time stats and newly appeared areas
  locations: read.query(async () => {
    return getCachedLocations();
  }),

  // Live sync/cache diagnostics for the admin "Sync & Data" panel.
  syncStatus: read.query(async () => {
    return getSyncStats();
  }),

  // Control the server-side background poller from the admin panel.
  // `enabled` toggles pause/resume; `intervalMs` changes the poll cadence.
  setAutoSync: publicProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        intervalMs: z.number().min(1000).max(300_000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.enabled) {
        resumePoller();
      } else {
        stopPoller();
      }
      if (input.intervalMs != null) {
        setPollInterval(input.intervalMs);
      }
      return getPollerState();
    }),

  // --------------------------------------------------------------------------
  // Pending Google Form → Profiles sync (R9)
  //
  // On Vercel serverless there are no persistent background timers, so the
  // pending-form import is triggered on-demand via this procedure.  On local
  // dev it also runs automatically every 5 min via startPendingFormSync().
  // --------------------------------------------------------------------------

  /** Status of the pending-form auto-sync (diagnostic). */
  pendingFormStatus: read.query(async () => {
    return getPendingFormSyncStatus();
  }),

  /** Manually trigger a pending-form → Profiles sync cycle. */
  syncPendingForms: publicProcedure.mutation(async ({ ctx }) => {
    const result = await triggerPendingFormSync();
    await logAudit({
      action: "pending_forms.sync",
      actionLabel: "Synced pending form submissions",
      actor: auditActor(ctx.user),
      targetType: "system",
      details: {
        imported: result.imported,
        skipped: result.skipped,
        errorCount: result.errors.length,
      },
      ipAddress: ctx.req.ip,
    });
    return result;
  }),

  // Data-quality summary computed from the in-memory cache.
  dataHealth: read.query(async () => {
    return getDataHealth();
  }),

  // Test both connectivity paths (read = Google Sheets CSV, write = Apps Script).
  syncDiagnostics: publicProcedure.mutation(async () => {
    const readStart = Date.now();
    await forceRefresh();
    const readLatencyMs = Date.now() - readStart;

    const gasApi = await import("./googleAppsScriptApi");
    const write = await gasApi.testWritePath();

    return {
      read: {
        ok: getSyncStats().lastStatus !== "error",
        latencyMs: readLatencyMs,
        error: getSyncStats().lastError,
        count: getSyncStats().cachedRecordCount,
      },
      write,
    };
  }),

  // Export the current directory as an Excel (.xlsx) file.
  exportCsv: read.query(async () => {
    return buildDirectoryXlsx();
  }),

  // Get single profile by HRS ID
  profile: read
    .input(z.object({ hrsId: z.string() }))
    .query(async ({ input }) => {
      const all = getCachedProfiles();
      if (!all.success || !all.data) {
        return { success: false, error: "Profiles not loaded" };
      }
      const found = all.data.profiles.find(
        p => (p["HRS ID"] ?? "").trim() === input.hrsId.trim()
      );
      if (!found) {
        return { success: false, error: "Profile not found" };
      }
      return { success: true, data: found };
    }),

  // Get public profiles (public - filtered by backend)
  publicProfiles: read.query(async () => {
    return getCachedPublicProfiles();
  }),

  // Get all records with full personal contact details — available only to
  // authenticated volunteers/admins (never to the public homepage). Unlike
  // `profiles` (admin panel), this includes *pending* records too, because a
  // volunteer helping people should be able to reach donors still awaiting
  // verification.
  volunteerProfiles: readVolunteer.query(async () => {
    const records = getCachedAdminRecords();
    if (!records.success || !records.data) {
      return { success: false, error: "Profiles not loaded yet" };
    }
    return {
      success: true,
      data: {
        records: records.data.records,
        count: records.data.records.length,
      },
    };
  }),

  // Single record with full contact details (volunteer/admin only).
  volunteerProfile: readVolunteer
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const records = getCachedAdminRecords();
      if (!records.success || !records.data) {
        return { success: false, error: "Profiles not loaded yet" };
      }
      const found = records.data.records.find(
        r => r.id === input.id.trim()
      );
      if (!found) {
        return { success: false, error: "Profile not found" };
      }
      return { success: true, data: found };
    }),

  // Get statistics
  statistics: read.query(async () => {
    return getCachedStatistics();
  }),

  // Send verification email to a donor
  sendVerificationEmail: publicProcedure
    .input(
      z.object({
        hrsId: z.string(),
        bloodGroup: z.string().optional(),
        donorConsent: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { response, via } = await emailService.sendVerificationEmail(
        input.hrsId,
        {
          bloodGroup: input.bloodGroup,
          donorConsent: input.donorConsent,
        }
      );
      await logProfileAudit(input.hrsId, {
        action: "profile.send_email",
        actionLabel: "Sent verification email",
        actor: auditActor(ctx.user),
        success: response.success,
        details: input.bloodGroup
          ? {
              bloodGroup: input.bloodGroup,
              donorConsent: input.donorConsent,
              channel: via,
            }
          : { channel: via },
        ipAddress: ctx.req.ip,
      });
      return response;
    }),

  // Verify profile
  verifyProfile: publicProcedure
    .input(
      z.object({
        hrsId: z.string(),
        bloodGroup: z.string(),
        donorConsent: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await gasApi.verifyProfile(
        input.hrsId,
        input.bloodGroup,
        input.donorConsent
      );
      await logProfileAudit(input.hrsId, {
        action: "profile.verify",
        actionLabel: "Verified donor profile",
        actor: auditActor(ctx.user),
        success: result.success,
        details: { bloodGroup: input.bloodGroup, donorConsent: input.donorConsent },
        ipAddress: ctx.req.ip,
      });
      return result;
    }),

  // Add a brand-new person and verify them immediately (admin "Add Person"
  // modal). Apps Script appends a full row with the next HRS ID and
  // Verification Status=VERIFIED, so the profile skips Pending entirely.
  addPerson: publicProcedure
    .input(
      z.object({
        fullName: z.string().min(1),
        bloodGroup: z.string(),
        donorConsent: z.enum(["YES", "NO"]),
        dateOfBirth: z.string().optional(),
        gender: z.string().optional(),
        phoneNumber: z.string().optional(),
        email: z.string().optional(),
        city: z.string().optional(),
        area: z.string().optional(),
        dataStorageConsent: z.enum(["YES", "NO"]).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await gasApi.addPerson(input);
      await logProfileAudit(result.data?.hrs_id ?? input.fullName, {
        action: "profile.add_person",
        actionLabel: "Added and verified new profile",
        actor: auditActor(ctx.user),
        success: result.success,
        details: {
          fullName: input.fullName,
          bloodGroup: input.bloodGroup,
          donorConsent: input.donorConsent,
        },
        ipAddress: ctx.req.ip,
      });
      return result;
    }),

  // Record blood donation
  recordDonation: publicProcedure
    .input(
      z.object({
        hrsId: z.string(),
        donationTime: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await gasApi.recordDonation(
        input.hrsId,
        input.donationTime
      );
      await logProfileAudit(input.hrsId, {
        action: "profile.donation",
        actionLabel: "Recorded blood donation",
        actor: auditActor(ctx.user),
        success: result.success,
        details: { donationTime: input.donationTime },
        ipAddress: ctx.req.ip,
      });
      return result;
    }),

  // Reset all profiles (destructive, requires password). Erases every profile
  // row in the sheet, then re-appends them with fresh sequential HRS IDs
  // starting from HRS-0001. Password is verified server-side by Apps Script.
  resetProfiles: publicProcedure
    .input(
      z.object({
        password: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      let result: Awaited<ReturnType<typeof gasApi.resetProfiles>>;
      try {
        result = await gasApi.resetProfiles(input.password);
      } catch (err) {
        await logAudit({
          action: "profile.reset",
          actionLabel: "Reset all profiles",
          actor: auditActor(ctx.user),
          targetType: "profile",
          targetId: "ALL",
          success: false,
          details: { error: err instanceof Error ? err.message : String(err) },
          ipAddress: ctx.req.ip,
        });
        throw err;
      }
      await logAudit({
        action: "profile.reset",
        actionLabel: "Reset all profiles",
        actor: auditActor(ctx.user),
        targetType: "profile",
        targetId: "ALL",
        success: result.success,
        details: result.success
          ? { count: result.data?.count }
          : { error: result.error },
        ipAddress: ctx.req.ip,
      });
      return result;
    }),

  // Delete profiles by HRS ID (admin only)
  deleteProfiles: publicProcedure
    .input(
      z.object({
        hrsIds: z.array(z.string()),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await gasApi.deleteProfiles(input.hrsIds);
      await logAudit({
        action: "profile.delete",
        actionLabel: `Deleted ${input.hrsIds.length} profile(s)`,
        actor: auditActor(ctx.user),
        targetType: "profile",
        targetId: input.hrsIds.join(", "),
        success: result.success,
        details: { hrsIds: input.hrsIds, count: input.hrsIds.length },
        ipAddress: ctx.req.ip,
      });
      return result;
    }),

  // Update an existing verified profile (edit personal details, blood group, donor consent)
  updateProfile: publicProcedure
    .input(
      z.object({
        hrsId: z.string(),
        name: z.string().optional(),
        dob: z.string().optional(),
        gender: z.string().optional(),
        mobile: z.string().optional(),
        email: z.string().optional(),
        city: z.string().optional(),
        area: z.string().optional(),
        bloodGroup: z.string().optional(),
        donorConsent: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Collect which fields were actually passed (non-undefined) for the audit trail
      const changedFields: string[] = [];
      for (const key of Object.keys(input) as Array<keyof typeof input>) {
        if (key === "hrsId") continue;
        if (input[key] !== undefined) changedFields.push(key);
      }

      const result = await gasApi.updateProfile(input.hrsId, {
        name: input.name,
        dob: input.dob,
        gender: input.gender,
        mobile: input.mobile,
        email: input.email,
        city: input.city,
        area: input.area,
        bloodGroup: input.bloodGroup,
        donorConsent: input.donorConsent,
      });
      await logProfileAudit(input.hrsId, {
        action: "profile.update",
        actionLabel: "Updated donor profile",
        actor: auditActor(ctx.user),
        success: result.success,
        details: { changedFields },
        ipAddress: ctx.req.ip,
      });
      return result;
    }),
});
