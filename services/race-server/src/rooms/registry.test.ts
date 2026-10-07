import { randomUUID } from "node:crypto";
import type { Command, Redis } from "ioredis";
import {
  DEFAULT_RACE_SETTINGS,
  deskIdentity,
  memberSchema,
  type Member,
  type RaceSettings,
} from "@fifth-copy/protocol";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createFakeClock } from "../clock";
import { createRedis } from "../redis/client";
import { membersKey, ROOM_TTL_S, roomKey } from "./keys";
import { createRoomRegistry, type RaceDesk, type RoomRegistry } from "./registry";

// Integration tests against a real Redis (ADR 0008, ARCHITECTURE 10). They fail, never skip, when
// Redis is missing: a card worktree loads REDIS_URL from its .env, CI from the `check` job service.
// The db index may be shared with other card worktrees, so tests only ever delete their own keys.
let redis: Redis;
const opened: string[] = [];

/** A human member as the registry fills it: identity from `deskIdentity` (#557). */
const m = (desk: number, name: string, isHost: boolean): Member => ({
  desk,
  name,
  isHost,
  isBot: false,
  ...deskIdentity(desk),
});

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

const settings = DEFAULT_RACE_SETTINGS;
const custom: RaceSettings = { ...settings, timerS: 120, bots: [{ level: "major" }] };

function lobby() {
  const id = `lob_${randomUUID()}`;
  opened.push(id);
  return id;
}

async function openRoom(registry: RoomRegistry, lobbyId = lobby(), hostUserId = "host") {
  await registry.open({ lobbyId, code: "ABCD", hostUserId, settings });
  return lobbyId;
}

async function ttls(lobbyId: string) {
  return Promise.all([redis.ttl(roomKey(lobbyId)), redis.ttl(membersKey(lobbyId))]);
}

describe("room registry: open (C1)", () => {
  it("creates the room once; a second open returns created: false and the same room", async () => {
    const { registry } = setup();
    const lobbyId = lobby();
    const first = await registry.open({ lobbyId, code: "ABCD", hostUserId: "host", settings });
    expect(first).toEqual({
      created: true,
      room: { roomId: lobbyId, code: "ABCD", phase: "waiting", settings, race: null },
    });
    const second = await registry.open({
      lobbyId,
      code: "WXYZ",
      hostUserId: "other",
      settings: custom,
    });
    expect(second).toEqual({ created: false, room: first.room });
    expect(second.room.settings).toEqual(settings);
    expect(await registry.settings(lobbyId)).toEqual(settings);
  });

  it("never resets members", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    await registry.join(lobbyId, { userId: "a", name: "Ada" });
    await registry.open({ lobbyId, code: "ABCD", hostUserId: "host", settings });
    expect(await registry.members(lobbyId)).toEqual([m(1, "Ada", false)]);
  });
});

