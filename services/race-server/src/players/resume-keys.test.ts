import { randomUUID } from "node:crypto";
import type { Command, Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { connectRedis } from "../testing/harness";
import { resumeIndexKey, resumeKey, ROOM_TTL_S } from "../rooms/keys";
import { createResumeKeys } from "./resume-keys";

// #178: resume keys in Redis (ADR 0008: every key with a TTL; real Redis, deletes only its keys).
let redis: Redis;
const lobbies: string[] = [];
const issued: string[] = [];
beforeAll(async () => {
  redis = await connectRedis(process.env.REDIS_URL);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  const keys = [...lobbies.map(resumeIndexKey), ...issued.map(resumeKey)];
  if (keys.length) await redis.del(...keys);
  redis.disconnect();
});

function lobby() {
  const id = `lob_${randomUUID()}`;
  lobbies.push(id);
  return id;
}

/** Records every command sent, MULTI and EXEC included. */
function spySent() {
  const sent: string[][] = [];
  const original = redis.sendCommand.bind(redis);
  vi.spyOn(redis, "sendCommand").mockImplementation((command: Command, ...rest) => {
    sent.push([command.name.toLowerCase(), ...command.args.map(String)]);
    return original(command, ...(rest as []));
  });
  return sent;
}

describe("resume keys (C6)", () => {
  it("issues 32 random bytes hex once per (lobby, user), each write with its TTL in one MULTI", async () => {
    const keys = createResumeKeys({ redis });
    const id = lobby();
    const sent = spySent();
    const key = await keys.issue(id, "usr_a", 2);
    issued.push(key);
    expect(key).toMatch(/^[0-9a-f]{64}$/);

    // Between MULTI and EXEC: the key with `EX ROOM_TTL_S` inline, the index with its EXPIRE.
    const from = sent.findIndex(([name]) => name === "multi");
    const to = sent.findIndex(([name]) => name === "exec");
    expect(from).toBeGreaterThanOrEqual(0);
    const tx = sent.slice(from + 1, to);
    const writes = tx.filter(([name]) => ["set", "hset"].includes(name!));
    expect(writes.map(([name, k]) => [name, k])).toEqual([
      ["set", resumeKey(key)],
      ["hset", resumeIndexKey(id)],
    ]);
    expect(tx).toContainEqual(["set", resumeKey(key), expect.any(String), "EX", String(ROOM_TTL_S)]);
    expect(tx).toContainEqual(["expire", resumeIndexKey(id), String(ROOM_TTL_S)]);
    // No write outside the transaction.
    for (const [name] of [...sent.slice(0, from), ...sent.slice(to + 1)]) {
      expect(["set", "hset", "del", "hdel"]).not.toContain(name);
    }

    expect(await keys.issue(id, "usr_a", 2)).toBe(key);
    const other = await keys.issue(id, "usr_b", 3);
    issued.push(other);
    expect(other).not.toBe(key);
    expect(await keys.lookup(key)).toEqual({ lobbyId: id, userId: "usr_a", desk: 2 });
    expect(await redis.ttl(resumeKey(key))).toBeGreaterThan(ROOM_TTL_S - 5);
    expect(await redis.ttl(resumeIndexKey(id))).toBeGreaterThan(ROOM_TTL_S - 5);
  });

  it("re-issues a fresh key when the stored one expired", async () => {
    const keys = createResumeKeys({ redis });
    const id = lobby();
    const first = await keys.issue(id, "usr_a", 1);
    issued.push(first);
    await redis.del(resumeKey(first));
    const second = await keys.issue(id, "usr_a", 1);
    issued.push(second);
    expect(second).not.toBe(first);
    expect(await keys.lookup(second)).toMatchObject({ userId: "usr_a" });
  });

  it("grace shortens the TTL, keep restores the room TTL, drop deletes key and index entry", async () => {
    const keys = createResumeKeys({ redis });
    const id = lobby();
    const key = await keys.issue(id, "usr_a", 1);
    issued.push(key);
    await keys.grace(key, 120_000);
    const pttl = await redis.pttl(resumeKey(key));
    expect(pttl).toBeGreaterThan(0);
    expect(pttl).toBeLessThanOrEqual(120_000);
    await keys.keep(key);
    expect(await redis.ttl(resumeKey(key))).toBeGreaterThan(ROOM_TTL_S - 5);

    await keys.drop(id, "usr_a");
    expect(await redis.exists(resumeKey(key))).toBe(0);
    expect(await redis.hexists(resumeIndexKey(id), "usr_a")).toBe(0);
    expect(await keys.lookup(key)).toBeNull();
  });

  it("dropRoom deletes every key of the room and its index", async () => {
    const keys = createResumeKeys({ redis });
    const id = lobby();
    const a = await keys.issue(id, "usr_a", 1);
    const b = await keys.issue(id, "usr_b", 2);
    issued.push(a, b);
    await keys.dropRoom(id);
    expect(await redis.exists(resumeKey(a), resumeKey(b), resumeIndexKey(id))).toBe(0);
  });

  it("lookup answers null for an unknown key and for a corrupt entry", async () => {
    const keys = createResumeKeys({ redis });
    expect(await keys.lookup("ab".repeat(32))).toBeNull();
    const corrupt = "cd".repeat(32);
    issued.push(corrupt);
    await redis.set(resumeKey(corrupt), "{not json", "EX", 60);
    expect(await keys.lookup(corrupt)).toBeNull();
  });
});
