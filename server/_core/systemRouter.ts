import { z } from "zod";
import { logAudit } from "./auditLogger";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const delivered = await notifyOwner(input);
      await logAudit({
        action: "system.notify_owner",
        actionLabel: `Notified owner: ${input.title}`,
        actor: ctx.user
          ? {
              id: ctx.user.id,
              openId: ctx.user.openId,
              name: ctx.user.name,
              role: ctx.user.role,
            }
          : null,
        targetType: "system",
        success: delivered,
        details: { title: input.title },
        ipAddress: ctx.req.ip,
      });
      return {
        success: delivered,
      } as const;
    }),
});
