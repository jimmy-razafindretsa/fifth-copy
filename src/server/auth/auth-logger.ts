import "server-only";
import type { NextAuthConfig } from "next-auth";
import type { Logger } from "@/server/logger";

/**
 * Failures every anonymous request can cause (wrong password, missing or stale CSRF token): one info
 * line with the error type and code only, so they cannot flood the logs with stacks or carry input.
 */
const EXPECTED = new Set(["CredentialsSignin", "MissingCSRF"]);
const MAX_MESSAGE = 300;
const MAX_STACK = 2000;

/** Auth.js errors carry their class's `type` (e.g. "CredentialsSignin"); other errors their name. */
function errorType(error: Error): string {
  return "type" in error && typeof error.type === "string" ? error.type : error.name;
}

/** The inner error Auth.js wraps in `cause.err` (e.g. a CallbackRouteError around a DB failure). */
function causeOf(error: Error): Error | undefined {
  const cause = error.cause;
  if (cause && typeof cause === "object" && "err" in cause && cause.err instanceof Error) {
    return cause.err;
  }
  return cause instanceof Error ? cause : undefined;
}

/**
 * Routes Auth.js's error, warn and debug through the app logger (ARCHITECTURE 10) instead of its
 * default console output. Never logs the `details` or `metadata` Auth.js attaches: they can hold the
 * submitted form (username, password).
 */
export function createAuthLogger(log: Logger): Required<NonNullable<NextAuthConfig["logger"]>> {
  return {
    error(error) {
      const type = errorType(error);
      if (EXPECTED.has(type)) {
        const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
        log.info("auth.rejected", { type, code });
        return;
      }
      const cause = causeOf(error);
      log.error("auth.error", {
        type,
        message: error.message.slice(0, MAX_MESSAGE),
        cause: cause ? errorType(cause) : undefined,
        stack: (cause ?? error).stack?.slice(0, MAX_STACK),
      });
    },
    warn(code) {
      log.warn("auth.warn", { code });
    },
    // Auth.js calls this even with `debug` off, and its metadata can be the request body: message only.
    debug(message) {
      log.debug("auth.debug", { message: message.slice(0, MAX_MESSAGE) });
    },
  };
}
