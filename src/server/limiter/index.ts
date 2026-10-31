import "server-only";
import { env } from "@/env";
import {
  createWebLimit,
  type CodeAction,
  type LimitAction,
  type LimitVerdict,
  type WebLimit,
} from "./core";

// The web app's rate limiter (#207, ADR 0020): features call `limit(action, subject)` with the
// subject from `requestSubject()` and render their own throttled state. Created lazily from
// `env.REDIS_URL` on the first call; fails open (see `core.ts`).

export { LIMITS, type CodeAction, type LimitAction, type LimitVerdict } from "./core";
export { isGuestSubject, requestSubject } from "./subject";

let current: { url: string | undefined; limit: WebLimit & { close(): void } } | undefined;

function webLimit(): WebLimit {
  // Keyed on the URL so a test that swaps the mocked env gets a fresh client.
  if (current?.url !== env.REDIS_URL || !current) {
    current?.limit.close();
    current = {
      url: env.REDIS_URL,
      limit: createWebLimit({ url: env.REDIS_URL, nodeEnv: env.NODE_ENV }),
    };
  }
  return current.limit;
}

export function limit(action: LimitAction, subject: string): Promise<LimitVerdict> {
  return webLimit()(action, subject);
}

/**
 * One attempt at a room code (`null`: unparsable) for a code action (#699): counted per
 * (subject, code), plus the subject's distinct-code budget for a code new to it. See `core.ts`.
 */
export function limitCode(
  action: CodeAction,
  subject: string,
  code: string | null,
): Promise<LimitVerdict> {
  return webLimit().code(action, subject, code);
}
