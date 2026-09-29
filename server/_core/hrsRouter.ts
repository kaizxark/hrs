/**
 * HRS Data Router
 * Server-side routes for HRS data operations
 *
 * Read path:  Supabase PostgreSQL database
 * Write path: Supabase PostgreSQL database
 */
import { z } from "zod";
import {
  adminProcedure,
  publicProcedure,
  router,
  volunteerProcedure,
} from "./trpc";
import * as supabaseApi from "./supabaseApi";
import { logAudit, logProfileAudit, type AuditActor } from "./auditLogger";
import {
  getPendingFormStatus,
  runPendingFormSync,
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
 * Read procedure builders — no cache needed since we query Supabase directly.
 * Each read goes straight to the database.
 *
 * AUTHORIZATION: `read` is PUBLIC and must only be used for genuinely public
 * data (the public directory, aggregate stats). Anything that returns personal
 * contact details belongs on `readVolunteer` (staff volunteer/admin) or
 * `adminProcedure`. Mutations that change directory state are admin-only.
 */
const read = publicProcedure.use(async ({ next }) => {
  // No cache to refresh - go directly to Supabase
  return next();
});

const readVolunteer = volunteerProcedure.use(async ({ next }) => {
  // No cache to refresh - go directly to Supabase
  return next();
});

export const hrsRouter = router({
  // Health check
  health: publicProcedure.query(async () => {
    const result = await supabaseApi.ping();
    return result;
  }),

  // Get admin records — pre-converted to the shape Admin.tsx uses. Includes
  // personal contact details, so it requires a staff volunteer/admin session.
  profiles: readVolunteer.query(async () => {
    return supabaseApi.getAdminRecords();
  }),

  // Force-refresh profiles (now just a direct query since we use Supabase)
  syncProfiles: adminProcedure.mutation(async ({ ctx }) => {
    const beforeResult = await supabaseApi.getAdminRecords();
    const before = beforeResult.success ? beforeResult.data?.records.length ?? 0 : 0;
    
    // Just requery - no actual refresh needed for Supabase
    const afterResult = await supabaseApi.getAdminRecords();
    const after = afterResult.success ? afterResult.data?.records.length ?? 0 : 0;
    
    await logAudit({
      action: "directory.sync",
      actionLabel: "Forced directory sync",
      actor: auditActor(ctx.user),
      targetType: "system",
      details: { before, after },
      ipAddress: ctx.req.ip,
    });
    return afterResult;
  }),

  // Get Tumkur locations with real-time stats and newly appeared areas
  locations: read.query(async () => {
    return supabaseApi.getLocations();
  }),

  // Live sync/cache diagnostics for the admin "Sync & Data".
  syncStatus: adminProcedure.query(async () => {
    // Return basic health since we don't have a poller anymore
    const health = await supabaseApi.ping();
    return {
      lastStatus: health.success ? "idle" : "error",
      lastError: health.success ? null : health.error,
      cachedRecordCount: 0, // Not applicable with Supabase
      isPolling: false,
      pollRunning: false,
      pollIntervalMs: 0,
      running: false, // For compatibility with Admin.tsx
      currentIntervalMs: 0, // For compatibility with Admin.tsx
    };
  }),

  // Control the server-side background poller from the admin panel.
  // Kept for compatibility but now does nothing since we use Supabase directly.
  setAutoSync: adminProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        intervalMs: z.number().min(1000).max(300_000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      // These operations are kept for API compatibility but are no-ops
      // since we query Supabase directly without caching
      return {
        isPolling: false,
        pollRunning: false,
        pollIntervalMs: input.intervalMs ?? 0,
      };
    }),

  // Data-quality summary computed from the Supabase database.
  dataHealth: adminProcedure.query(async () => {
    // TODO: Implement data health checks with Supabase
    const stats = await supabaseApi.getStatistics();
    if (!stats.success) {
      return {
        success: false,
        data: {
          issues: [{ type: "error", message: stats.error || "Failed to load statistics" }],
        },
      };
    }
    
    const data = stats.data!;
    const issues: { type: string; message: string }[] = [];
    
    // Check for missing critical fields
    if (data.totalProfiles === 0) {
      issues.push({ type: "warning", message: "No profiles found in database" });
    }
    
    return {
      success: true,
      data: {
        issues,
      },
    };
  }),

  // Test both connectivity paths (now both are Supabase)
  syncDiagnostics: adminProcedure.mutation(async () => {
    const readStart = Date.now();
    const readResult = await supabaseApi.getProfiles();
    const readLatencyMs = Date.now() - readStart;
    
    const writeResult = await supabaseApi.ping();

    const profiles = readResult.data || [];
    return {
      read: {
        ok: profiles.length > 0,
        latencyMs: readLatencyMs,
        error: profiles.length === 0 ? "No profiles found" : undefined,
        count: profiles.length,
      },
      write: writeResult,
    };
  }),

  // Export the current directory as an Excel (.xlsx) file.
  exportCsv: adminProcedure.query(async () => {
    return supabaseApi.buildDirectoryCsv();
  }),

  // Get single profile by HRS ID (full record incl. contact details)
  profile: readVolunteer
    .input(z.object({ hrsId: z.string() }))
    .query(async ({ input }) => {
      const allResponse = await supabaseApi.getProfiles();
      const all = allResponse.data || [];
      const found = all.find(
        (p: any) => (p["HRS ID"] ?? "").trim() === input.hrsId.trim()
      );
      if (!found) {
        return { success: false, error: "Profile not found" };
      }
      return { success: true, data: found };
    }),

  // Get public profiles (public - filtered by backend)
  publicProfiles: read.query(async () => {
    return supabaseApi.getPublicProfiles();
  }),

  // Get all records with full personal contact details — available only to
  // authenticated volunteers/admins (never to the public homepage). Unlike
  // `profiles` (admin panel), this includes *pending* records too, because a
  // volunteer helping people should be able to reach donors still awaiting
  // verification.
  volunteerProfiles: readVolunteer.query(async () => {
    const records = await supabaseApi.getAdminRecords();
    if (!records.success) {
      return { success: false, error: "Profiles not loaded yet" };
    }
    return {
      success: true,
      data: {
        records: records.data?.records ?? [],
        count: records.data?.records.length ?? 0,
      },
    };
  }),

  // Single record with full contact details (volunteer/admin only).
  volunteerProfile: readVolunteer
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const records = await supabaseApi.getAdminRecords();
      if (!records.success) {
        return { success: false, error: "Profiles not loaded yet" };
      }
      const found = records.data?.records.find(
        r => r.id === input.id.trim()
      );
      if (!found) {
        return { success: false, error: "Profile not found" };
      }
      return { success: true, data: found };
    }),

  // Get statistics
  statistics: read.query(async () => {
    return supabaseApi.getStatistics();
  }),

  // Send verification email to a donor
  sendVerificationEmail: volunteerProcedure
    .input(
      z.object({
        hrsId: z.string(),
        bloodGroup: z.string().optional(),
        donorConsent: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Resolve the donor from Supabase (not the legacy Sheets cache) so the
      // email reflects the same record the rest of the app shows.
      const response = await supabaseApi.sendVerificationEmail(input.hrsId, {
        bloodGroup: input.bloodGroup,
        donorConsent: input.donorConsent,
      });
      await logProfileAudit(input.hrsId, {
        action: "profile.send_email",
        actionLabel: "Sent verification email",
        actor: auditActor(ctx.user),
        success: response.success,
        details: input.bloodGroup
          ? {
              bloodGroup: input.bloodGroup,
              donorConsent: input.donorConsent,
              channel: response.data?.via,
            }
          : { channel: response.data?.via },
        ipAddress: ctx.req.ip,
      });
      return response;
    }),

  // Public donor self-registration — the shared camp/registration form.
  // Creates the profile as PENDING: an admin reviews and verifies it in the
  // dashboard before it reaches the public directory.
  registerDonor: publicProcedure
    .input(
      z.object({
        fullName: z.string().min(2).max(120),
        dateOfBirth: z.string().optional(),
        gender: z.string().optional(),
        phoneNumber: z.string().regex(/^\+?[0-9]{10,15}$/, "Enter a valid mobile number"),
        email: z
          .string()
          .email("Enter a valid email")
          .optional()
          .or(z.literal("")),
        city: z.string().max(80).optional(),
        area: z.string().max(80).optional(),
        bloodGroup: z.string().regex(/^(A|B|AB|O)[+-]$/, "Select a valid blood group"),
        donorConsent: z.enum(["YES", "NO"]),
        dataStorageConsent: z.literal("YES"),
      })
    )
    .mutation(async ({ input }) => {
      // Auto-publish rule: a submission that consents to donate and provides a
      // blood group is verified instantly and appears on the public home page
      // (the form requires storage consent regardless). Only consent-NO
      // submissions fall into the pending review queue.
      const autoVerify = input.donorConsent === "YES";
      const result = await supabaseApi.addPerson({
        fullName: input.fullName.trim(),
        bloodGroup: input.bloodGroup,
        donorConsent: input.donorConsent,
        dateOfBirth: input.dateOfBirth,
        gender: input.gender,
        phoneNumber: input.phoneNumber,
        email: input.email,
        city: input.city,
        area: input.area,
        dataStorageConsent: input.dataStorageConsent,
        verified: autoVerify,
      });

      if (result.success) {
        await logAudit({
          action: "profile.add_person",
          actionLabel: "Registered via public form",
          actor: null,
          targetType: "profile",
          targetId: result.data?.hrs_id ?? "",
          details: {
            fullName: input.fullName.trim(),
            bloodGroup: input.bloodGroup,
            donorConsent: input.donorConsent,
            source: "public_form",
            verificationStatus: autoVerify ? "VERIFIED" : "PENDING",
            autoVerified: autoVerify,
          },
        });
      }

      return result.success
        ? { success: true as const, hrsId: result.data?.hrs_id ?? "" }
        : { success: false as const, error: result.error ?? "Registration failed" };
    }),

  // Add a brand-new person and verify them immediately (admin "Add Person"
  // modal). The profile is created VERIFIED with the next HRS ID.
  // Verify a pending profile (admin only): flips Verification Status to
  // VERIFIED, optionally persisting the blood group and donor consent
  // collected by the verify dialog.
  verifyProfile: adminProcedure
    .input(
      z.object({
        hrsId: z.string(),
        bloodGroup: z.string(),
        donorConsent: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await supabaseApi.verifyProfile(input.hrsId, {
        bloodGroup: input.bloodGroup,
        donorConsent: input.donorConsent,
      });
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

  // Pending Google Form sync status (diagnostic, admin only).
  pendingFormStatus: adminProcedure.query(async () => {
    return getPendingFormStatus();
  }),

  // Manually trigger a pending-form → Profiles sync cycle (admin only).
  syncPendingForms: adminProcedure.mutation(async ({ ctx }) => {
    const result = await runPendingFormSync();
    if (result.imported > 0 || result.errors.length > 0) {
      await logAudit({
        action: "profile.add_person",
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
    }
    return result;
  }),

  addPerson: adminProcedure
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
      // TODO: Implement addPerson with Supabase
      // For now, we'll need to generate an HRS ID and insert the profile
      const result = await supabaseApi.addPerson(input);
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
  recordDonation: adminProcedure
    .input(
      z.object({
        hrsId: z.string(),
        donationTime: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await supabaseApi.recordDonation(
        input.hrsId
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

  // Delete profiles by HRS IDs (admin only)
  deleteProfiles: adminProcedure
    .input(
      z.object({
        hrsIds: z.array(z.string()),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await supabaseApi.deleteProfiles(input.hrsIds);
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
  updateProfile: adminProcedure
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

      const result = await supabaseApi.updateProfile(input.hrsId, {
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