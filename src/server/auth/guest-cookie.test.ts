import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GUEST_COOKIE,
  guestCookieOptions,
  signGuestCookie,
  verifyGuestCookie,
} from "./guest-cookie";

const secret = "s".repeat(32);
const other = "o".repeat(32);
const id = "cmabc123def456";

describe("guest cookie", () => {
  it("is named fc_guest (ADR 0009)", () => {
    expect(GUEST_COOKIE).toBe("fc_guest");
  });

  it("signs as <userId>.<base64url(HMAC-SHA256(userId, secret))>", () => {
    const mac = createHmac("sha256", secret).update(id).digest("base64url");
    expect(signGuestCookie(id, secret)).toBe(`${id}.${mac}`);
  });

  it("verifies its own signature and returns the user id", () => {
    expect(verifyGuestCookie(signGuestCookie(id, secret), secret)).toBe(id);
  });

  it("rejects a tampered user id", () => {
    const [, mac] = signGuestCookie(id, secret).split(".");
    expect(verifyGuestCookie(`cmother000000.${mac}`, secret)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const value = signGuestCookie(id, secret);
    const flipped = value.slice(0, -1) + (value.endsWith("A") ? "B" : "A");
    expect(verifyGuestCookie(flipped, secret)).toBeNull();
  });

  it("rejects a value signed with another secret", () => {
    expect(verifyGuestCookie(signGuestCookie(id, other), secret)).toBeNull();
  });

  it.each([
    ["undefined", undefined],
    ["empty", ""],
    ["unsigned id", id],
    ["empty id", `.${createHmac("sha256", secret).update("").digest("base64url")}`],
    ["empty signature", `${id}.`],
    ["truncated signature", signGuestCookie(id, secret).slice(0, -4)],
    ["extended signature", `${signGuestCookie(id, secret)}AAAA`],
    ["non-base64url signature", `${id}.!!!!`],
    ["padded signature", `${signGuestCookie(id, secret)}=`],
  ])("rejects a malformed value (%s)", (_label, value) => {
    expect(verifyGuestCookie(value, secret)).toBeNull();
  });

  it("is HttpOnly, SameSite=Lax, Path=/, one year, Secure only in production", () => {
    const base = { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 };
    expect(guestCookieOptions("production")).toEqual({ ...base, secure: true });
    expect(guestCookieOptions("development")).toEqual({ ...base, secure: false });
    expect(guestCookieOptions("test")).toEqual({ ...base, secure: false });
  });
});
