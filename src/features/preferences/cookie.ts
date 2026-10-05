import "server-only";
import { env } from "@/env";

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Preference cookies are remembered for a year, first-party only, never readable by scripts. */
export function preferenceCookieOptions() {
  return {
    path: "/",
    maxAge: ONE_YEAR,
    sameSite: "lax" as const,
    httpOnly: true,
    secure: env.NODE_ENV === "production",
  };
}
