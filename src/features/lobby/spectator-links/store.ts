import "server-only";
import { env } from "@/env";
import { createGuardedRedis, type Unavailable } from "@/server/guarded-redis";
import { INVITE_TOKEN_RE } from "../invite-token";

// The spectator link store (#999 C12, ADR 0008 amendment): Redis only, `web:watch:<token>` -> lobby
// id with a 24 h TTL. Reusable: reading it consumes nothing, so one projector link serves a whole
// class for the day. Fails closed: a Redis error or a call slower than `WATCH_TIMEOUT_MS` is
// `unavailable` (the link is refused, never admitted). The token is the invite's shape (32 random
// bytes, base64url) and is never logged.

/** 24 hours (ADR 0008). */
export const WATCH_TTL_S = 86_400;
/** A call slower than this counts as Redis unavailable. */
export const WATCH_TIMEOUT_MS = 1_000;

export type SpectatorLinkStore = {
  /** `SET NX EX`: `taken` when the token is already on file (never overwritten). */
  put(token: string, lobbyId: string): Promise<"ok" | "taken" | Unavailable>;
  /** `GET`: the lobby id, `null` when never issued or expired. Consumes nothing. */
  get(token: string): Promise<string | null | Unavailable>;
};

/** The web's own key family (ADR 0008). Refuses a malformed token. */
export function watchKey(token: string): string {
  if (!INVITE_TOKEN_RE.test(token)) throw new TypeError("malformed token");
  return `web:watch:${token}`;
}

export function createSpectatorLinkStore({
  url,
  ttlS = WATCH_TTL_S,
  timeoutMs = WATCH_TIMEOUT_MS,
  warn,
}: {
  url: string | undefined;
  ttlS?: number;
  timeoutMs?: number;
  warn?: (msg: string, fields: Record<string, unknown>) => void;
}): SpectatorLinkStore & { close(): void } {
  const redis = createGuardedRedis({ url, label: "spectator link store", timeoutMs, warn });
  return {
    put: async (token, lobbyId) => {
      const key = watchKey(token);
      const r = await redis.run((c) => c.set(key, lobbyId, "EX", ttlS, "NX"));
      return r === "unavailable" ? r : r === "OK" ? "ok" : "taken";
    },
    get: async (token) => {
      const key = watchKey(token);
      return redis.run((c) => c.get(key));
    },
    close: redis.close,
  };
}

let current: { url: string | undefined; store: SpectatorLinkStore & { close(): void } } | undefined;

/** The process's store, created lazily from `env.REDIS_URL`. */
export function spectatorLinkStore(): SpectatorLinkStore {
  if (!current || current.url !== env.REDIS_URL) {
    current?.store.close();
    current = { url: env.REDIS_URL, store: createSpectatorLinkStore({ url: env.REDIS_URL }) };
  }
  return current.store;
}
