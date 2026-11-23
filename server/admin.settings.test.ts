import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { buildAdminOtpEmailHtml } from "./_core/emailService";
import type { TrpcContext } from "./_core/context";

function createNonAdminContext(): TrpcContext {
  return {
    user: {
      id: 2,
      openId: "regular-volunteer",
      email: "volunteer@example.com",
      name: "Regular Volunteer",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    staff: {
      id: 2,
      username: "volunteer_test",
      displayName: "Volunteer Test",
      passwordHash: "hash",
      role: "volunteer",
      active: true,
      mobile: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
      ip: "127.0.0.1",
    } as TrpcContext["req"],
    res: {
      cookie: () => {},
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("Admin Settings & OTP Password Reset", () => {
  it("buildAdminOtpEmailHtml renders the 6-digit code and security disclaimer", () => {
    const otp = "849201";
    const html = buildAdminOtpEmailHtml(otp);
    expect(html).toContain("849201");
    expect(html).toContain("HRS Blood Donor Portal");
    expect(html).toContain("Password Reset Code");
    expect(html).toContain("10 minutes");
    expect(html).toContain("kaizxark@gmail.com");
  });

  it("blocks non-admin users from requesting admin password OTP", async () => {
    const ctx = createNonAdminContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.staff.requestAdminPasswordOtp()).rejects.toThrow(
      "You do not have required permission"
    );
  });

  it("rejects invalid length OTP codes in verifyAndUpdateAdminPassword", async () => {
    const ctx = createNonAdminContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.staff.verifyAndUpdateAdminPassword({
        otp: "123", // too short
        newPassword: "ValidPassword123",
      })
    ).rejects.toThrow();
  });
});
