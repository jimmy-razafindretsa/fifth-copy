import "server-only";
import { env } from "@/env";
import { createWebLimit, type LimitAction, type LimitVerdict, type WebLimit } from "./core";

// The web app's rate limiter (#207, ADR 0020): features call `limit(action, subject)` with the
// subject from `requestSubject()` and render their own throttled state. Created lazily from
// `env.REDIS_URL` on the first call; fails open (see `core.ts`).

export { LIMITS, type LimitAction, type LimitVerdict } from "./core";
export { requestSubject } from "./subject";

let current: { url: string | undefined; limit: WebLimit & { close(): void } } | undefined;

export function limit(action: LimitAction, subject: string): Promise<LimitVerdict> {
  // Keyed on the URL so a test that swaps the mocked env gets a fresh client.
  if (current?.url !== env.REDIS_URL || !current) {
    current?.limit.close();
    current = {
      url: env.REDIS_URL,
      limit: createWebLimit({ url: env.REDIS_URL, nodeEnv: env.NODE_ENV }),
    };
  }
  return current.limit(action, subject);
}
