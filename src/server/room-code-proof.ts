import "server-only";
import { env } from "@/env";
import { createGuardedRedis } from "./guarded-redis";

// The room code proof (#999 C13, ADR 0008 amendment): `web:code-proof:<userId>:<lobbyId>` -> "1" with
// a 24 h TTL, written when a viewer presented the lobby's room code to a web action (the race token
// mint, the race page's code entry). `getRaceSeat` serves a room's code only to its host or to a
// viewer holding this proof, so an id alone (a race id, a lobby id a spectator link reveals) never
// yields the code. Fails closed: Redis down, slow or unset reads as "no proof". Never logged.

/** 24 hours (ADR 0008): a school day's room, the spectator link's TTL. */
export const CODE_PROOF_TTL_S = 86_400;
/** A call slower than this counts as Redis unavailable (no proof). */
export const CODE_PROOF_TIMEOUT_MS = 1_000;

/** Ids are cuids/uuids from our own rows; anything else is refused before Redis. */
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function codeProofKey(userId: string, lobbyId: string): string {
  if (!ID_RE.test(userId) || !ID_RE.test(lobbyId)) throw new TypeError("malformed id");
  return `web:code-proof:${userId}:${lobbyId}`;
}

export type CodeProofStore = {
  /** `SET EX`: renews the proof's 24 h. `false` when it could not be written. */
  record(userId: string, lobbyId: string): Promise<boolean>;
  /** `EXISTS`: `false` on any failure (fail closed). */
  holds(userId: string, lobbyId: string): Promise<boolean>;
};

export function createCodeProofStore({
  url,
  ttlS = CODE_PROOF_TTL_S,
  timeoutMs = CODE_PROOF_TIMEOUT_MS,
  warn,
}: {
  url: string | undefined;
  ttlS?: number;
  timeoutMs?: number;
  warn?: (msg: string, fields: Record<string, unknown>) => void;
}): CodeProofStore & { close(): void } {
  const redis = createGuardedRedis({ url, label: "code proof store", timeoutMs, warn });
  return {
    record: async (userId, lobbyId) => {
      const key = codeProofKey(userId, lobbyId);
      return (await redis.run((r) => r.set(key, "1", "EX", ttlS))) === "OK";
    },
    holds: async (userId, lobbyId) => {
      const key = codeProofKey(userId, lobbyId);
      return (await redis.run((r) => r.exists(key))) === 1;
    },
    close: redis.close,
  };
}

let current: { url: string | undefined; store: CodeProofStore & { close(): void } } | undefined;

/** The process's store, created lazily from `env.REDIS_URL`. */
export function codeProofStore(): CodeProofStore {
  if (!current || current.url !== env.REDIS_URL) {
    current?.store.close();
    current = { url: env.REDIS_URL, store: createCodeProofStore({ url: env.REDIS_URL }) };
  }
  return current.store;
}
