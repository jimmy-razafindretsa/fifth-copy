import "server-only";
import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import { createLimiter, type LimitRule } from "@fifth-copy/limiter";
import { createRedisClient } from "../redis";

// The web app's side of the shared limiter (ADR 0020): one table of actions, one lazy Redis client,
// fail open. Pure of `env`: `index.ts` wires it to `env.REDIS_URL`; tests build their own.

export type LimitAction =
  | "join-by-code"
  | "mint-race-token"
  | "mint-race-token-new-guest"
  | "lobby-codes"
  | "sign-in"
  | "sign-in-account"
  | "sign-up"
  | "avatar-upload"
  | "recovery"
  | "invite"
  | "invite-redeem"
  | "clerk-outfit"
  | "set-lobby-type"
  | "password-reset-issue"
  | "password-reset-redeem"
  | "password-reset-redeem-account"
  | "recovery-redeem"
  | "recovery-redeem-account";

/** Actions counted per (subject, room code) by `limit.code` (#699). */
export type CodeAction = "join-by-code" | "mint-race-token-new-guest";

/**
 * One rule per web action, counted per subject (`requestSubject()`: guest or IP). The room-code
 * actions (#699, ADR 0020 amendment) let a class behind one address share one code:
 * `join-by-code` and `mint-race-token-new-guest` (a mint without a guest cookie) count per
 * (subject, code), sized above a class of 100; `lobby-codes` counts the distinct codes a subject
 * tries, so guessing stays slow; `mint-race-token` counts per guest. `recovery` is defined for #120,
 * which wires it; `invite` and `invite-redeem` are #808's; the sign-in, sign-up and avatar rows are #87's. `clerk-outfit` (#687) counts the
 * clerk outfit saves of one viewer (`user:<id>`): one per REISSUE UNIFORM, 30 a minute is a click
 * every two seconds for a whole minute, well above a person trying uniforms on. `set-lobby-type`
 * (#114) counts one host's PUBLIC / PRIVATE changes (`user:<id>`), on the same 30 a minute.
 * `password-reset-issue` (#788) counts the reset codes one host issues (`user:<id>`), refusals
 * included, so a host cannot probe accounts quickly: 5 an hour. The `/reset` redeem (#789, owner
 * decision 2026-11-04) has two budgets, both spent before any lookup: `password-reset-redeem`
 * per client (`requestSubject()`, 30 an hour, so a class behind one address can still reset), then
 * `password-reset-redeem-account` per account (`reset:<usernameNormalized>`, 5 an hour), counted only
 * when the client budget admitted the attempt; issuing a new code clears the account budget.
 */
export const LIMITS = {
  "join-by-code": { max: 120, windowMs: 60_000 },
  "mint-race-token": { max: 10, windowMs: 60_000 },
  "mint-race-token-new-guest": { max: 120, windowMs: 60_000 },
  "lobby-codes": { max: 20, windowMs: 60_000 },
  // Account entry points (#87, ADR 0009 "Hardening"): sign-in 30 per 15 min per client IP, then 10 per
  // 15 min per account (`signin:<usernameNormalized>`, counted only when the client was admitted; the
  // action and the Auth.js credentials callback both spend them); sign-up 10 per hour per client IP;
  // avatar upload 5 per minute per viewer (`user:<id>`).
  "sign-in": { max: 30, windowMs: 15 * 60_000 },
  "sign-in-account": { max: 10, windowMs: 15 * 60_000 },
  "sign-up": { max: 10, windowMs: 60 * 60_000 },
  "avatar-upload": { max: 5, windowMs: 60_000 },
  recovery: { max: 5, windowMs: 60 * 60_000 },
  invite: { max: 20, windowMs: 60_000 },
  // Invite links (#808, ADR 0008): `invite` counts the links one host issues (`user:<id>`);
  // `invite-redeem` counts the redeems and peeks of one client (`requestSubject()`).
  "invite-redeem": { max: 20, windowMs: 60_000 },
  "clerk-outfit": { max: 30, windowMs: 60_000 },
  "set-lobby-type": { max: 30, windowMs: 60_000 },
  "password-reset-issue": { max: 5, windowMs: 60 * 60_000 },
  "password-reset-redeem": { max: 30, windowMs: 60 * 60_000 },
  "password-reset-redeem-account": { max: 5, windowMs: 60 * 60_000 },
  // The recovery code redeem (#46) takes the same two budgets, client first, then the account
  // (`recovery:<usernameNormalized>`); a success clears the account budget.
  "recovery-redeem": { max: 30, windowMs: 60 * 60_000 },
  "recovery-redeem-account": { max: 5, windowMs: 60 * 60_000 },
} as const satisfies Record<LimitAction, LimitRule>;

