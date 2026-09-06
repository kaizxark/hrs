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

  // Get all profiles (admin only)
  profiles: publicProcedure.query(async () => {
    const result = await gasApi.getProfiles();
    return result;
  }),

  // Get single profile by HRS ID (admin only)
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

  // Verify profile (admin only)
  verifyProfile: adminProcedure
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

  // Record donation (admin only)
  recordDonation: adminProcedure
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
});
