import "dotenv/config";
import { randomBytes } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createRedisClient } from "@/server/redis";
import { createInviteStore, INVITE_TIMEOUT_MS, INVITE_TTL_S, inviteKey } from "./store";

// #808 C1, C3, C4, C6: the invite store over real Redis (the worktree's REDIS_URL): one
// `SET NX EX`, one `EXISTS`, one `GETDEL`, keys `web:invite:<token>` (ADR 0008), fail closed.
// Tokens are fresh per run and their keys are deleted at the end (shared db index).

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
  if (used.length) await redis.del(...used.map(inviteKey));
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

/** A TCP server that accepts connections and never answers (a hung Redis). */
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

describe("createInviteStore (real Redis)", () => {
  const stores: { close(): void }[] = [];
  afterEach(() => stores.splice(0).forEach((s) => s.close()));
  const make = (opts: Parameters<typeof createInviteStore>[0]) => {
    const s = createInviteStore(opts);
    stores.push(s);
    return s;
  };

  it("keys the web's own family web:invite:<token> and refuses a malformed token", () => {
    const t = token();
    expect(inviteKey(t)).toBe(`web:invite:${t}`);
    expect(() => inviteKey("not-a-token")).toThrow();
    expect(() => inviteKey(`${t.slice(0, 42)}*`)).toThrow();
  });

  it("C1: put stores token -> lobby id with a 24 h TTL, never overwriting (NX)", async () => {
    expect(INVITE_TTL_S).toBe(86_400);
    const store = make({ url: redisUrl });
    const t = token();
    expect(await store.put(t, "lob_1")).toBe("ok");
    expect(await redis.get(inviteKey(t))).toBe("lob_1");
    const ttl = await redis.ttl(inviteKey(t));
    expect(ttl).toBeGreaterThan(86_300);
    expect(ttl).toBeLessThanOrEqual(86_400);
    expect(await store.put(t, "lob_2")).toBe("taken");
    expect(await redis.get(inviteKey(t))).toBe("lob_1");
  });

  it("C4: has answers with EXISTS and consumes nothing", async () => {
    const store = make({ url: redisUrl });
    const t = token();
    expect(await store.has(t)).toBe(false);
    await store.put(t, "lob_1");
    expect(await store.has(t)).toBe(true);
    expect(await store.has(t)).toBe(true);
    expect(await redis.get(inviteKey(t))).toBe("lob_1");
  });

  it("C3: take returns the lobby id once, then null (GETDEL)", async () => {
    const store = make({ url: redisUrl });
    const t = token();
    await store.put(t, "lob_1");
    expect(await store.take(t)).toBe("lob_1");
    expect(await store.take(t)).toBeNull();
    expect(await store.has(t)).toBe(false);
    expect(await store.take(token())).toBeNull();
  });

  it("C3: concurrent takes of one token from separate clients: exactly one gets the lobby", async () => {
    const t = token();
    await make({ url: redisUrl }).put(t, "lob_1");
    const takers = Array.from({ length: 8 }, () => make({ url: redisUrl }));
    const outcomes = await Promise.all(takers.map((s) => s.take(t)));
    expect(outcomes.filter((o) => o === "lob_1")).toHaveLength(1);
    expect(outcomes.filter((o) => o === null)).toHaveLength(7);
  });

  it("C6: Redis unreachable: every call is unavailable, one warning per outage, never the URL or token", async () => {
    const warn = vi.fn();
    const url = `redis://:secret-pw@127.0.0.1:${await closedPort()}/0`;
    const store = make({ url, warn });
    const t = token();
    expect(await store.put(t, "lob_1")).toBe("unavailable");
    expect(await store.has(t)).toBe("unavailable");
    expect(await store.take(t)).toBe("unavailable");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe("invite store unavailable, refusing");
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret-pw|127\.0\.0\.1/);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(t);
  });

  it("C6: Redis slower than 1 s: unavailable after the timeout, never a throw", async () => {
    expect(INVITE_TIMEOUT_MS).toBe(1_000);
    const hung = await silentServer();
    try {
      const warn = vi.fn();
      const store = make({ url: `redis://127.0.0.1:${hung.port}/0`, warn });
      const t = token();
      const started = Date.now();
      const outcomes = await Promise.all([store.put(t, "lob_1"), store.has(t), store.take(t)]);
      expect(outcomes).toEqual(["unavailable", "unavailable", "unavailable"]);
      expect(Date.now() - started).toBeLessThan(3_000);
      expect(warn).toHaveBeenCalledWith("invite store unavailable, refusing", { cause: "timeout" });
    } finally {
      await hung.close();
    }
  });

  it("C6: without a URL every call is unavailable", async () => {
    const warn = vi.fn();
    const store = make({ url: undefined, warn });
    const t = token();
    expect(await store.put(t, "lob_1")).toBe("unavailable");
    expect(await store.has(t)).toBe("unavailable");
    expect(await store.take(t)).toBe("unavailable");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
