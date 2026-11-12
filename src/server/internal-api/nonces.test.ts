import "dotenv/config";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { INTERNAL_MAX_SKEW_S, INTERNAL_NONCE_TTL_S } from "@fifth-copy/protocol";
import { createRedisClient } from "../redis";
import { createWebNonceStore, NONCE_TIMEOUT_MS, webNonceKey } from "./nonces";

// #716 C1 and C3: the web's internal-request replay store over real Redis (the worktree's
// REDIS_URL), and its fail-closed policy (ADR 0020 amendment). Nonces are fresh per run and their
// keys are deleted at the end (shared db index).

// eslint-disable-next-line no-restricted-properties
const redisUrl = process.env.REDIS_URL;
vi.mock("@/env", () => ({ env: { NODE_ENV: "test" } }));

const fresh = () => randomBytes(16).toString("hex");
const used: string[] = [];
const nonce = () => {
  const n = fresh();
  used.push(n);
  return n;
};

let redis: ReturnType<typeof createRedisClient>;
beforeAll(() => {
  if (!redisUrl) throw new Error("REDIS_URL is not set: load the worktree .env (set -a; . ./.env)");
  redis = createRedisClient(redisUrl);
});
afterAll(async () => {
  if (used.length) await redis.del(...used.map(webNonceKey));
  redis.disconnect();
});

/** A TCP port that accepts nothing: bound, then closed. */
async function closedPort(): Promise<number> {
  const server: Server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

describe("createWebNonceStore (real Redis)", () => {
  const stores: { close(): void }[] = [];
  afterEach(() => stores.splice(0).forEach((s) => s.close()));
  const make = (opts: Parameters<typeof createWebNonceStore>[0]) => {
    const s = createWebNonceStore(opts);
    stores.push(s);
    return s;
  };

  it("keys its own family, distinct from the race server's internal:nonce:", () => {
    const n = fresh();
    expect(webNonceKey(n)).toBe(`web:internal:nonce:${n}`);
    expect(() => webNonceKey("not-a-nonce")).toThrow();
  });

  it("C1: claims a nonce once; its reuse is a replay", async () => {
    const store = make({ url: redisUrl, nodeEnv: "test" });
    const n = nonce();
    expect(await store.claim(n)).toBe("claimed");
    expect(await store.claim(n)).toBe("replay");
    expect(await store.claim(nonce())).toBe("claimed");
  });

  it("C1: two concurrent claims of one nonce: exactly one wins", async () => {
    const store = make({ url: redisUrl, nodeEnv: "test" });
    const n = nonce();
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => store.claim(n)));
    expect(outcomes.filter((o) => o === "claimed")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "replay")).toHaveLength(4);
  });

  it("C1: the stored nonce lives INTERNAL_NONCE_TTL_S (>= the skew window); a replay never extends it", async () => {
    expect(INTERNAL_NONCE_TTL_S).toBeGreaterThanOrEqual(INTERNAL_MAX_SKEW_S);
    const store = make({ url: redisUrl, nodeEnv: "test" });
    const n = nonce();
    await store.claim(n);
    const ttl = await redis.ttl(webNonceKey(n));
    expect(ttl).toBeGreaterThan(INTERNAL_MAX_SKEW_S);
    expect(ttl).toBeLessThanOrEqual(INTERNAL_NONCE_TTL_S);
    await redis.expire(webNonceKey(n), 100);
    expect(await store.claim(n)).toBe("replay");
    expect(await redis.ttl(webNonceKey(n))).toBeLessThanOrEqual(100);
  });

  it("C3: Redis unreachable: unavailable (fail closed), one warning per outage, never the URL", async () => {
    const warn = vi.fn();
    const url = `redis://:secret-pw@127.0.0.1:${await closedPort()}/0`;
    const store = make({ url, nodeEnv: "production", warn });
    const outcomes = await Promise.all(Array.from({ length: 3 }, () => store.claim(fresh())));
    outcomes.push(await store.claim(fresh()));
    expect(outcomes.every((o) => o === "unavailable")).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe("internal nonce store unavailable, refusing");
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret-pw|127\.0\.0\.1/);
  });

  it("C3: Redis slower than the timeout: unavailable", async () => {
    expect(NONCE_TIMEOUT_MS).toBeGreaterThan(250);
    const warn = vi.fn();
    const store = make({ url: redisUrl, nodeEnv: "test", warn, timeoutMs: 0 });
    expect(await store.claim(nonce())).toBe("unavailable");
    expect(warn).toHaveBeenCalledWith("internal nonce store unavailable, refusing", {
      cause: "timeout",
    });
  });

  it("C3: without a URL: production refuses every claim; dev/test admit with one warning", async () => {
    const warnProd = vi.fn();
    const prod = make({ url: undefined, nodeEnv: "production", warn: warnProd });
    expect(await prod.claim(fresh())).toBe("unavailable");
    expect(await prod.claim(fresh())).toBe("unavailable");
    expect(warnProd).toHaveBeenCalledTimes(1);

    const warnTest = vi.fn();
    const test = make({ url: undefined, nodeEnv: "test", warn: warnTest });
    const n = fresh();
    expect(await test.claim(n)).toBe("claimed");
    expect(await test.claim(n)).toBe("claimed");
    expect(warnTest).toHaveBeenCalledTimes(1);
    expect(warnTest).toHaveBeenCalledWith("internal nonce store disabled", {
      cause: "REDIS_URL not set",
    });
  });
});
