/**
 * HRS Data Router
 * Server-side routes for HRS data operations
 */
import { z } from "zod";
import { adminProcedure, publicProcedure, router } from "./trpc";
import * as gasApi from "./googleAppsScriptApi";

export const hrsRouter = router({
  // Health check
  health: publicProcedure.query(async () => {
    const result = await gasApi.ping();
    return result;
  }),

  // Get all profiles
  profiles: publicProcedure.query(async () => {
    const result = await gasApi.getProfiles(true);
    return result;
  }),

  // Force-refresh profiles from Google Sheets, bypassing the cache
  syncProfiles: publicProcedure.mutation(async () => {
    const result = await gasApi.syncProfiles();
    return result;
  }),

  // Get single profile by HRS ID
  profile: publicProcedure
    .input(z.object({ hrsId: z.string() }))
    .query(async ({ input }) => {
      const result = await gasApi.getProfileById(input.hrsId);
      return result;
    }),

  // Get public profiles (public - filtered by backend)
  publicProfiles: publicProcedure.query(async () => {
    const result = await gasApi.getPublicProfiles();
    return result;
  }),

  // Get statistics
  statistics: publicProcedure.query(async () => {
    const result = await gasApi.getStatistics();
    return result;
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
      if (result.success) {
        gasApi.invalidateProfilesCache();
      }
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
      if (result.success) {
        gasApi.invalidateProfilesCache();
      }
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
      if (result.success) {
        // Invalidate cache so the next read fetches fresh data
        gasApi.invalidateProfilesCache();
      }
      return result;
    }),
});
