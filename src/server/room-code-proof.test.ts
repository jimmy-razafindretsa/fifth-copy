import "dotenv/config";
import { createServer, type Server } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createRedisClient } from "./redis";
import { CODE_PROOF_TTL_S, codeProofKey, createCodeProofStore } from "./room-code-proof";

// #999 C13: the room code proof over real Redis: `SET EX` then `EXISTS`, keys
// `web:code-proof:<userId>:<lobbyId>` with a 24 h TTL, fail closed (no proof when Redis is away).

// eslint-disable-next-line no-restricted-properties
const redisUrl = process.env.REDIS_URL;
vi.mock("@/env", () => ({ env: { NODE_ENV: "test" } }));

const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const user = `usr_${run}`;
let redis: ReturnType<typeof createRedisClient>;
beforeAll(() => {
  if (!redisUrl) throw new Error("REDIS_URL is not set: load the worktree .env (set -a; . ./.env)");
  redis = createRedisClient(redisUrl);
});
afterAll(async () => {
  await redis.del(codeProofKey(user, "lob_a"), codeProofKey(user, "lob_b"));
  redis.disconnect();
});

async function closedPort(): Promise<number> {
  const server: Server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

describe("createCodeProofStore (real Redis)", () => {
  const stores: { close(): void }[] = [];
  afterEach(() => stores.splice(0).forEach((s) => s.close()));
  const make = (opts: Parameters<typeof createCodeProofStore>[0]) => {
    const s = createCodeProofStore(opts);
    stores.push(s);
    return s;
  };

  it("keys web:code-proof:<user>:<lobby> and refuses a malformed id", () => {
    expect(codeProofKey("usr_1", "lob_1")).toBe("web:code-proof:usr_1:lob_1");
    expect(() => codeProofKey("usr:1", "lob_1")).toThrow();
    expect(() => codeProofKey("usr_1", "")).toThrow();
  });

  it("a recorded proof holds for that viewer and that lobby only, with a 24 h TTL", async () => {
    const store = make({ url: redisUrl });
    expect(await store.holds(user, "lob_a")).toBe(false);
    expect(await store.record(user, "lob_a")).toBe(true);
    expect(await store.holds(user, "lob_a")).toBe(true);
    expect(await store.holds(user, "lob_b")).toBe(false);
    expect(await store.holds(`${user}x`, "lob_a")).toBe(false);
    const ttl = await redis.ttl(codeProofKey(user, "lob_a"));
    expect(CODE_PROOF_TTL_S).toBe(86_400);
    expect(ttl).toBeGreaterThan(86_300);
  });

  it("fails closed: no proof when Redis is unset or down", async () => {
    const warn = vi.fn();
    expect(await make({ url: undefined, warn }).holds(user, "lob_a")).toBe(false);
    const down = make({ url: `redis://127.0.0.1:${await closedPort()}/0`, warn });
    expect(await down.record(user, "lob_b")).toBe(false);
    expect(await down.holds(user, "lob_a")).toBe(false);
  });
});
