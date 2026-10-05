import { createHmac, timingSafeEqual } from "node:crypto";

// Guest identity cookie (ADR 0009). Format fixed by #32:
// `<userId>.<base64url(HMAC-SHA256(userId, AUTH_SECRET))>`. Pure: no IO, the
// secret is injected. Any value that fails verification counts as no cookie.
export const GUEST_COOKIE = "fc_guest";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function mac(userId: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(userId).digest();
}

export function signGuestCookie(userId: string, secret: string): string {
  return `${userId}.${mac(userId, secret).toString("base64url")}`;
}

// Returns the signed user id, or null for anything unsigned, tampered or malformed.
export function verifyGuestCookie(value: string | undefined, secret: string): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (!BASE64URL.test(signature)) return null;
  const given = Buffer.from(signature, "base64url");
  const expected = mac(userId, secret);
  // Re-encoding rejects non-canonical spellings of the same bytes.
  if (given.length !== expected.length || given.toString("base64url") !== signature) return null;
  return timingSafeEqual(given, expected) ? userId : null;
}

export function guestCookieOptions(nodeEnv: "development" | "test" | "production") {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    secure: nodeEnv === "production",
  };
}
