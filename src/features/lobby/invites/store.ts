import "server-only";
import { env } from "@/env";
import { createRedisClient } from "@/server/redis";
import { INVITE_TOKEN_RE } from "../invite-token";

// The invite token store (#808, ADR 0008): Redis only, `web:invite:<token>` -> lobby id with a
// 24 h TTL, consumed with one atomic GETDEL. Fails closed: a Redis error or a call slower than
// `INVITE_TIMEOUT_MS` is `unavailable` (an invite is refused, never admitted). Warnings carry no
// URL and no token. The interface is three calls, so a later tombstone or lobby index is additive.

/** 24 hours (ADR 0008). */
export const INVITE_TTL_S = 86_400;
/** A call slower than this counts as Redis unavailable. */
export const INVITE_TIMEOUT_MS = 1_000;

export type Unavailable = "unavailable";
export type InviteStore = {
  /** `SET NX EX`: `taken` when the token is already on file (never overwritten). */
  put(token: string, lobbyId: string): Promise<"ok" | "taken" | Unavailable>;
  /** `EXISTS`: consumes nothing. */
  has(token: string): Promise<boolean | Unavailable>;
  /** `GETDEL`: the lobby id once, then `null` (never issued, used or expired). */
  take(token: string): Promise<string | null | Unavailable>;
};
type Warn = (msg: string, fields: Record<string, unknown>) => void;

const defaultWarn: Warn = (msg, fields) =>
  console.warn(JSON.stringify({ level: "warn", msg, ...fields }));

/** The web's own key family (ADR 0008: one owner per family). Refuses a malformed token. */
export function inviteKey(token: string): string {
  if (!INVITE_TOKEN_RE.test(token)) throw new TypeError("malformed token");
  return `web:invite:${token}`;
}

export function createInviteStore({
  url,
  ttlS = INVITE_TTL_S,
  timeoutMs = INVITE_TIMEOUT_MS,
  warn = defaultWarn,
}: {
  url: string | undefined;
  ttlS?: number;
  timeoutMs?: number;
  warn?: Warn;
}): InviteStore & { close(): void } {
  let redis: ReturnType<typeof createRedisClient> | undefined;
  let down = false;
  const unavailable = (cause: string): Unavailable => {
    if (!down) {
      down = true;
      warn("invite store unavailable, refusing", { cause });
    }
    return "unavailable";
  };

  /** One Redis call under the timeout; any failure is `unavailable`, never a throw. */
  const guarded = async <T>(
    token: string,
    call: (r: NonNullable<typeof redis>, key: string) => Promise<T>,
  ): Promise<T | Unavailable> => {
    const key = inviteKey(token);
    if (!url) return unavailable("REDIS_URL not set");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    try {
      redis ??= createRedisClient(url);
      const pending = call(redis, key);
      // A call that loses the race must not surface as an unhandled rejection later.
      pending.catch(() => undefined);
      const result = await Promise.race([pending, timeout]);
      if (result === "timeout") return unavailable("timeout");
      down = false;
      return result;
    } catch (err) {
      return unavailable((err as NodeJS.ErrnoException).code ?? "error");
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    put: async (token, lobbyId) => {
      const r = await guarded(token, (c, key) => c.set(key, lobbyId, "EX", ttlS, "NX"));
      return r === "unavailable" ? r : r === "OK" ? "ok" : "taken";
    },
    has: async (token) => {
      const r = await guarded(token, (c, key) => c.exists(key));
      return r === "unavailable" ? r : r === 1;
    },
    take: (token) => guarded(token, (c, key) => c.getdel(key)),
    close: () => redis?.disconnect(),
  };
}

let current: { url: string | undefined; store: InviteStore & { close(): void } } | undefined;

/** The process's store, created lazily from `env.REDIS_URL` (keyed on it for tests that swap the env). */
export function inviteStore(): InviteStore {
  if (!current || current.url !== env.REDIS_URL) {
    current?.store.close();
    current = { url: env.REDIS_URL, store: createInviteStore({ url: env.REDIS_URL }) };
  }
  return current.store;
}
