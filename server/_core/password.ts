import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

/** Length of the random salt, in bytes. */
const SALT_BYTES = 16;
/** scrypt key length. */
const KEYLEN = 64;

/**
 * Derive a password hash using scrypt.
 * Format: "scrypt:<salt(hex)>:<hash(hex)>" — self-describing for future
 * algorithm upgrades.
 */
export async function hashPassword(
  password: string
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derivedKey = (await scrypt(password, salt, KEYLEN)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

/**
 * Verify a password against a stored hash. Returns false for any malformed
 * hash rather than throwing, so callers can treat it as a failed login.
 */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  try {
    const parts = stored.split(":");
    if (parts.length !== 3 || parts[0] !== "scrypt") return false;

    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const derivedKey = (await scrypt(password, salt, expected.length)) as Buffer;

    return expected.length === derivedKey.length && timingSafeEqual(derivedKey, expected);
  } catch {
    return false;
  }
}
