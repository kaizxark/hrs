/**
 * HRS Data Router
 * Server-side routes for HRS data operations
 *
 * Read path:  Google Sheets CSV (via googleSheetsApi) — fast, auto-refreshed every 15s
 * Write path: Google Apps Script API — called only on mutations (verify, donate, delete)
 */
import { z } from "zod";
import { publicProcedure, router } from "./trpc";
import * as gasApi from "./googleAppsScriptApi";
import {
  forceRefresh,
  getCachedAdminRecords,
  getCachedProfiles,
  getCachedPublicProfiles,
  getCachedStatistics,
} from "./googleSheetsApi";

export const hrsRouter = router({
  // Health check
  health: publicProcedure.query(async () => {
    const result = await gasApi.ping();
    return result;
  }),

  // Get admin records — pre-converted to the shape Admin.tsx uses.
  // Smaller payload, so SSE-triggered refetches land in <200ms.
  profiles: publicProcedure.query(async () => {
    return getCachedAdminRecords();
  }),

  // Force-refresh profiles from Google Sheets now
  syncProfiles: publicProcedure.mutation(async () => {
    await forceRefresh();
    return getCachedAdminRecords();
  }),

  // Get single profile by HRS ID
  profile: publicProcedure
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
  publicProfiles: publicProcedure.query(async () => {
    return getCachedPublicProfiles();
  }),

  // Get statistics
  statistics: publicProcedure.query(async () => {
    return getCachedStatistics();
  }),

  // Send verification email to a donor
  sendVerificationEmail: publicProcedure
    .input(z.object({ hrsId: z.string() }))
    .mutation(async ({ input }) => {
      const result = await gasApi.sendVerificationEmail(input.hrsId);
      return result;
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
    .mutation(async ({ input }) => {
      const result = await gasApi.verifyProfile(
        input.hrsId,
        input.bloodGroup,
        input.donorConsent
      );
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
    .mutation(async ({ input }) => {
      const result = await gasApi.recordDonation(
        input.hrsId,
        input.donationTime
      );
      return result;
    }),

  // Delete profiles by HRS ID (admin only)
  deleteProfiles: publicProcedure
    .input(
      z.object({
        hrsIds: z.array(z.string()),
      })
    )
    .mutation(async ({ input }) => {
      const result = await gasApi.deleteProfiles(input.hrsIds);
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
    .mutation(async ({ input }) => {
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
      return result;
    }),
});