describe("room registry: settings (#568 C4)", () => {
  it("stores the settings with the room TTL and reads them back parsed", async () => {
    const { registry } = setup();
    const lobbyId = lobby();
    const { room } = await registry.open({
      lobbyId,
      code: "ABCD",
      hostUserId: "host",
      settings: custom,
    });
    expect(room.settings).toEqual(custom);
    expect(await registry.settings(lobbyId)).toEqual(custom);
    expect(await redis.ttl(roomKey(lobbyId))).toBeGreaterThan(0);
    const joined = await registry.join(lobbyId, { userId: "a", name: "Ada" });
    expect(joined.ok && joined.room.settings).toEqual(custom);
  });

  it("returns null for an unknown room", async () => {
    const { registry } = setup();
    expect(await registry.settings(lobby())).toBeNull();
  });

  it("rejects a corrupt settings field instead of returning a default", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    await redis.hset(roomKey(lobbyId), "settings", '{"wordCount":5}');
    await expect(registry.settings(lobbyId)).rejects.toThrow();
    await redis.hset(roomKey(lobbyId), "settings", "not json");
    await expect(registry.settings(lobbyId)).rejects.toThrow();
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
      members: [m(1, "Ada", false), m(2, "Bob", false)],
      room: { roomId: lobbyId, code: "ABCD", phase: "waiting", settings, race: null },
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

  it("fills every member with isBot: false and the deskIdentity of its desk (#557 C2)", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    for (let i = 0; i < 14; i++) await registry.join(lobbyId, { userId: `u${i}`, name: `U${i}` });
    const members = (await registry.members(lobbyId)) ?? [];
    expect(members).toHaveLength(14);
    for (const member of members) {
      expect(member).toMatchObject({ isBot: false, ...deskIdentity(member.desk) });
      expect(memberSchema.safeParse(member).success).toBe(true);
    }
    expect(members[12]).toMatchObject({ desk: 13, color: 0, marker: "square" });
  });

  it("marks only the host as isHost and sorts members by desk", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry, lobby(), "h");
    for (const userId of ["a", "h", "b", "c"])
      await registry.join(lobbyId, { userId, name: userId });
    await registry.leave(lobbyId, "a");
    await registry.join(lobbyId, { userId: "z", name: "z" });
    expect(await registry.members(lobbyId)).toEqual([
      m(1, "z", false),
      m(2, "h", true),
      m(3, "b", false),
      m(4, "c", false),
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
      members: [m(2, "Bob", false)],
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

describe("room registry: updateSettings (#101 C3)", () => {
  async function stored(lobbyId: string) {
    return JSON.parse((await redis.hget(roomKey(lobbyId), "settings")) ?? "null") as unknown;
  }

  it("merges a patch over the stored settings, writes and returns the whole object", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    await registry.join(lobbyId, { userId: "host", name: "Ada" });
    const result = await registry.updateSettings(lobbyId, "host", {
      timerS: 120,
      errorMode: "block",
    });
    const expected = { ...settings, timerS: 120, errorMode: "block" };
    expect(result).toEqual({ ok: true, settings: expected });
    expect(await stored(lobbyId)).toEqual(expected);
    expect(await registry.settings(lobbyId)).toEqual(expected);
    for (const ttl of await ttls(lobbyId)) expect(ttl).toBeGreaterThan(0);
  });

  it("replaces a top-level field whole: bots set, then emptied", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    await registry.updateSettings(lobbyId, "host", {
      bots: [{ level: "recruit" }, { level: "clerk" }],
    });
    // A bots patch also re-seats the room and returns its members (#156, rooms/bots.test.ts).
    expect(await registry.updateSettings(lobbyId, "host", { bots: [{ level: "major" }] })).toEqual({
      ok: true,
      settings: { ...settings, bots: [{ level: "major" }] },
      members: [expect.objectContaining({ desk: 2, isBot: true })],
    });
    expect(await registry.updateSettings(lobbyId, "host", { bots: [] })).toEqual({
      ok: true,
      settings: { ...settings, bots: [] },
      members: [],
    });
    expect(await stored(lobbyId)).toEqual({ ...settings, bots: [] });
  });

  it("serialises two concurrent patches on one room", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    const [first, second] = await Promise.all([
      registry.updateSettings(lobbyId, "host", { timerS: 120, wordCount: 80 }),
      registry.updateSettings(lobbyId, "host", { timerS: 300, language: "fr" }),
    ]);
    expect(first.ok && second.ok).toBe(true);
    const expected = { ...settings, wordCount: 80, timerS: 300, language: "fr" };
    expect(second).toEqual({ ok: true, settings: expected });
    expect(await stored(lobbyId)).toEqual(expected);
  });

  it("refuses: no-room, not-host, not-waiting, invalid; the hash is unchanged", async () => {
    const { registry } = setup();
    expect(await registry.updateSettings(lobby(), "host", { timerS: 120 })).toEqual({
      ok: false,
      reason: "no-room",
    });
    const lobbyId = await openRoom(registry);
    const before = await redis.hgetall(roomKey(lobbyId));
    expect(await registry.updateSettings(lobbyId, "player", { timerS: 120 })).toEqual({
      ok: false,
      reason: "not-host",
    });
    for (const patch of [{ wordCount: 9 }, { lobbyType: "public" }, { nope: 1 }, { timerS: "60" }])
      expect(await registry.updateSettings(lobbyId, "host", patch as never)).toEqual({
        ok: false,
        reason: "invalid",
      });
    expect(await redis.hgetall(roomKey(lobbyId))).toEqual(before);
    await redis.hset(roomKey(lobbyId), "phase", "countdown");
    expect(await registry.updateSettings(lobbyId, "host", { timerS: 120 })).toEqual({
      ok: false,
      reason: "not-waiting",
    });
    expect(await stored(lobbyId)).toEqual(settings);
  });

  it("ignores a key whose value is undefined instead of throwing or erasing it", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    expect(
      await registry.updateSettings(lobbyId, "host", { wordCount: undefined, timerS: 60 } as never),
    ).toEqual({ ok: true, settings: { ...settings, timerS: 60 } });
    expect(await stored(lobbyId)).toEqual({ ...settings, timerS: 60 });
  });
});

