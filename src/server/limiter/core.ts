import "server-only";
import { Redis } from "ioredis";
import { createLimiter, type LimitRule } from "@fifth-copy/limiter";

// The web app's side of the shared limiter (ADR 0020): one table of actions, one lazy Redis client,
// fail open. Pure of `env`: `index.ts` wires it to `env.REDIS_URL`; tests build their own.

export type LimitAction = "join-by-code" | "mint-race-token" | "sign-in" | "recovery" | "invite";

/**
 * One rule per web action, counted per subject (`requestSubject()`: guest or IP). `sign-in`,
 * `recovery` and `invite` are defined for #90, #120 and #121, which wire them.
 */
export const LIMITS = {
  "join-by-code": { max: 20, windowMs: 60_000 },
  "mint-race-token": { max: 10, windowMs: 60_000 },
  "sign-in": { max: 10, windowMs: 10 * 60_000 },
  recovery: { max: 5, windowMs: 60 * 60_000 },
  invite: { max: 20, windowMs: 60_000 },
} as const satisfies Record<LimitAction, LimitRule>;

/** Prefix of the web app's limiter keys: `web:rl:<action>:<subject>`. */
export const WEB_LIMITER_PREFIX = "web";
/** A limiter call slower than this is treated as Redis being unavailable (fail open). */
export const LIMIT_TIMEOUT_MS = 250;
/** Subjects are bounded before they reach a Redis key. */
const MAX_SUBJECT_LENGTH = 128;

export type LimitVerdict = { ok: boolean; retryAfterMs: number };
export type WebLimit = (action: LimitAction, subject: string) => Promise<LimitVerdict>;
type Warn = (msg: string, fields: Record<string, unknown>) => void;

const ALLOW: LimitVerdict = { ok: true, retryAfterMs: 0 };

export const defaultWarn: Warn = (msg, fields) =>
  console.warn(JSON.stringify({ level: "warn", msg, ...fields }));

/**
 * `url` absent: every call is allowed (one warning in production). Otherwise the Redis client is
 * created on the first call. When Redis fails or answers slower than `timeoutMs`, the call is
 * allowed and one warning is logged per outage (a lobby join must not depend on Redis); the race
 * server, by contrast, fails closed. Logs carry no URL, subject or payload.
 */
export function createWebLimit({
  url,
  nodeEnv,
  warn = defaultWarn,
  timeoutMs = LIMIT_TIMEOUT_MS,
}: {
  url: string | undefined;
  nodeEnv: "development" | "test" | "production";
  warn?: Warn;
  timeoutMs?: number;
}): WebLimit & { close(): void } {
  if (!url) {
    let warned = nodeEnv !== "production";
    const disabled = async () => {
      if (!warned) {
        warned = true;
        warn("rate limiter disabled", { cause: "REDIS_URL not set" });
      }
      return ALLOW;
    };
    return Object.assign(disabled, { close: () => {} });
  }

  let redis: Redis | undefined;
  let limiter: ReturnType<typeof createLimiter> | undefined;
  let down = false;
  const failOpen = (cause: string) => {
    if (!down) {
      down = true;
      warn("rate limiter unavailable, allowing", { cause });
    }
    return ALLOW;
  };
  const client = () => {
    if (!limiter) {
      redis = new Redis(url, {
        maxRetriesPerRequest: 1,
        connectTimeout: 1_000,
        retryStrategy: (attempt) => Math.min(attempt * 500, 5_000),
      });
      // Reconnect errors are reported through `failOpen` by the calls; never with the URL.
      redis.on("error", () => {});
      limiter = createLimiter(redis, { prefix: WEB_LIMITER_PREFIX });
    }
    return limiter;
  };

  const limit = async (action: LimitAction, subject: string): Promise<LimitVerdict> => {
    const key = `${action}:${subject.slice(0, MAX_SUBJECT_LENGTH) || "unknown"}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const call = client().limit(key, LIMITS[action]);
    // A call that loses the race must not surface as an unhandled rejection later.
    call.catch(() => undefined);
    try {
      const verdict = await Promise.race([call, timeout]);
      if (verdict === "timeout") return failOpen("timeout");
      down = false;
      return { ok: verdict.ok, retryAfterMs: verdict.retryAfterMs };
    } catch (err) {
      return failOpen((err as NodeJS.ErrnoException).code ?? "error");
    } finally {
      clearTimeout(timer);
    }
  };
  return Object.assign(limit, { close: () => redis?.disconnect() });
}
