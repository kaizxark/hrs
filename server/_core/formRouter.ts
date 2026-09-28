/**
 * Form-activation feature router.
 *
 * Admin endpoints (adminProcedure): start a form of a chosen type, terminate
 * the active one, read the current status. Public endpoints: resolve a form
 * token (for /form/<token>) and submit against an ACTIVE form of the exact
 * type — terminated/unknown tokens are rejected server-side.
 */
import { z } from "zod";
import { publicProcedure, adminProcedure, router } from "./trpc";
import * as formsApi from "./formsApi";
import * as supabaseApi from "./supabaseApi";
import { logAudit, logProfileAudit } from "./auditLogger";

const PENDING_SUBMISSION = z.object({
  token: z.string().uuid(),
  fullName: z.string().min(2).max(120),
  dateOfBirth: z.string().optional(),
  gender: z.string().optional(),
  phoneNumber: z.string().regex(/^\+?[0-9]{10,15}$/, "Enter a valid mobile number"),
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
  city: z.string().max(80).optional(),
  area: z.string().max(80).optional(),
  dataStorageConsent: z.literal("YES"),
});

const REGISTRATION_SUBMISSION = PENDING_SUBMISSION.extend({
  bloodGroup: z.string().regex(/^(A|B|AB|O)[+-]$/, "Select a valid blood group"),
  donorConsent: z.enum(["YES", "NO"]),
});

export const formRouter = router({
  /** Admin: currently active form (or null). */
  status: adminProcedure.query(async () => {
    try {
      return { success: true as const, form: await formsApi.getActiveForm() };
    } catch (error) {
      console.error("[formRouter] status failed:", error);
      return { success: false as const, form: null };
    }
  }),

  /** Admin: start a form of the given type (terminates any active form). */
  start: adminProcedure
    .input(z.object({ type: z.enum(["pending", "registration"]) }))
    .mutation(async ({ input, ctx }) => {
      const form = await formsApi.activateForm(
        input.type,
        ctx.user?.name ?? null
      );
      await logAudit({
        action: "form.activate",
        actionLabel: `Activated ${input.type} form`,
        actor: ctx.user
          ? {
              id: ctx.user.id,
              openId: ctx.user.openId,
              name: ctx.user.name,
              role: ctx.user.role,
            }
          : null,
        targetType: "system",
        targetId: form.id,
        details: { type: input.type, formId: form.id },
        ipAddress: ctx.req.ip,
      });
      return { success: true as const, form };
    }),

  /** Admin: terminate the active form. */
  terminate: adminProcedure.mutation(async ({ ctx }) => {
    const form = await formsApi.terminateActiveForm();
    if (form) {
      await logAudit({
        action: "form.terminate",
        actionLabel: "Terminated active form",
        actor: ctx.user
          ? {
              id: ctx.user.id,
              openId: ctx.user.openId,
              name: ctx.user.name,
              role: ctx.user.role,
            }
          : null,
        targetType: "system",
        targetId: form.id,
        details: { type: form.type, formId: form.id },
        ipAddress: ctx.req.ip,
      });
    }
    return { success: true as const, form };
  }),

  /** Public: resolve a token for /form/<token> rendering. */
  resolve: publicProcedure
    .input(z.object({ token: z.string().uuid() }))
    .query(async ({ input }) => {
      try {
        const active = await formsApi.getActiveForm();
        if (active && active.id === input.token) {
          return { active: true as const, type: active.type };
        }
        return { active: false as const, type: null };
      } catch {
        return { active: false as const, type: null };
      }
    }),

  /** Public: submit the PENDING form (personal details + storage consent). */
  submitPending: publicProcedure
    .input(PENDING_SUBMISSION)
    .mutation(async ({ input }) => {
      const form = await formsApi.resolveActiveForm(input.token, "pending");
      if (!form) {
        return {
          success: false as const,
          error: "This form is no longer active. Please ask HRS staff for the current form link.",
        };
      }
      const result = await supabaseApi.addPerson({
        fullName: input.fullName.trim(),
        bloodGroup: "",
        donorConsent: "YES",
        dateOfBirth: input.dateOfBirth,
        gender: input.gender,
        phoneNumber: input.phoneNumber,
        email: input.email,
        city: input.city,
        area: input.area,
        dataStorageConsent: input.dataStorageConsent,
        verified: false,
      });
      if (result.success) {
        await formsApi.incrementFormSubmissions(form.id);
        await logProfileAudit(result.data?.hrs_id ?? "", {
          action: "profile.add_person",
          actionLabel: "Submitted via pending form link",
          actor: null,
          details: {
            fullName: input.fullName.trim(),
            source: "pending_form",
            formId: form.id,
          },
        });
        return { success: true as const, hrsId: result.data?.hrs_id ?? "" };
      }
      return { success: false as const, error: result.error ?? "Submission failed" };
    }),

  /** Public: submit the REGISTRATION form (full data → VERIFIED). */
  submitRegistration: publicProcedure
    .input(REGISTRATION_SUBMISSION)
    .mutation(async ({ input }) => {
      const form = await formsApi.resolveActiveForm(input.token, "registration");
      if (!form) {
        return {
          success: false as const,
          error: "This form is no longer active. Please ask HRS staff for the current form link.",
        };
      }
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
        verified: true,
      });
      if (result.success) {
        await formsApi.incrementFormSubmissions(form.id);
        await logProfileAudit(result.data?.hrs_id ?? "", {
          action: "profile.add_person",
          actionLabel: "Registered via form link",
          actor: null,
          details: {
            fullName: input.fullName.trim(),
            bloodGroup: input.bloodGroup,
            donorConsent: input.donorConsent,
            source: "registration_form",
            formId: form.id,
          },
        });
        return { success: true as const, hrsId: result.data?.hrs_id ?? "" };
      }
      return { success: false as const, error: result.error ?? "Submission failed" };
    }),
});