const race = {
  raceId: "6f1c2a4e-8b9d-4c3e-9f0a-1b2c3d4e5f60",
  text: "Le dossier est en retard.",
  language: "fr" as const,
  wordCount: 5,
  t0: Date.UTC(2026, 9, 5) + 3000,
  timerS: 60,
};

describe("room registry: lifecycle fields (#166)", () => {
  it("room() reads phase, settings, seated desks, and the race fields once started", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    await registry.join(lobbyId, { userId: "host", name: "Ada" });
    await registry.join(lobbyId, { userId: "b", name: "Bob" });
    const seated: RaceDesk[] = [
      { desk: 1, userId: "host", name: "Ada", isBot: false },
      { desk: 2, userId: "b", name: "Bob", isBot: false },
    ];
    expect(await registry.room(lobbyId)).toEqual({
      hostUserId: "host",
      phase: "waiting",
      settings,
      race: null,
      endAt: null,
      seated,
      desks: null,
    });
    expect(await registry.room(`lob_${randomUUID()}`)).toBeNull();

    await registry.startRace(lobbyId, { race, endAt: race.t0 + 60_000, desks: seated });
    expect(await registry.room(lobbyId)).toMatchObject({
      phase: "countdown",
      race,
      endAt: race.t0 + 60_000,
      desks: seated,
    });
    expect(await redis.hmget(roomKey(lobbyId), "raceId", "t0", "endAt")).toEqual([
      race.raceId,
      String(race.t0),
      String(race.t0 + 60_000),
    ]);
    for (const ttl of await ttls(lobbyId)) expect(ttl).toBeGreaterThan(0);

    await registry.setPhase(lobbyId, "running");
    expect((await registry.room(lobbyId))?.phase).toBe("running");
  });

  it("join refuses a new user once started with in-progress; a member still joins with the race", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    await registry.join(lobbyId, { userId: "host", name: "Ada" });
    await registry.startRace(lobbyId, { race, endAt: race.t0 + 60_000, desks: [] });
    await registry.setPhase(lobbyId, "running");

    expect(await registry.join(lobbyId, { userId: "late", name: "Lou" })).toEqual({
      ok: false,
      reason: "in-progress",
    });
    expect(await registry.hasMember(lobbyId, "late")).toBe(false);
    expect(await registry.hasMember(lobbyId, "host")).toBe(true);
    expect(await registry.join(lobbyId, { userId: "host", name: "Ada" })).toMatchObject({
      ok: true,
      desk: 1,
      room: { phase: "running", race },
    });
  });

  it("withRoom runs after the room's pending calls", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    const join = registry.join(lobbyId, { userId: "a", name: "Ada" });
    const seen = await registry.withRoom(
      lobbyId,
      async () => (await registry.room(lobbyId))?.seated,
    );
    await join;
    expect(seen).toHaveLength(1);
  });
});

describe("room registry: count (C7)", () => {
  it("counts 30 rooms opened in a loop as 30", async () => {
    const { registry } = setup();
    for (let i = 0; i < 30; i++) await openRoom(registry);
    expect(registry.count()).toBe(30);
  });
});

// Every command the client sends (direct or queued in a MULTI) goes through sendCommand, so the
// spy sees the exact wire order. Commands between MULTI and EXEC form one transaction.
function recordCommands() {
  const sent: string[][] = [];
  const original = redis.sendCommand.bind(redis);
  vi.spyOn(redis, "sendCommand").mockImplementation((command: Command, ...rest) => {
    sent.push([command.name.toLowerCase(), ...command.args.map(String)]);
    return original(command, ...(rest as []));
  });
  return () => {
    const groups: { atomic: boolean; commands: string[][] }[] = [];
    let open: string[][] | null = null;
    for (const cmd of sent) {
      if (cmd[0] === "multi") open = [];
      else if (cmd[0] === "exec" && open) {
        groups.push({ atomic: true, commands: open });
        open = null;
      } else if (open) open.push(cmd);
      else groups.push({ atomic: false, commands: [cmd] });
    }
    return groups;
  };
}

