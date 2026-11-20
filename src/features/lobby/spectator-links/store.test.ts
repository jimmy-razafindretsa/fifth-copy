import "dotenv/config";
import { randomBytes } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createRedisClient } from "@/server/redis";
import { createSpectatorLinkStore, WATCH_TIMEOUT_MS, WATCH_TTL_S, watchKey } from "./store";

// #999 C12: the spectator link store over real Redis (the worktree's REDIS_URL): `SET NX EX` and a
// plain `GET` (reusable, never consumed), keys `web:watch:<token>` (ADR 0008), fail closed.

// eslint-disable-next-line no-restricted-properties
const redisUrl = process.env.REDIS_URL;
vi.mock("@/env", () => ({ env: { NODE_ENV: "test" } }));

const used: string[] = [];
const token = () => {
  const t = randomBytes(32).toString("base64url");
  used.push(t);
  return t;
};

let redis: ReturnType<typeof createRedisClient>;
beforeAll(() => {
  if (!redisUrl) throw new Error("REDIS_URL is not set: load the worktree .env (set -a; . ./.env)");
  redis = createRedisClient(redisUrl);
});
afterAll(async () => {
  if (used.length) await redis.del(...used.map(watchKey));
  redis.disconnect();
});

async function closedPort(): Promise<number> {
  const server: Server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

async function silentServer(): Promise<{ port: number; close(): Promise<void> }> {
  const sockets: Socket[] = [];
  const server = createServer((s) => void sockets.push(s));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  return {
    port,
    close: () =>
      new Promise<void>((r) => {
        sockets.forEach((s) => s.destroy());
        server.close(() => r());
      }),
  };
}

describe("createSpectatorLinkStore (real Redis)", () => {
  const stores: { close(): void }[] = [];
  afterEach(() => stores.splice(0).forEach((s) => s.close()));
  const make = (opts: Parameters<typeof createSpectatorLinkStore>[0]) => {
    const s = createSpectatorLinkStore(opts);
    stores.push(s);
    return s;
  };

  it("keys the web's own family web:watch:<token> and refuses a malformed token", () => {
    const t = token();
    expect(watchKey(t)).toBe(`web:watch:${t}`);
    expect(() => watchKey("not-a-token")).toThrow();
    expect(() => watchKey(`${t.slice(0, 42)}*`)).toThrow();
  });

  it("put stores token -> lobby id with a 24 h TTL, never overwriting (NX)", async () => {
    expect(WATCH_TTL_S).toBe(86_400);
    const store = make({ url: redisUrl });
    const t = token();
    expect(await store.put(t, "lob_1")).toBe("ok");
    expect(await redis.get(watchKey(t))).toBe("lob_1");
    const ttl = await redis.ttl(watchKey(t));
    expect(ttl).toBeGreaterThan(86_300);
    expect(ttl).toBeLessThanOrEqual(86_400);
    expect(await store.put(t, "lob_2")).toBe("taken");
    expect(await redis.get(watchKey(t))).toBe("lob_1");
  });

  it("get is reusable: the same lobby id every read, the key and its TTL untouched", async () => {
    const store = make({ url: redisUrl });
    const t = token();
    await store.put(t, "lob_9");
    for (let i = 0; i < 3; i++) expect(await store.get(t)).toBe("lob_9");
    expect(await redis.exists(watchKey(t))).toBe(1);
    expect(await store.get(token())).toBeNull();
  });

  it("fails closed: Redis unset, refused or hung is unavailable, warned once", async () => {
    const warn = vi.fn();
    expect(await make({ url: undefined, warn }).get(token())).toBe("unavailable");
    const down = make({ url: `redis://127.0.0.1:${await closedPort()}/0`, warn });
    expect(await down.put(token(), "lob_1")).toBe("unavailable");
    expect(await down.get(token())).toBe("unavailable");
    const hung = await silentServer();
    try {
      const slow = make({ url: `redis://127.0.0.1:${hung.port}/0`, timeoutMs: 200, warn });
      const started = Date.now();
      expect(await slow.get(token())).toBe("unavailable");
      expect(Date.now() - started).toBeLessThan(WATCH_TIMEOUT_MS + 500);
    } finally {
      await hung.close();
    }
    for (const call of warn.mock.calls)
      expect(JSON.stringify(call)).not.toMatch(/web:watch|redis:/);
  });
});
