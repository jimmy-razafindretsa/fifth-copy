import { randomBytes } from "node:crypto";
import type { ChainableCommander, Redis } from "ioredis";
import { z } from "zod";
import { resumeIndexKey, resumeKey, ROOM_TTL_S } from "../rooms/keys";

/** What a resume key resolves to; the handshake binds it to the verified token (ADR 0009). */
export type ResumeEntry = { lobbyId: string; userId: string; desk: number };

const entrySchema = z.object({
  lobbyId: z.string().min(1),
  userId: z.string().min(1),
  desk: z.int().min(1),
});

/**
 * Resume keys in Redis (#178, ADR 0008: ephemeral, every key with a TTL, written in one MULTI with
 * it). Redis I/O only: when a key is shortened, kept or dropped is `presence.ts`'s decision.
 */
export type ResumeKeys = {
  /**
   * The user's key in this room: the stored one while it lives (its TTL untouched), else 32 fresh
   * random bytes hex, stored with `ROOM_TTL_S` and indexed by user.
   */
  issue(lobbyId: string, userId: string, desk: number): Promise<string>;
  /** The entry of a key; null when unknown, expired or corrupt. */
  lookup(key: string): Promise<ResumeEntry | null>;
  /** The key now expires `ms` from now (the reconnection grace). */
  grace(key: string, ms: number): Promise<void>;
  /** The key lives `ROOM_TTL_S` again (its user is back). */
  keep(key: string): Promise<void>;
  /** Deletes the user's key and its index entry. */
  drop(lobbyId: string, userId: string): Promise<void>;
  /** Deletes every key of the room and the index (room closed). */
  dropRoom(lobbyId: string): Promise<void>;
};

async function exec(tx: ChainableCommander) {
  const results = await tx.exec();
  if (!results) throw new Error("resume keys: transaction aborted");
  for (const [err] of results) if (err) throw err;
}

export function createResumeKeys({ redis }: { redis: Redis }): ResumeKeys {
  return {
    async issue(lobbyId, userId, desk) {
      const index = resumeIndexKey(lobbyId);
      const stored = await redis.hget(index, userId);
      if (stored !== null && (await redis.exists(resumeKey(stored))) === 1) return stored;
      const key = randomBytes(32).toString("hex");
      const entry: ResumeEntry = { lobbyId, userId, desk };
      await exec(
        redis
          .multi()
          .set(resumeKey(key), JSON.stringify(entry), "EX", ROOM_TTL_S)
          .hset(index, userId, key)
          .expire(index, ROOM_TTL_S),
      );
      return key;
    },

    async lookup(key) {
      const raw = await redis.get(resumeKey(key));
      if (raw === null) return null;
      try {
        const parsed = entrySchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },

    async grace(key, ms) {
      await redis.pexpire(resumeKey(key), ms);
    },

    async keep(key) {
      await redis.expire(resumeKey(key), ROOM_TTL_S);
    },

    async drop(lobbyId, userId) {
      const index = resumeIndexKey(lobbyId);
      const key = await redis.hget(index, userId);
      if (key === null) return;
      await exec(redis.multi().del(resumeKey(key)).hdel(index, userId));
    },

    async dropRoom(lobbyId) {
      const index = resumeIndexKey(lobbyId);
      const keys = Object.values(await redis.hgetall(index)).map(resumeKey);
      await redis.del(index, ...keys);
    },
  };
}