describe("room registry: atomic writes (#517)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never writes a room or members hash outside a MULTI that also sets both TTLs", async () => {
    const { registry } = setup();
    const lobbyId = lobby();
    const hashKeys = [roomKey(lobbyId), membersKey(lobbyId)];
    const groups = recordCommands();

    await registry.open({ lobbyId, code: "ABCD", hostUserId: "host", settings });
    await registry.open({ lobbyId, code: "WXYZ", hostUserId: "other", settings: custom });
    await registry.join(lobbyId, { userId: "a", name: "Ada" });
    await registry.join(lobbyId, { userId: "b", name: "Bob" });
    await registry.leave(lobbyId, "a");
    await registry.updateSettings(lobbyId, "host", { timerS: 60 });
    await registry.startRace(lobbyId, { race, endAt: race.t0 + 60_000, desks: [] });
    await registry.setPhase(lobbyId, "running");

    const writes = ["hset", "hsetnx", "hmset"];
    const writing = groups().filter(({ commands }) =>
      commands.some(([name, key]) => writes.includes(name!) && hashKeys.includes(key!)),
    );
    // open twice + join twice + updateSettings + startRace + setPhase (#166): seven write
    // transactions, nothing outside them.
    expect(writing).toHaveLength(7);
    for (const { atomic, commands } of writing) {
      expect(atomic).toBe(true);
      for (const key of hashKeys)
        expect(commands).toContainEqual(["expire", key, String(ROOM_TTL_S)]);
    }
    for (const ttl of await ttls(lobbyId)) expect(ttl).toBeGreaterThan(0);
    // #568: the settings field is written in the open transaction, next to both TTLs.
    expect(writing[0]!.commands).toContainEqual([
      "hsetnx",
      roomKey(lobbyId),
      "settings",
      JSON.stringify(settings),
    ]);
    // #101: updateSettings writes the merged settings in a MULTI next to both TTLs.
    expect(writing[4]!.commands).toContainEqual([
      "hset",
      roomKey(lobbyId),
      "settings",
      JSON.stringify({ ...settings, timerS: 60 }),
    ]); // #166: the race, its clock and its desks land in one MULTI, then each phase change.
    expect(writing[5]!.commands).toContainEqual([
      "hset",
      roomKey(lobbyId),
      "phase",
      "countdown",
      "raceId",
      race.raceId,
      "t0",
      String(race.t0),
      "endAt",
      String(race.t0 + 60_000),
      "race",
      JSON.stringify(race),
      "desks",
      "[]",
    ]);
    expect(writing[6]!.commands).toContainEqual(["hset", roomKey(lobbyId), "phase", "running"]);
  });

  it("open repairs a half-written room hash without overwriting its fields", async () => {
    const { registry } = setup();
    const lobbyId = lobby();
    await redis.hset(roomKey(lobbyId), { openedAt: "1", code: "OLD1" });
    expect(await registry.open({ lobbyId, code: "NEW2", hostUserId: "host", settings })).toEqual({
      created: false,
      room: { roomId: lobbyId, code: "OLD1", phase: "waiting", settings, race: null },
    });
    expect(await redis.hgetall(roomKey(lobbyId))).toEqual({
      openedAt: "1",
      code: "OLD1",
      hostUserId: "host",
      phase: "waiting",
      settings: JSON.stringify(settings),
    });
    expect(await redis.ttl(roomKey(lobbyId))).toBeGreaterThan(0);
  });

  it("surfaces a command error inside the transaction instead of ignoring it", async () => {
    const { registry } = setup();
    const lobbyId = lobby();
    await redis.set(roomKey(lobbyId), "not a hash", "EX", 60);
    await expect(
      registry.open({ lobbyId, code: "ABCD", hostUserId: "host", settings }),
    ).rejects.toThrow(/WRONGTYPE/);
  });
});
