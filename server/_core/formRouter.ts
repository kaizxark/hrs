/**
 * Multi-form feature router.
 *
 * Admin endpoints (adminProcedure): list every form, create a custom form
 * (per camp/generation) with its own title/description, update it, and set
 * it live or closed. Many forms can be live at once — each has its own
 * link and its own submissions counter.
 *
 * Public endpoints: resolve a form token (for /form/<token>, returning the
 * custom config) and submit against an ACTIVE form of the exact type —
 * closed/unknown tokens are rejected server-side.
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

const FORM_CONFIG = z.object({
  title: z.string().max(120).optional().nullable(),
  description: z.string().max(400).optional().nullable(),
});

/** Trim the wire format from formsApi into the tRPC response shape. */
function toWire(form: formsApi.FormRow) {
  return {
    id: form.id,
    type: form.type,
    active: form.active,
    title: form.title,
    description: form.description,
    createdBy: form.createdBy,
    createdAt: form.createdAt,
    terminatedAt: form.terminatedAt,
    submissions: form.submissions,
  };
}

export const formRouter = router({
  /** Admin: every form (live + closed), newest first. */
  list: adminProcedure.query(async () => {
    try {
      const forms = await formsApi.listForms();
      return { success: true as const, forms: forms.map(toWire) };
    } catch (error) {
      console.error("[formRouter] list failed:", error);
      return { success: false as const, forms: [] as ReturnType<typeof toWire>[] };
    }
  }),

  /** Admin: create a new custom form (many can be live at once). */
  create: adminProcedure
    .input(
      z.object({
        type: z.enum(["pending", "registration"]),
        title: z.string().max(120).optional(),
        description: z.string().max(400).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const form = await formsApi.createForm(
        {
          type: input.type,
          title: input.title ?? null,
          description: input.description ?? null,
        },
        ctx.user?.name ?? null
      );
      await logAudit({
        action: "form.activate",
        actionLabel: `Created ${input.type} form`,
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
        details: { type: input.type, formId: form.id, title: form.title },
        ipAddress: ctx.req.ip,
      });
      return { success: true as const, form: toWire(form) };
    }),

  /** Admin: update a form's custom title/description. */
  update: adminProcedure
    .input(FORM_CONFIG.extend({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const form = await formsApi.updateForm(input.id, {
        title: input.title,
        description: input.description,
      });
      if (!form) {
        return { success: false as const, error: "Form not found." };
      }
      await logAudit({
        action: "form.activate",
        actionLabel: "Updated form details",
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
        details: { formId: form.id, title: form.title },
        ipAddress: ctx.req.ip,
      });
      return { success: true as const, form: toWire(form) };
    }),

  /** Admin: set a single form live or closed. */
  setActive: adminProcedure
    .input(z.object({ id: z.string().uuid(), active: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const form = await formsApi.setFormActive(input.id, input.active);
      if (!form) {
        return { success: false as const, error: "Form not found." };
      }
      await logAudit({
        action: "form.activate",
        actionLabel: input.active ? "Form set live" : "Form closed",
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
        details: { type: form.type, formId: form.id, active: input.active },
        ipAddress: ctx.req.ip,
      });
      return { success: true as const, form: toWire(form) };
    }),

  /** Admin: permanently delete a form row (submissions history included). */
  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const deleted = await formsApi.deleteForm(input.id);
      if (deleted) {
        await logAudit({
          action: "form.activate",
          actionLabel: "Deleted form",
          actor: ctx.user
            ? {
                id: ctx.user.id,
                openId: ctx.user.openId,
                name: ctx.user.name,
                role: ctx.user.role,
              }
            : null,
          targetType: "system",
          targetId: input.id,
          details: { formId: input.id },
          ipAddress: ctx.req.ip,
        });
      }
      return { success: true as const, deleted };
    }),

  /** Admin: legacy status — newest live form (used by older clients). */
  status: adminProcedure.query(async () => {
    try {
      const form = await formsApi.getActiveForm();
      return { success: true as const, form: form ? toWire(form) : null };
    } catch (error) {
      console.error("[formRouter] status failed:", error);
      return { success: false as const, form: null };
    }
  }),

  /** Public: resolve a token for /form/<token> — includes custom config. */
  resolve: publicProcedure
    .input(z.object({ token: z.string().uuid() }))
    .query(async ({ input }) => {
      try {
        const form = await formsApi.resolveAnyActiveForm(input.token);
        if (form) {
          return {
            active: true as const,
            type: form.type,
            title: form.title,
            description: form.description,
          };
        }
        return {
          active: false as const,
          type: null,
          title: null,
          description: null,
        };
      } catch {
        return {
          active: false as const,
          type: null,
          title: null,
          description: null,
        };
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

  /** Public: submit the REGISTRATION form (full data). */
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
      // Auto-publish rule (same as /register): donor-consent YES → verified
      // instantly and publicly visible; consent NO → pending review queue.
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
          verificationStatus: autoVerify ? "VERIFIED" : "PENDING",
          autoVerified: autoVerify,
        },
        });
        return { success: true as const, hrsId: result.data?.hrs_id ?? "" };
      }
      return { success: false as const, error: result.error ?? "Submission failed" };
    }),
});
