import { randomBytes } from "node:crypto";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { INTERNAL_MAX_SKEW_S, INTERNAL_NONCE_TTL_S } from "@fifth-copy/protocol";
import { nonceKey } from "../rooms/keys";
import { connectRedis } from "../testing/harness";
import { createNonceStore } from "./nonces";

// #518 C2: internal-request nonces in Redis (ADR 0008: every key with a TTL; real Redis, deletes only
// its own keys).
let redis: Redis;
const claimed: string[] = [];
beforeAll(async () => {
  redis = await connectRedis(process.env.REDIS_URL);
});
afterAll(async () => {
  if (claimed.length) await redis.del(...claimed.map(nonceKey));
  redis.disconnect();
});

function fresh() {
  const nonce = randomBytes(16).toString("hex");
  claimed.push(nonce);
  return nonce;
}

describe("nonce store (#518 C2)", () => {
  it("claims a nonce once: the first claim is true, every later one false", async () => {
    const nonces = createNonceStore({ redis });
    const nonce = fresh();
    expect(await nonces.claim(nonce)).toBe(true);
    expect(await nonces.claim(nonce)).toBe(false);
    expect(await nonces.claim(nonce)).toBe(false);
    expect(await nonces.claim(fresh())).toBe(true);
  });

  it("keeps the key under internal:nonce:<hex> with a TTL covering the skew window", async () => {
    const nonce = fresh();
    await createNonceStore({ redis }).claim(nonce);
    expect(nonceKey(nonce)).toBe(`internal:nonce:${nonce}`);
    const ttl = await redis.ttl(nonceKey(nonce));
    expect(ttl).toBeGreaterThan(INTERNAL_MAX_SKEW_S);
    expect(ttl).toBeLessThanOrEqual(INTERNAL_NONCE_TTL_S);
  });

  it("a replayed claim does not extend the TTL", async () => {
    const nonce = fresh();
    const nonces = createNonceStore({ redis });
    await nonces.claim(nonce);
    await redis.expire(nonceKey(nonce), 5);
    expect(await nonces.claim(nonce)).toBe(false);
    expect(await redis.ttl(nonceKey(nonce))).toBeLessThanOrEqual(5);
  });

  it("propagates a Redis error instead of answering true (fails closed)", async () => {
    const broken = { set: vi.fn().mockRejectedValue(new Error("down")) } as unknown as Redis;
    await expect(createNonceStore({ redis: broken }).claim(fresh())).rejects.toThrow("down");
  });
});