/** Prefix of the web app's limiter keys: `web:rl:<action>:<subjectKey(subject)>`. */
export const WEB_LIMITER_PREFIX = "web";
/** A limiter call slower than this is treated as Redis being unavailable (fail open). */
export const LIMIT_TIMEOUT_MS = 250;
/** A subject kept as is in its Redis key: short and of a safe charset (guest ids, IP literals). */
const SAFE_SUBJECT = /^[A-Za-z0-9:._-]{1,64}$/;

/**
 * The key part of `subject`: itself when it is short and of a safe charset, else `h:` and its
 * SHA-256 (hex), so no subject can shape the key and two long subjects never collide.
 */
export function subjectKey(subject: string): string {
  if (SAFE_SUBJECT.test(subject)) return subject;
  return `h:${createHash("sha256").update(subject).digest("hex")}`;
}

/** Marker key of a (subject, code) pair the `lobby-codes` budget admitted in the window. */
const CODE_ADMITTED = "lobby-code-admitted";

export type LimitVerdict = { ok: boolean; retryAfterMs: number };
export type WebLimit = ((action: LimitAction, subject: string) => Promise<LimitVerdict>) & {
  /**
   * One attempt of `subject` at room code `code` (`null`: unparsable) for `action`. A code new to
   * the subject in the window spends one `lobby-codes` call first, atomically with its admission
   * (a refused one is not admitted, so retrying it is refused again; concurrent first calls spend
   * once, #701); `null` spends one on every call. Then the call counts
   * against `action` per (subject, code). Fails open like `limit`.
   */
  code(action: CodeAction, subject: string, code: string | null): Promise<LimitVerdict>;
  /**
   * Forgets the calls `subject` spent on `action` (#789: a new reset code clears its account's
   * redeem budget). Fails open like `limit`: a Redis error or timeout is one warning, never a throw.
   */
  clear(action: LimitAction, subject: string): Promise<void>;
};
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
    return Object.assign(disabled, {
      code: disabled,
      clear: async () => void (await disabled()),
      close: () => {},
    });
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
      // Reconnect errors are reported through `failOpen` by the calls; never with the URL.
      redis = createRedisClient(url);
      limiter = createLimiter(redis, { prefix: WEB_LIMITER_PREFIX });
    }
    return limiter;
  };

  /** Runs one Redis call with the timeout; `undefined` when it failed open. */
  const guarded = async <T>(call: () => Promise<T>): Promise<T | undefined> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    let pending: Promise<T>;
    try {
      pending = call();
    } catch (err) {
      failOpen((err as NodeJS.ErrnoException).code ?? "error");
      return undefined;
    }
    // A call that loses the race must not surface as an unhandled rejection later.
    pending.catch(() => undefined);
    try {
      const result = await Promise.race([pending, timeout]);
      if (result === "timeout") {
        failOpen("timeout");
        return undefined;
      }
      down = false;
      return result;
    } catch (err) {
      failOpen((err as NodeJS.ErrnoException).code ?? "error");
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  };

  const count = async (key: string, rule: LimitRule): Promise<LimitVerdict | undefined> => {
    const verdict = await guarded(() => client().limit(key, rule));
    return verdict && { ok: verdict.ok, retryAfterMs: verdict.retryAfterMs };
  };

  const limit = async (action: LimitAction, subject: string): Promise<LimitVerdict> =>
    (await count(`${action}:${subjectKey(subject)}`, LIMITS[action])) ?? ALLOW;

  const code = async (
    action: CodeAction,
    subject: string,
    roomCode: string | null,
  ): Promise<LimitVerdict> => {
    if (roomCode === null) return limit("lobby-codes", subject);
    const pair = subjectKey(`${subject}:${roomCode}`);
    // One atomic call (#701): concurrent first calls of one pair spend the budget once.
    const budget = await guarded(() =>
      client().admit(
        `lobby-codes:${subjectKey(subject)}`,
        `${CODE_ADMITTED}:${pair}`,
        LIMITS["lobby-codes"],
      ),
    );
    if (!budget) return ALLOW;
    if (!budget.ok) return { ok: false, retryAfterMs: budget.retryAfterMs };
    return (await count(`${action}:${pair}`, LIMITS[action])) ?? ALLOW;
  };

  const clear = async (action: LimitAction, subject: string): Promise<void> => {
    await guarded(() => client().clear(`${action}:${subjectKey(subject)}`));
  };

  return Object.assign(limit, { code, clear, close: () => redis?.disconnect() });
}
