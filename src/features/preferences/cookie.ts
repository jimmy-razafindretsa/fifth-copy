import "server-only";
import { env } from "@/env";
import { cookieFlags } from "@/server/auth/cookies";

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Preference cookies are remembered for a year, first-party only, never readable by scripts. */
export function preferenceCookieOptions() {
  return { ...cookieFlags(env.NODE_ENV), maxAge: ONE_YEAR };
}
