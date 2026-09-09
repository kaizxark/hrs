import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { Staff, User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { getStaffFromRequest } from "./staffAuth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  /** OAuth-authenticated Manus user (may be null for staff-only logins). */
  user: User | null;
  /** Staff member (admin-created account) authenticated by username+password. */
  staff: Staff | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let staff: Staff | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  try {
    staff = await getStaffFromRequest(opts.req);
  } catch (error) {
    // Staff auth is optional too.
    staff = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    staff,
  };
}
