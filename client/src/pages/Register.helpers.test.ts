/**
 * Regression tests for the Register form's date-of-birth helpers.
 *
 * Guards against the "Age 0 years" + "registration failed" bug: the month
 * dropdown once stored month NAMES ("June") while the date math called
 * Number("June") → NaN → "2001-NaN-15" was shipped to the server.
 */
import { describe, expect, it } from "vitest";
import { ISO_DATE_RE, MONTH_OPTIONS } from "./Register";

/** Mirror of exactAge() in Register.tsx (not exported). */
function exactAge(iso: string): number | null {
  if (!ISO_DATE_RE.test(iso)) return null;
  const birth = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) a--;
  return a;
}

describe("MONTH_OPTIONS", () => {
  it("stores 1-based numeric values, not month names", () => {
    expect(MONTH_OPTIONS).toHaveLength(12);
    expect(MONTH_OPTIONS[0]).toEqual({ value: "1", label: "January" });
    expect(MONTH_OPTIONS[5]).toEqual({ value: "6", label: "June" });
    expect(MONTH_OPTIONS[11]).toEqual({ value: "12", label: "December" });
    for (const opt of MONTH_OPTIONS) {
      // The critical invariant: every value must be numeric.
      expect(Number.isNaN(Number(opt.value))).toBe(false);
      expect(Number(opt.value)).toBeGreaterThanOrEqual(1);
      expect(Number(opt.value)).toBeLessThanOrEqual(12);
    }
  });
});

describe("ISO_DATE_RE", () => {
  it("accepts well-formed ISO dates", () => {
    expect(ISO_DATE_RE.test("2001-06-15")).toBe(true);
    expect(ISO_DATE_RE.test("1999-12-31")).toBe(true);
  });

  it("rejects NaN-poisoned or malformed dates", () => {
    expect(ISO_DATE_RE.test("2001-NaN-15")).toBe(false);
    expect(ISO_DATE_RE.test("NaN-NaN-NaN")).toBe(false);
    expect(ISO_DATE_RE.test("")).toBe(false);
    expect(ISO_DATE_RE.test("15/06/2001")).toBe(false);
  });
});

describe("exactAge", () => {
  it("computes completed years for a valid past date", () => {
    const now = new Date();
    const beforeBirthday = new Date(
      now.getFullYear() - 25,
      now.getMonth() + 1,
      10
    );
    const age = exactAge(
      `${beforeBirthday.getFullYear()}-${String(beforeBirthday.getMonth() + 1).padStart(2, "0")}-${String(beforeBirthday.getDate()).padStart(2, "0")}`
    );
    expect(age).toBe(24); // birthday not reached yet this year
  });

  it("handles someone born today (age 0 is legitimate here)", () => {
    const now = new Date();
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(exactAge(iso)).toBe(0);
  });

  it("returns null (not 0) for malformed input so the UI hides the badge", () => {
    expect(exactAge("2001-NaN-15")).toBeNull();
    expect(exactAge("")).toBeNull();
    expect(exactAge("garbage")).toBeNull();
  });
});
