import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  cookieFlags,
  SECURE_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  sessionCookieName,
  secureCookiesFor,
} from "./cookies";
import { guestCookieOptions } from "./guest-cookie";
import { SESSION_COOKIES } from "./resolvers";

// #87 C1: the cookie policy (ADR 0009); `locale` and `theme` take it through
// src/features/preferences/cookie.ts. The flags the browser receives: e2e/auth/hardening.spec.ts.
const env = vi.hoisted(() => ({ NODE_ENV: "production" as string, AUTH_SECRET: "" }));
vi.mock("@/env", () => {
  env.AUTH_SECRET = randomBytes(32).toString("hex");
  return { env };
});
vi.mock("@/server/db", () => ({ db: {} }));
vi.mock("server-only", () => ({}));

const BASE = { httpOnly: true, sameSite: "lax", path: "/" };

describe("cookie policy (#87 C1)", () => {
  it("every cookie is HttpOnly, SameSite=Lax, Path=/ and Secure only in production", () => {
    expect(cookieFlags("production")).toEqual({ ...BASE, secure: true });
    expect(cookieFlags("development")).toEqual({ ...BASE, secure: false });
    expect(cookieFlags("test")).toEqual({ ...BASE, secure: false });
  });

  it("fc_guest carries the policy for a year", () => {
    for (const nodeEnv of ["production", "development"] as const) {
      expect(guestCookieOptions(nodeEnv)).toEqual({
        ...cookieFlags(nodeEnv),
        maxAge: 60 * 60 * 24 * 365,
      });
    }
  });

  it("the session cookie is __Secure- prefixed and Secure in production only", () => {
    expect(secureCookiesFor("production")).toBe(true);
    expect(secureCookiesFor("development")).toBe(false);
    expect(sessionCookieName("production")).toBe("__Secure-authjs.session-token");
    expect(sessionCookieName("development")).toBe("authjs.session-token");
    // the resolver and proxy look for both names
    expect([...SESSION_COOKIES]).toEqual([SESSION_COOKIE_NAME, SECURE_SESSION_COOKIE_NAME]);
  });

  it("Auth.js is configured with the production cookie policy", async () => {
    vi.resetModules();
    env.NODE_ENV = "production";
    const { authConfig } = await import("./auth");
    expect(authConfig.useSecureCookies).toBe(true);
    // no override of the session cookie's options: Auth.js's defaults are HttpOnly, Lax, Path=/
    expect((authConfig as { cookies?: unknown }).cookies).toBeUndefined();
  });
});
