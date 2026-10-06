import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createFakeClock } from "../clock";
import { createRedis } from "../redis/client";
import { membersKey, ROOM_TTL_S, roomKey } from "./keys";
import { createRoomRegistry, type RoomRegistry } from "./registry";

// Integration tests against a real Redis (ADR 0008, ARCHITECTURE 10). They fail, never skip, when
// Redis is missing: a card worktree loads REDIS_URL from its .env, CI from the `check` job service.
// The db index may be shared with other card worktrees, so tests only ever delete their own keys.
let redis: Redis;
const opened: string[] = [];

beforeAll(async () => {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set: load the worktree .env (set -a; . ./.env)");
  redis = createRedis(url);
  try {
    await redis.connect();
  } catch (err) {
    redis.disconnect();
    throw new Error(`Redis unreachable at REDIS_URL: ${(err as Error).message}`);
  }
});

afterEach(async () => {
  const keys = opened.splice(0).flatMap((id) => [roomKey(id), membersKey(id)]);
  if (keys.length) await redis.del(...keys);
});

afterAll(() => redis?.disconnect());

function setup() {
  const clock = createFakeClock(Date.UTC(2026, 9, 5));
  return { clock, registry: createRoomRegistry({ redis, clock }) };
}

function lobby() {
  const id = `lob_${randomUUID()}`;
  opened.push(id);
  return id;
}

async function openRoom(registry: RoomRegistry, lobbyId = lobby(), hostUserId = "host") {
  await registry.open({ lobbyId, code: "ABCD", hostUserId });
  return lobbyId;
}

async function ttls(lobbyId: string) {
  return Promise.all([redis.ttl(roomKey(lobbyId)), redis.ttl(membersKey(lobbyId))]);
}

describe("room registry: open (C1)", () => {
  it("creates the room once; a second open returns created: false and the same room", async () => {
    const { registry } = setup();
    const lobbyId = lobby();
    const first = await registry.open({ lobbyId, code: "ABCD", hostUserId: "host" });
    expect(first).toEqual({
      created: true,
      room: { roomId: lobbyId, code: "ABCD", phase: "waiting" },
    });
    const second = await registry.open({ lobbyId, code: "WXYZ", hostUserId: "other" });
    expect(second).toEqual({ created: false, room: first.room });
  });

  it("never resets members", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    await registry.join(lobbyId, { userId: "a", name: "Ada" });
    await registry.open({ lobbyId, code: "ABCD", hostUserId: "host" });
    expect(await registry.members(lobbyId)).toEqual([{ desk: 1, name: "Ada", isHost: false }]);
  });
});

describe("room registry: join (C2, C3)", () => {
  it("allocates the lowest free desk", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    for (const userId of ["a", "b", "c"]) await registry.join(lobbyId, { userId, name: userId });
    await registry.leave(lobbyId, "b");
    const d = await registry.join(lobbyId, { userId: "d", name: "d" });
    expect(d).toMatchObject({ ok: true, desk: 2 });
  });

  it("gives the same desk to the same userId and lists it once", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    await registry.join(lobbyId, { userId: "a", name: "Ada" });
    await registry.join(lobbyId, { userId: "b", name: "Bob" });
    const again = await registry.join(lobbyId, { userId: "a", name: "Ada" });
    expect(again).toEqual({
      ok: true,
      desk: 1,
      members: [
        { desk: 1, name: "Ada", isHost: false },
        { desk: 2, name: "Bob", isHost: false },
      ],
      room: { roomId: lobbyId, code: "ABCD", phase: "waiting" },
    });
  });

  it("refuses an unknown room", async () => {
    const { registry } = setup();
    expect(await registry.join(lobby(), { userId: "a", name: "Ada" })).toEqual({
      ok: false,
      reason: "no-room",
    });
  });

  it("concurrent joins never share a desk", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        registry.join(lobbyId, { userId: `u${i}`, name: `U${i}` }),
      ),
    );
    const desks = results.map((r) => (r.ok ? r.desk : 0)).sort((x, y) => x - y);
    expect(desks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("marks only the host as isHost and sorts members by desk", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry, lobby(), "h");
    for (const userId of ["a", "h", "b", "c"])
      await registry.join(lobbyId, { userId, name: userId });
    await registry.leave(lobbyId, "a");
    await registry.join(lobbyId, { userId: "z", name: "z" });
    expect(await registry.members(lobbyId)).toEqual([
      { desk: 1, name: "z", isHost: false },
      { desk: 2, name: "h", isHost: true },
      { desk: 3, name: "b", isHost: false },
      { desk: 4, name: "c", isHost: false },
    ]);
  });
});

describe("room registry: leave (C4)", () => {
  it("closing the last member deletes both keys, members becomes null and count drops", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    await registry.join(lobbyId, { userId: "a", name: "Ada" });
    await registry.join(lobbyId, { userId: "b", name: "Bob" });
    const before = registry.count();

    expect(await registry.leave(lobbyId, "a")).toEqual({
      members: [{ desk: 2, name: "Bob", isHost: false }],
      closed: false,
    });
    expect(await registry.leave(lobbyId, "b")).toEqual({ members: [], closed: true });
    expect(await redis.exists(roomKey(lobbyId), membersKey(lobbyId))).toBe(0);
    expect(await registry.members(lobbyId)).toBeNull();
    expect(registry.count()).toBe(before - 1);
  });

  it("leaving an unknown room closes nothing", async () => {
    const { registry } = setup();
    expect(await registry.leave(lobby(), "a")).toEqual({ members: [], closed: false });
  });

  it("a non-member leaving an empty room does not close it", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    expect(await registry.leave(lobbyId, "stranger")).toEqual({ members: [], closed: false });
    expect(await registry.members(lobbyId)).toEqual([]);
  });
});

describe("room registry: TTL on every key (C5)", () => {
  it("sets a positive TTL after open, join and leave", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    expect(await redis.ttl(roomKey(lobbyId))).toBeGreaterThan(0);
    await registry.join(lobbyId, { userId: "a", name: "Ada" });
    await registry.join(lobbyId, { userId: "b", name: "Bob" });
    for (const ttl of await ttls(lobbyId)) expect(ttl).toBeGreaterThan(0);
    await registry.leave(lobbyId, "a");
    for (const ttl of await ttls(lobbyId)) expect(ttl).toBeGreaterThan(0);
  });

  it("refreshes the TTL on activity 30 minutes later", async () => {
    const { clock, registry } = setup();
    const lobbyId = await openRoom(registry);
    await registry.join(lobbyId, { userId: "a", name: "Ada" });
    // Redis ages keys on its own clock: age both keys by hand while the fake clock moves 30 min.
    const aged = ROOM_TTL_S / 2;
    await redis.expire(roomKey(lobbyId), aged);
    await redis.expire(membersKey(lobbyId), aged);
    clock.advance(30 * 60 * 1000);
    const before = await ttls(lobbyId);
    await registry.join(lobbyId, { userId: "b", name: "Bob" });
    const after = await ttls(lobbyId);
    after.forEach((ttl, i) => expect(ttl).toBeGreaterThan(before[i] ?? Infinity));
    await redis.expire(roomKey(lobbyId), aged);
    await redis.expire(membersKey(lobbyId), aged);
    await registry.leave(lobbyId, "b");
    for (const ttl of await ttls(lobbyId)) expect(ttl).toBeGreaterThan(aged);
  });
});

describe("room registry: count (C7)", () => {
  it("counts 30 rooms opened in a loop as 30", async () => {
    const { registry } = setup();
    for (let i = 0; i < 30; i++) await openRoom(registry);
    expect(registry.count()).toBe(30);
  });
});
