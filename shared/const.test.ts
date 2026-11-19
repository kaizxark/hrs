import { describe, expect, it } from "vitest";
import { decodeOAuthState, encodeOAuthState } from "./const";

describe("OAuth State serialization", () => {
  it("encodes and decodes OAuth state with redirectUri and nonce", () => {
    const original = { redirectUri: "https://example.com/callback", nonce: "xyz123" };
    const encoded = encodeOAuthState(original);
    expect(typeof encoded).toBe("string");

    const decoded = decodeOAuthState(encoded);
    expect(decoded).toEqual(original);
  });

  it("encodes and decodes state without nonce", () => {
    const original = { redirectUri: "/admin" };
    const encoded = encodeOAuthState(original);
    const decoded = decodeOAuthState(encoded);
    expect(decoded.redirectUri).toBe("/admin");
    expect(decoded.nonce).toBeUndefined();
  });

  it("handles legacy plain string base64 gracefully", () => {
    const legacyRedirect = "/overview";
    const legacyState = btoa(legacyRedirect);
    const decoded = decodeOAuthState(legacyState);
    expect(decoded.redirectUri).toBe(legacyRedirect);
  });

  it("handles malformed base64 without throwing", () => {
    const decoded = decodeOAuthState("not-valid-base64!!!");
    expect(decoded).toEqual({ redirectUri: "" });
  });

  it("handles empty string gracefully", () => {
    const decoded = decodeOAuthState("");
    expect(decoded.redirectUri).toBe("");
  });
});
