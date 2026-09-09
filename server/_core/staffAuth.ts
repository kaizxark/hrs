import {
  getSessionCookieOptions,
} from "./cookies";
import { ONE_YEAR_MS } from "@shared/const";
import { jwtVerify, SignJWT } from "jose";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { ENV } from "./env";
import {
  getStaffById,
} from "./staffStore";
import type { Staff } from "../../drizzle/schema";

/**
 * Staff session cookie name — kept separate from the OAuth user session
 * (COOKIE_NAME = "app_session_id") so volunteer/admin staff login via
 * username/password is independent of Manus OAuth.
 */
export const STAFF_COOKIE_NAME = "hrs_staff_session_v2";
export const STAFF_SESSION_TTL_MS = ONE_YEAR_MS;

export type StaffSessionPayload = {
  staffId: number;
  username: string;
  displayName: string;
  role: "volunteer" | "admin";
  showPasswordHash?: never;
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

function getSessionSecret(): Uint8Array {
  return new TextEncoder().encode(ENV.cookieSecret);
}

export async function createStaffSessionToken(
  staff: Staff,
  options: { expiresInMs?: number } = {}
): Promise<string> {
  const issuedAt = Date.now();
  const expiresInMs = options.expiresInMs ?? STAFF_SESSION_TTL_MS;
  const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);

  return new SignJWT({
    staffId: staff.id,
    username: staff.username,
    displayName: staff.displayName,
    role: staff.role,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(expirationSeconds)
    .sign(getSessionSecret());
}

export async function verifyStaffSessionToken(
  token: string | undefined | null
): Promise<StaffSessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSessionSecret(), {
      algorithms: ["HS256"],
    });
    const { staffId, username, displayName, role } = payload as Record<string, unknown>;
    if (
      typeof staffId !== "number" ||
      !isNonEmptyString(username) ||
      (role !== "volunteer" && role !== "admin")
    ) {
      return null;
    }
    return { staffId, username, displayName: typeof displayName === "string" ? displayName : username, role };
  } catch {
    return null;
  }
}

/**
 * Resolve the current staff member from the request (cookie or Bearer
 * header fallback), verifying the account still exists and is active.
 * Returns null when there is no valid staff action.
 */
export async function getStaffFromRequest(
  req: Request
): Promise<Staff | null> {
  let token: string | undefined;

  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const parsed = parseCookieHeader(cookieHeader);
    token = parsed[STAFF_COOKIE_NAME];
  }

  if (!token) {
    const authHeader = req.headers.authorization;
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    }
  }

  const payload = await verifyStaffSessionToken(token);
  if (!payload) return null;

  const staff = await getStaffById(payload.staffId);
  if (staff && staff.active) return staff;

  // Virtual staff (Google Sheets Admin/Volunteer tabs) are issued tokens with
  // staffId 0 and are NOT rows in the DB — reconstruct them from the token so
  // `staff.me` still resolves after a sheet-based login.
  if (payload.staffId === 0) {
    return {
      id: 0,
      username: payload.username,
      displayName: payload.displayName || payload.username,
      passwordHash: "",
      role: payload.role,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Staff;
  }

  return null;
}

export function getStaffSessionCookieOptions(req: Request) {
  return getSessionCookieOptions(req);
}
