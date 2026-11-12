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
import {
  blockedKey,
  desksKey,
  ENDED_GRACE_TTL_S,
  membersKey,
  resumeIndexKey,
  resumeKey,
  ROOM_TTL_S,
  roomKey,
  ROOMS_KEY,
  traceKey,
  VOID_TTL_S,
} from "./keys";
import {
  createRoomRegistry,
  promoteHost,
  ROOM_SEATS,
  type RaceDesk,
  type RoomRegistry,
} from "./registry";

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
  avatar: null,
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
  const ids = opened.splice(0);
  const keys = ids.flatMap((id) => [roomKey(id), membersKey(id), blockedKey(id)]);
  if (keys.length) await redis.del(...keys);
  if (ids.length) await redis.srem(ROOMS_KEY, ...ids);
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

describe("room registry: botLevels (#366)", () => {
  it("maps each bot desk of the members hash to its level; humans and unknown rooms give nothing", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    await registry.join(lobbyId, { userId: "host", name: "Ada" });
    expect(await registry.botLevels(lobbyId)).toEqual(new Map());
    await registry.setBots(lobbyId, [{ level: "recruit" }, { level: "major" }]);
    expect(await registry.botLevels(lobbyId)).toEqual(
      new Map([
        [2, "recruit"],
        [3, "major"],
      ]),
    );
    expect(await registry.botLevels(`lob_${randomUUID()}`)).toEqual(new Map());
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
    const desks = results.map((r) => (r.ok ? (r.desk ?? 0) : 0)).sort((x, y) => x - y);
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

describe("room registry: member avatars (#730 C1)", () => {
  it("addresses a member's portrait with its user id and the token's avatar version", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    await registry.join(lobbyId, { userId: "a", name: "Ada", avatar: 3 });
    await registry.join(lobbyId, { userId: "b", name: "Bob", avatar: null });
    await registry.join(lobbyId, { userId: "c", name: "Cy" });
    const members = (await registry.members(lobbyId)) ?? [];
    expect(members.map((x) => x.avatar)).toEqual([{ userId: "a", v: 3 }, null, null]);
    for (const member of members) expect(memberSchema.safeParse(member).success).toBe(true);
  });

  it("a rejoin takes the avatar version of its new token (approved, replaced or revoked since)", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    await registry.join(lobbyId, { userId: "a", name: "Ada", avatar: null });
    const again = await registry.join(lobbyId, { userId: "a", name: "Ada", avatar: 4 });
    expect(again.ok && again.members[0]?.avatar).toEqual({ userId: "a", v: 4 });
    const revoked = await registry.join(lobbyId, { userId: "a", name: "Ada", avatar: null });
    expect(revoked.ok && revoked.members[0]?.avatar).toBeNull();
  });

  it("bots have no avatar", async () => {
    const { registry } = setup();
    const lobbyId = lobby();
    await registry.open({
      lobbyId,
      code: "ABCD",
      hostUserId: "host",
      settings: { ...settings, bots: [{ level: "major" }] },
    });
    await registry.join(lobbyId, { userId: "host", name: "Ada", avatar: 2 });
    const members = (await registry.members(lobbyId)) ?? [];
    expect(members.find((x) => x.isBot)?.avatar).toBeNull();
    expect(members.find((x) => !x.isBot)?.avatar).toEqual({ userId: "host", v: 2 });
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
      kept: false,
    });
    expect(await registry.leave(lobbyId, "b")).toEqual({ members: [], closed: true, kept: false });
    expect(await redis.exists(roomKey(lobbyId), membersKey(lobbyId))).toBe(0);
    expect(await registry.members(lobbyId)).toBeNull();
    expect(registry.count()).toBe(before - 1);
  });

  it("leaving an unknown room closes nothing", async () => {
    const { registry } = setup();
    expect(await registry.leave(lobby(), "a")).toEqual({ members: [], closed: false, kept: false });
  });

  it("a non-member leaving an empty room does not close it", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    expect(await registry.leave(lobbyId, "stranger")).toEqual({
      members: [],
      closed: false,
      kept: false,
    });
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
      code: "ABCD",
      hostUserId: "host",
      phase: "waiting",
      settings,
      race: null,
      endAt: null,
      seated,
      desks: null,
      raceId: null,
      endReason: null,
      autoStartAt: null,
    });
    expect(await registry.room(`lob_${randomUUID()}`)).toBeNull();

    // #814: the pending automatic start, written under the room's TTL, deleted by a start.
    await registry.setAutoStart(lobbyId, race.t0 + 45_000);
    expect(await registry.room(lobbyId)).toMatchObject({ autoStartAt: race.t0 + 45_000 });
    expect(await redis.ttl(roomKey(lobbyId))).toBeGreaterThan(0);
    await registry.setAutoStart(lobbyId, null);
    expect(await redis.hexists(roomKey(lobbyId), "autoStartAt")).toBe(0);
    await registry.setAutoStart(lobbyId, race.t0 + 45_000);

    await registry.startRace(lobbyId, { race, endAt: race.t0 + 60_000, desks: seated });
    expect(await redis.hexists(roomKey(lobbyId), "autoStartAt")).toBe(0);
    expect(await registry.room(lobbyId)).toMatchObject({
      phase: "countdown",
      race,
      endAt: race.t0 + 60_000,
      desks: seated,
      raceId: race.raceId,
      endReason: null,
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

describe("room registry: recovery writes (#204 C6)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("indexes the room in open's MULTI and refreshes the index TTL with every room write", async () => {
    const { registry } = setup();
    const lobbyId = lobby();
    const groups = recordCommands();
    await registry.open({ lobbyId, code: "ABCD", hostUserId: "host", settings });
    await registry.join(lobbyId, { userId: "a", name: "Ada" });
    await registry.setPhase(lobbyId, "running");
    const atomic = groups().filter((g) => g.atomic);
    expect(atomic).toHaveLength(3);
    expect(atomic[0]!.commands).toContainEqual(["sadd", ROOMS_KEY, lobbyId]);
    for (const { commands } of atomic) {
      expect(commands).toContainEqual(["expire", ROOMS_KEY, String(ROOM_TTL_S)]);
    }
    expect(await redis.sismember(ROOMS_KEY, lobbyId)).toBe(1);
    expect(await redis.ttl(ROOMS_KEY)).toBeGreaterThan(0);
  });

  it("closing the room removes it from the index in the same MULTI as its keys", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    await registry.join(lobbyId, { userId: "a", name: "Ada" });
    const groups = recordCommands();
    expect((await registry.leave(lobbyId, "a")).closed).toBe(true);
    const closing = groups().find(({ commands }) => commands.some(([name]) => name === "srem"));
    expect(closing?.atomic).toBe(true);
    expect(closing!.commands).toContainEqual(["srem", ROOMS_KEY, lobbyId]);
    expect(
      closing!.commands.some(([name, key]) => name === "del" && key === roomKey(lobbyId)),
    ).toBe(true);
    expect(await redis.sismember(ROOMS_KEY, lobbyId)).toBe(0);
  });

  it("voidRoom writes its fields in one MULTI with VOID_TTL_S on both hashes and drops the mirror", async () => {
    const { clock, registry } = setup();
    const lobbyId = await openRoom(registry);
    await registry.join(lobbyId, { userId: "a", name: "Ada" });
    await registry.join(lobbyId, { userId: "b", name: "Bob" });
    const desks = [
      { desk: 1, userId: "a", name: "Ada", isBot: false },
      { desk: 2, userId: "b", name: "Bob", isBot: false },
    ];
    await registry.startRace(lobbyId, { race, endAt: race.t0 + 60_000, desks });
    await registry.setPhase(lobbyId, "running");
    await redis
      .multi()
      .hset(desksKey(lobbyId), "1", "{}")
      .expire(desksKey(lobbyId), 60)
      .rpush(traceKey(lobbyId, 2), "{}")
      .expire(traceKey(lobbyId, 2), 60)
      .set(resumeKey(`k-${lobbyId}`), "{}", "EX", 60)
      .hset(resumeIndexKey(lobbyId), "a", `k-${lobbyId}`)
      .expire(resumeIndexKey(lobbyId), 60)
      .exec();

    const groups = recordCommands();
    expect(await registry.voidRoom(lobbyId)).toEqual({ lost: false });
    const writing = groups().filter(({ commands }) =>
      commands.some(([name]) => ["hset", "hdel", "del"].includes(name!)),
    );
    expect(writing).toHaveLength(1);
    expect(writing[0]!.atomic).toBe(true);
    const { commands } = writing[0]!;
    expect(commands).toContainEqual([
      "hset",
      roomKey(lobbyId),
      "phase",
      "ended",
      "endReason",
      "void",
      "endedAt",
      String(clock.now()),
    ]);
    expect(commands).toContainEqual([
      "hdel",
      roomKey(lobbyId),
      "race",
      "t0",
      "endAt",
      "desks",
      "owner",
    ]);
    expect(commands).toContainEqual(["expire", roomKey(lobbyId), String(VOID_TTL_S)]);
    expect(commands).toContainEqual(["expire", membersKey(lobbyId), String(VOID_TTL_S)]);

    const state = await registry.room(lobbyId);
    expect(state).toMatchObject({
      phase: "ended",
      endReason: "void",
      raceId: race.raceId,
      race: null,
      endAt: null,
      desks: null,
    });
    expect(state!.seated).toHaveLength(2);
    expect(
      await redis.exists(
        desksKey(lobbyId),
        traceKey(lobbyId, 2),
        resumeKey(`k-${lobbyId}`),
        resumeIndexKey(lobbyId),
      ),
    ).toBe(0);
    for (const ttl of await ttls(lobbyId)) {
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(VOID_TTL_S);
    }
  });

  it("voidRoom on a room whose hash is gone deletes its leftovers and drops it from count", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    await registry.join(lobbyId, { userId: "a", name: "Ada" });
    const before = registry.count();
    await redis.del(roomKey(lobbyId));
    expect(await registry.voidRoom(lobbyId, [1])).toEqual({ lost: true });
    expect(registry.count()).toBe(before - 1);
    expect(await redis.exists(roomKey(lobbyId), membersKey(lobbyId))).toBe(0);
    expect(await redis.sismember(ROOMS_KEY, lobbyId)).toBe(0);
  });
});

// #143 Race again: the ended room outlives its last human, admits its members back (same desk
// when free) and the next start replaces every field and key of the previous race.
describe("room registry: race again (#143)", () => {
  const raced: RaceDesk[] = [
    { desk: 1, userId: "host", name: "Ada", isBot: false },
    { desk: 2, userId: "b", name: "Bob", isBot: false },
    { desk: 3, userId: "c", name: "Cy", isBot: false },
  ];

  async function endedRoom(registry: RoomRegistry) {
    const lobbyId = await openRoom(registry);
    for (const { userId, name } of raced) await registry.join(lobbyId, { userId: userId!, name });
    await registry.startRace(lobbyId, { race, endAt: race.t0 + 60_000, desks: raced });
    await registry.setPhase(lobbyId, "running");
    await registry.setPhase(lobbyId, "ended");
    return lobbyId;
  }

  it("the last human leaving an ended room keeps it under ENDED_GRACE_TTL_S; a join refreshes ROOM_TTL_S", async () => {
    const { registry } = setup();
    const lobbyId = await endedRoom(registry);
    await redis.rpush(traceKey(lobbyId, 2), "{}");
    await redis.hset(desksKey(lobbyId), "2", "{}");
    expect(await registry.leave(lobbyId, "b")).toMatchObject({ closed: false, kept: false });
    expect(await registry.leave(lobbyId, "c")).toMatchObject({ closed: false, kept: false });
    expect(await registry.leave(lobbyId, "host")).toEqual({
      members: [],
      closed: false,
      kept: true,
    });

    expect(await redis.hget(roomKey(lobbyId), "phase")).toBe("ended");
    const ttl = await redis.ttl(roomKey(lobbyId));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(ENDED_GRACE_TTL_S);
    // No bot seated: the emptied members hash is gone (Redis drops an empty hash).
    expect(await redis.exists(membersKey(lobbyId))).toBe(0);
    // The race's mirror is never read back once ended: it goes now, not with the grace TTL.
    expect(await redis.exists(desksKey(lobbyId), traceKey(lobbyId, 2))).toBe(0);
    expect(registry.count()).toBeGreaterThan(0);

    expect(await registry.join(lobbyId, { userId: "b", name: "Bob" })).toMatchObject({ ok: true });
    for (const ttl of await ttls(lobbyId)) expect(ttl).toBeGreaterThan(ENDED_GRACE_TTL_S);
  });

  it("a waiting room still closes on its last human", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    await registry.join(lobbyId, { userId: "host", name: "Ada" });
    expect(await registry.leave(lobbyId, "host")).toEqual({
      members: [],
      closed: true,
      kept: false,
    });
    expect(await redis.exists(roomKey(lobbyId))).toBe(0);
  });

  it("an ended room seats a returning racer at the desk it raced at", async () => {
    const { registry } = setup();
    const lobbyId = await endedRoom(registry);
    await registry.leave(lobbyId, "b");
    await registry.leave(lobbyId, "c");
    expect(await registry.join(lobbyId, { userId: "c", name: "Cy" })).toMatchObject({
      ok: true,
      desk: 3,
      room: { phase: "ended" },
    });
    expect(await registry.join(lobbyId, { userId: "b", name: "Bob" })).toMatchObject({
      ok: true,
      desk: 2,
    });
  });

  it("an ended room seats a late joiner, never at the free desk of a racer who left (#732)", async () => {
    const { registry } = setup();
    const lobbyId = await endedRoom(registry);
    await registry.leave(lobbyId, "b");
    const late = await registry.join(lobbyId, { userId: "late", name: "Lou" });
    // Desks 1 and 3 are seated, desk 2 is Bob's from the last race: Lou takes the next free one.
    expect(late).toMatchObject({ ok: true, desk: 4, room: { phase: "ended" } });
    expect(await registry.hasMember(lobbyId, "late")).toBe(true);
    expect(await registry.join(lobbyId, { userId: "b", name: "Bob" })).toMatchObject({
      ok: true,
      desk: 2,
    });
  });

  it("the room seats at most ROOM_SEATS typists: the next stranger is room-full, waiting and ended (#732)", async () => {
    const { registry } = setup();
    const waiting = await openRoom(registry);
    for (let i = 1; i <= ROOM_SEATS; i++) {
      expect(await registry.join(waiting, { userId: `u${i}`, name: `U${i}` })).toMatchObject({
        ok: true,
      });
    }
    expect(await registry.join(waiting, { userId: "extra", name: "X" })).toEqual({
      ok: false,
      reason: "room-full",
    });
    expect(await registry.hasMember(waiting, "extra")).toBe(false);
    // a member at the cap (a second tab) still comes in
    expect(await registry.join(waiting, { userId: "u3", name: "U3" })).toMatchObject({
      ok: true,
      desk: 3,
    });

    const ended = await endedRoom(registry);
    for (let i = 4; i <= ROOM_SEATS; i++) {
      expect(await registry.join(ended, { userId: `l${i}`, name: `L${i}` })).toMatchObject({
        ok: true,
      });
    }
    expect(await registry.join(ended, { userId: "extra", name: "X" })).toEqual({
      ok: false,
      reason: "room-full",
    });
    // a racer of the last race who left and came back while the room is full of others: still a seat
    await registry.leave(ended, "b");
    await registry.join(ended, { userId: "l99", name: "L99" });
    expect(await registry.join(ended, { userId: "b", name: "Bob" })).toEqual({
      ok: false,
      reason: "room-full",
    });
    expect(await registry.join(ended, { userId: "c", name: "Cy" })).toMatchObject({ ok: true });
  });

  it("bots take desks: 30 desks of typists and bots refuse a stranger and the next bot (#732)", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    const typists = 10;
    for (let i = 1; i <= typists; i++)
      await registry.join(lobbyId, { userId: i === 1 ? "host" : `u${i}`, name: `U${i}` });
    const bots = (n: number) => Array.from({ length: n }, () => ({ level: "clerk" as const }));
    expect(
      await registry.updateSettings(lobbyId, "host", { bots: bots(ROOM_SEATS - typists) }),
    ).toMatchObject({
      ok: true,
    });
    expect(await registry.members(lobbyId)).toHaveLength(ROOM_SEATS);
    // the next stranger: every desk is taken
    expect(await registry.join(lobbyId, { userId: "extra", name: "X" })).toEqual({
      ok: false,
      reason: "room-full",
    });
    // one more bot: refused, the room keeps its bots
    expect(
      await registry.updateSettings(lobbyId, "host", { bots: bots(ROOM_SEATS - typists + 1) }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(await registry.setBots(lobbyId, bots(ROOM_SEATS - typists + 1))).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await registry.members(lobbyId)).toHaveLength(ROOM_SEATS);
    // a member (a second tab) still comes in at the cap; removing a bot is always allowed
    expect(await registry.join(lobbyId, { userId: "u2", name: "U2" })).toMatchObject({
      ok: true,
      desk: 2,
    });
    expect(
      await registry.updateSettings(lobbyId, "host", { bots: bots(ROOM_SEATS - typists - 1) }),
    ).toMatchObject({
      ok: true,
    });
    expect(await registry.join(lobbyId, { userId: "extra", name: "X" })).toMatchObject({
      ok: true,
    });
  });

  it("a started room still refuses a user who is not a member (in-progress)", async () => {
    const { registry } = setup();
    const lobbyId = await endedRoom(registry);
    for (const phase of ["countdown", "running"] as const) {
      await registry.setPhase(lobbyId, phase);
      expect(await registry.join(lobbyId, { userId: "late", name: "Lou" })).toEqual({
        ok: false,
        reason: "in-progress",
      });
    }
    expect(await registry.hasMember(lobbyId, "late")).toBe(false);
  });

  it("startRace replaces the previous race: endReason, endedAt, the desks mirror and the old trace lists go", async () => {
    const { registry } = setup();
    const lobbyId = await endedRoom(registry);
    await redis.hset(roomKey(lobbyId), { endReason: "void", endedAt: "1" });
    await redis.hset(desksKey(lobbyId), "3", "{}");
    for (const desk of [1, 2, 3]) await redis.rpush(traceKey(lobbyId, desk), "{}");
    await registry.leave(lobbyId, "c");

    const next = { ...race, raceId: "0e7a3c1b-5d2f-4a6b-8c9d-1e2f3a4b5c6d", t0: race.t0 + 120_000 };
    const desks = raced.slice(0, 2);
    await registry.startRace(lobbyId, { race: next, endAt: next.t0 + 60_000, desks });

    expect(await registry.room(lobbyId)).toMatchObject({
      phase: "countdown",
      race: next,
      raceId: next.raceId,
      endAt: next.t0 + 60_000,
      desks,
      endReason: null,
    });
    expect(await redis.hexists(roomKey(lobbyId), "endedAt")).toBe(0);
    expect(
      await redis.exists(
        desksKey(lobbyId),
        traceKey(lobbyId, 1),
        traceKey(lobbyId, 2),
        traceKey(lobbyId, 3),
      ),
    ).toBe(0);
    for (const ttl of await ttls(lobbyId)) expect(ttl).toBeGreaterThan(ENDED_GRACE_TTL_S);
  });
});

describe("room registry: setLobbyType (#815 C2)", () => {
  afterEach(() => vi.restoreAllMocks());

  async function seededRoom(registry: RoomRegistry) {
    const lobbyId = lobby();
    await registry.open({ lobbyId, code: "ABCD", hostUserId: "host", settings: custom });
    await registry.join(lobbyId, { userId: "host", name: "Ada" });
    await registry.join(lobbyId, { userId: "b", name: "Bob" });
    return lobbyId;
  }

  it("rewrites only settings.lobbyType of a waiting room, in one MULTI with the room's TTLs", async () => {
    const { registry } = setup();
    const lobbyId = await seededRoom(registry);
    const seatsBefore = await redis.hgetall(membersKey(lobbyId));
    const groups = recordCommands();
    expect(await registry.setLobbyType(lobbyId, "public")).toEqual({
      ok: true,
      changed: true,
      settings: { ...custom, lobbyType: "public" },
    });
    expect(await registry.settings(lobbyId)).toEqual({ ...custom, lobbyType: "public" });
    // Every seat untouched, bots included.
    expect(await redis.hgetall(membersKey(lobbyId))).toEqual(seatsBefore);
    const writing = groups().filter(({ commands }) =>
      commands.some(([name]) => name === "hset" || name === "hdel"),
    );
    expect(writing).toHaveLength(1);
    expect(writing[0]!.atomic).toBe(true);
    expect(writing[0]!.commands).toContainEqual([
      "hset",
      roomKey(lobbyId),
      "settings",
      JSON.stringify({ ...custom, lobbyType: "public" }),
    ]);
    for (const key of [roomKey(lobbyId), membersKey(lobbyId)])
      expect(writing[0]!.commands).toContainEqual(["expire", key, String(ROOM_TTL_S)]);
    for (const ttl of await ttls(lobbyId)) expect(ttl).toBeGreaterThan(0);
  });

  it("the value already stored answers ok, changed: false, and writes nothing", async () => {
    const { registry } = setup();
    const lobbyId = await seededRoom(registry);
    const groups = recordCommands();
    expect(await registry.setLobbyType(lobbyId, "private")).toEqual({
      ok: true,
      changed: false,
      settings: custom,
    });
    expect(groups().some(({ commands }) => commands.some(([name]) => name === "hset"))).toBe(false);
  });

  it.each(["countdown", "running", "ended"] as const)(
    "a room in %s answers not-waiting and changes nothing",
    async (phase) => {
      const { registry } = setup();
      const lobbyId = await seededRoom(registry);
      await registry.withRoom(lobbyId, () => registry.setPhase(lobbyId, phase));
      expect(await registry.setLobbyType(lobbyId, "public")).toEqual({
        ok: false,
        reason: "not-waiting",
      });
      expect(await registry.settings(lobbyId)).toEqual(custom);
    },
  );

  it("an unknown room answers no-room and opens nothing", async () => {
    const { registry } = setup();
    const lobbyId = lobby();
    expect(await registry.setLobbyType(lobbyId, "public")).toEqual({
      ok: false,
      reason: "no-room",
    });
    expect(await redis.exists(roomKey(lobbyId), membersKey(lobbyId))).toBe(0);
  });

  it("runs in the room's queue: after a pending settings patch, never over it", async () => {
    const { registry } = setup();
    const lobbyId = await seededRoom(registry);
    const [, typed] = await Promise.all([
      registry.updateSettings(lobbyId, "host", { timerS: 60 }),
      registry.setLobbyType(lobbyId, "public"),
    ]);
    expect(typed).toMatchObject({ ok: true, settings: { timerS: 60, lobbyType: "public" } });
    expect(await registry.settings(lobbyId)).toEqual({
      ...custom,
      timerS: 60,
      lobbyType: "public",
    });
  });
});

// #133: the host removes a human; the registry authorises, then blocks the user id for the room's
// life (the edge frees the seat through `leaveRoom`). The block list is the one `join` and the
// handshake consult (`isBlocked`).
describe("room registry: host removal and block list (#133 C2, C3)", () => {
  async function seated(registry: RoomRegistry, bots: RaceSettings["bots"] = []) {
    const lobbyId = await openRoom(registry);
    await registry.join(lobbyId, { userId: "host", name: "Ada" });
    await registry.join(lobbyId, { userId: "b", name: "Bob" });
    if (bots.length) await registry.setBots(lobbyId, bots);
    return lobbyId;
  }

  it("the host removes a human desk: the user is blocked under the room's TTL, the seat is untouched", async () => {
    const { registry } = setup();
    const lobbyId = await seated(registry);
    expect(await registry.isBlocked(lobbyId, "b")).toBe(false);
    expect(await registry.kick(lobbyId, "host", 2)).toEqual({ ok: true, userId: "b" });
    expect(await registry.isBlocked(lobbyId, "b")).toBe(true);
    expect(await registry.isBlocked(lobbyId, "host")).toBe(false);
    expect(await redis.smembers(blockedKey(lobbyId))).toEqual(["b"]);
    const ttl = await redis.ttl(blockedKey(lobbyId));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(ROOM_TTL_S);
    // The edge frees the seat with `leaveRoom`; the registry's kick only authorises and blocks.
    expect(await registry.hasMember(lobbyId, "b")).toBe(true);
  });

  it("refuses not-host, no-such-desk, is-bot, self and no-room; nothing is blocked", async () => {
    const { registry } = setup();
    const lobbyId = await seated(registry, [{ level: "clerk" }]);
    const botDesk = (await registry.members(lobbyId))!.find((m) => m.isBot)!.desk;
    expect(await registry.kick(lobbyId, "b", 1)).toEqual({ ok: false, reason: "not-host" });
    expect(await registry.kick(lobbyId, "host", 9)).toEqual({ ok: false, reason: "no-such-desk" });
    expect(await registry.kick(lobbyId, "host", botDesk)).toEqual({ ok: false, reason: "is-bot" });
    expect(await registry.kick(lobbyId, "host", 1)).toEqual({ ok: false, reason: "self" });
    expect(await registry.kick(lobby(), "host", 2)).toEqual({ ok: false, reason: "no-room" });
    expect(await redis.exists(blockedKey(lobbyId))).toBe(0);
  });

  it("only while waiting or ended: countdown and running answer not-waiting", async () => {
    const { registry } = setup();
    const lobbyId = await seated(registry);
    const desks: RaceDesk[] = [
      { desk: 1, userId: "host", name: "Ada", isBot: false },
      { desk: 2, userId: "b", name: "Bob", isBot: false },
    ];
    await registry.startRace(lobbyId, { race, endAt: race.t0 + 60_000, desks });
    expect(await registry.kick(lobbyId, "host", 2)).toEqual({ ok: false, reason: "not-waiting" });
    await registry.setPhase(lobbyId, "running");
    expect(await registry.kick(lobbyId, "host", 2)).toEqual({ ok: false, reason: "not-waiting" });
    await registry.setPhase(lobbyId, "ended");
    expect(await registry.kick(lobbyId, "host", 2)).toEqual({ ok: true, userId: "b" });
  });

  it("join refuses a blocked user with removed, in waiting and ended; another lobby's block does not apply", async () => {
    const { registry } = setup();
    const lobbyId = await seated(registry);
    const other = await seated(registry);
    await registry.kick(lobbyId, "host", 2);
    await registry.leave(lobbyId, "b");
    expect(await registry.join(lobbyId, { userId: "b", name: "Bob" })).toEqual({
      ok: false,
      reason: "removed",
    });
    expect(await registry.hasMember(lobbyId, "b")).toBe(false);
    // `other` never removed b: b keeps its seat there and joins again.
    expect(await registry.isBlocked(other, "b")).toBe(false);
    expect(await registry.join(other, { userId: "b", name: "Bob" })).toMatchObject({ ok: true });
  });

  it("block is the extension point: any entry refuses the join, whoever added it", async () => {
    const { registry } = setup();
    const lobbyId = await seated(registry);
    await registry.block(lobbyId, "c");
    expect(await registry.join(lobbyId, { userId: "c", name: "Cy" })).toEqual({
      ok: false,
      reason: "removed",
    });
  });

  it("every room write refreshes the block list's TTL with the room's", async () => {
    const { registry } = setup();
    const lobbyId = await seated(registry);
    await registry.kick(lobbyId, "host", 2);
    await redis.expire(blockedKey(lobbyId), 30);
    await registry.updateSettings(lobbyId, "host", { timerS: 60 });
    expect(await redis.ttl(blockedKey(lobbyId))).toBeGreaterThan(30);
  });

  it("a closed room drops its block list with its other keys", async () => {
    const { registry } = setup();
    const lobbyId = await seated(registry);
    await registry.kick(lobbyId, "host", 2);
    await registry.leave(lobbyId, "b");
    expect((await registry.leave(lobbyId, "host")).closed).toBe(true);
    expect(await redis.exists(blockedKey(lobbyId))).toBe(0);
  });

  it("a voided room drops its block list, whether its hash survived or is gone", async () => {
    const { registry } = setup();
    for (const lost of [false, true]) {
      const lobbyId = await seated(registry);
      await registry.kick(lobbyId, "host", 2);
      if (lost) await redis.del(roomKey(lobbyId));
      expect(await registry.voidRoom(lobbyId)).toEqual({ lost });
      expect(await redis.exists(blockedKey(lobbyId))).toBe(0);
    }
  });

  it("an ended room kept for Race again keeps its block list under the same grace TTL", async () => {
    const { registry } = setup();
    const lobbyId = await seated(registry);
    const desks: RaceDesk[] = [
      { desk: 1, userId: "host", name: "Ada", isBot: false },
      { desk: 2, userId: "b", name: "Bob", isBot: false },
    ];
    await registry.startRace(lobbyId, { race, endAt: race.t0 + 60_000, desks });
    await registry.setPhase(lobbyId, "ended");
    await registry.kick(lobbyId, "host", 2);
    await registry.leave(lobbyId, "b");
    expect((await registry.leave(lobbyId, "host")).kept).toBe(true);
    const ttl = await redis.ttl(blockedKey(lobbyId));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(ENDED_GRACE_TTL_S);
  });
});

describe("room registry: host promotion (#137 C1, C2)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("promoteHost: the earliest-joined human, ties by the lowest desk, never a bot, null with no human", () => {
    const human = (desk: number, joinedAt?: number) => ({ desk, joinedAt });
    const bot = (desk: number) => ({ desk, isBot: true, joinedAt: 0 });
    expect(
      promoteHost([
        ["b", human(2, 300)],
        ["a", human(5, 200)],
        ["bot:3", bot(3)],
      ]),
    ).toEqual({ userId: "a", desk: 5 });
    expect(
      promoteHost([
        ["c", human(7, 100)],
        ["a", human(4, 100)],
      ]),
    ).toEqual({ userId: "a", desk: 4 });
    // a record written before #137 has no join time: it joined before any that has one
    expect(
      promoteHost([
        ["new", human(2, 100)],
        ["old", human(6)],
      ]),
    ).toEqual({ userId: "old", desk: 6 });
    expect(promoteHost([["bot:2", bot(2)]])).toBeNull();
    expect(promoteHost([])).toBeNull();
  });

  it("seats record their join time; a second join of a member keeps it", async () => {
    const { registry, clock } = setup();
    const lobbyId = await openRoom(registry);
    const t0 = clock.now();
    await registry.join(lobbyId, { userId: "a", name: "Ada" });
    clock.advance(1_000);
    await registry.join(lobbyId, { userId: "a", name: "Ada" });
    const seat = JSON.parse((await redis.hget(membersKey(lobbyId), "a"))!) as object;
    expect(seat).toEqual({ desk: 1, name: "Ada", joinedAt: t0 });
  });

  /** host at desk 1, then B (desk 2) joins after A (desk 3 freed and retaken): A joined first. */
  async function hosted() {
    const { registry, clock } = setup();
    const lobbyId = await openRoom(registry, lobby(), "host");
    await registry.join(lobbyId, { userId: "host", name: "Hal" });
    clock.advance(10);
    await registry.join(lobbyId, { userId: "x", name: "Xan" });
    clock.advance(10);
    await registry.join(lobbyId, { userId: "a", name: "Ada" });
    clock.advance(10);
    await registry.leave(lobbyId, "x");
    await registry.join(lobbyId, { userId: "b", name: "Bea" });
    return { registry, clock, lobbyId };
  }

  it("the host's leave promotes the earliest-joined human in the leave's MULTI; the roster follows", async () => {
    const { registry, lobbyId } = await hosted();
    await registry.setBots(lobbyId, [{ level: "clerk" }]);
    const groups = recordCommands();
    const left = await registry.leave(lobbyId, "host");
    expect(left.newHost).toEqual({ userId: "a", desk: 3 });
    expect(left.closed).toBe(false);
    expect(left.members.filter((x) => x.isHost).map((x) => x.name)).toEqual(["Ada"]);
    expect(await redis.hget(roomKey(lobbyId), "hostUserId")).toBe("a");
    const write = groups().find(({ commands }) => commands.some(([name]) => name === "hdel"))!;
    expect(write.atomic).toBe(true);
    expect(write.commands).toContainEqual(["hset", roomKey(lobbyId), "hostUserId", "a"]);
    expect(write.commands).toContainEqual(["expire", roomKey(lobbyId), String(ROOM_TTL_S)]);
    // the new host's patch is accepted, the old host's refused
    expect(await registry.updateSettings(lobbyId, "a", { timerS: 60 })).toMatchObject({ ok: true });
    expect(await registry.updateSettings(lobbyId, "host", { timerS: 90 })).toEqual({
      ok: false,
      reason: "not-host",
    });
  });

  it("a guest's leave promotes nobody; the host leaving with only bots left closes the room", async () => {
    const { registry, lobbyId } = await hosted();
    expect((await registry.leave(lobbyId, "b")).newHost).toBeUndefined();
    expect(await redis.hget(roomKey(lobbyId), "hostUserId")).toBe("host");

    const solo = await openRoom(registry, lobby(), "h");
    await registry.join(solo, { userId: "h", name: "Hal" });
    await registry.setBots(solo, [{ level: "clerk" }]);
    expect(await registry.leave(solo, "h")).toEqual({ members: [], closed: true, kept: false });
  });

  it("the host's leave of an ended room promotes too (releaseDropped, a removal)", async () => {
    const { registry, lobbyId } = await hosted();
    await registry.withRoom(lobbyId, () => registry.setPhase(lobbyId, "ended"));
    expect((await registry.leave(lobbyId, "host")).newHost).toEqual({ userId: "a", desk: 3 });
  });

  it("handOverHost: the host's desk gone mid-race passes the role while its seat stays", async () => {
    const { registry, lobbyId } = await hosted();
    await registry.withRoom(lobbyId, () => registry.setPhase(lobbyId, "running"));
    expect(await registry.handOverHost(lobbyId, "b")).toBeNull();
    const handed = await registry.handOverHost(lobbyId, "host");
    expect(handed?.newHost).toEqual({ userId: "a", desk: 3 });
    expect(handed?.members.map((x) => [x.name, x.isHost])).toEqual([
      ["Hal", false],
      ["Bea", false],
      ["Ada", true],
    ]);
    expect(await redis.hget(roomKey(lobbyId), "hostUserId")).toBe("a");
    expect(await redis.ttl(roomKey(lobbyId))).toBeGreaterThan(0);
    // already handed over: the old host no longer hosts, nothing more happens
    expect(await registry.handOverHost(lobbyId, "host")).toBeNull();
  });

  it("handOverHost: a host alone with bots keeps the role", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry, lobby(), "h");
    await registry.join(lobbyId, { userId: "h", name: "Hal" });
    await registry.setBots(lobbyId, [{ level: "clerk" }]);
    expect(await registry.handOverHost(lobbyId, "h")).toBeNull();
    expect(await redis.hget(roomKey(lobbyId), "hostUserId")).toBe("h");
  });
});

describe("room registry: sharedRoom (#65 C3)", () => {
  afterEach(() => vi.restoreAllMocks());

  // User ids unique per test: the shared test db holds other files' rooms and members.
  const users = () => {
    const run = randomUUID();
    return { a: `usr_${run}_a`, b: `usr_${run}_b`, c: `usr_${run}_c`, host: `usr_${run}_h` };
  };

  async function roomWith(registry: RoomRegistry, host: string, ...userIds: string[]) {
    const lobbyId = await openRoom(registry, lobby(), host);
    for (const userId of [host, ...userIds]) await registry.join(lobbyId, { userId, name: "Ada" });
    return lobbyId;
  }

  it("is true when one room's members hash holds both ids, in either order", async () => {
    const { registry } = setup();
    const u = users();
    await roomWith(registry, u.host, u.a, u.b);
    expect(await registry.sharedRoom(u.a, u.b)).toBe(true);
    expect(await registry.sharedRoom(u.b, u.a)).toBe(true);
    expect(await registry.sharedRoom(u.host, u.a)).toBe(true);
  });

  it("is false with no room, one of the two in a room, the two in different rooms, an unknown user", async () => {
    const { registry } = setup();
    const u = users();
    expect(await registry.sharedRoom(u.a, u.b)).toBe(false);
    await roomWith(registry, u.host, u.a);
    expect(await registry.sharedRoom(u.a, u.b)).toBe(false);
    await roomWith(registry, u.c, u.b);
    expect(await registry.sharedRoom(u.a, u.b)).toBe(false);
    expect(await registry.sharedRoom(u.a, `usr_${randomUUID()}`)).toBe(false);
  });

  it("refuses a bot key on either side without a lookup, even when the bot is seated", async () => {
    const { registry } = setup();
    const u = users();
    const lobbyId = await roomWith(registry, u.host, u.a);
    await registry.setBots(lobbyId, [{ level: "recruit" }]);
    expect(await redis.hexists(membersKey(lobbyId), "bot:3")).toBe(1);
    const groups = recordCommands();
    expect(await registry.sharedRoom("bot:3", u.a)).toBe(false);
    expect(await registry.sharedRoom(u.host, "bot:3")).toBe(false);
    expect(groups()).toEqual([]);
  });

  it("counts a room in any phase: waiting, countdown, running, ended, voided", async () => {
    const { registry } = setup();
    const u = users();
    const lobbyId = await roomWith(registry, u.host, u.a);
    const desks: RaceDesk[] = [
      { desk: 1, userId: u.host, name: "Ada", isBot: false },
      { desk: 2, userId: u.a, name: "Ada", isBot: false },
    ];
    expect(await registry.sharedRoom(u.host, u.a)).toBe(true);
    await registry.startRace(lobbyId, { race, endAt: race.t0 + 60_000, desks });
    expect((await registry.room(lobbyId))?.phase).toBe("countdown");
    expect(await registry.sharedRoom(u.host, u.a)).toBe(true);
    for (const phase of ["running", "ended"] as const) {
      await registry.setPhase(lobbyId, phase);
      expect(await registry.sharedRoom(u.host, u.a)).toBe(true);
    }
    await registry.setPhase(lobbyId, "running");
    expect(await registry.voidRoom(lobbyId)).toEqual({ lost: false });
    expect((await registry.room(lobbyId))?.endReason).toBe("void");
    expect(await registry.sharedRoom(u.host, u.a)).toBe(true);
  });

  it("a member who left no longer counts", async () => {
    const { registry } = setup();
    const u = users();
    const lobbyId = await roomWith(registry, u.host, u.a, u.b);
    await registry.leave(lobbyId, u.b);
    expect(await registry.sharedRoom(u.a, u.b)).toBe(false);
    expect(await registry.sharedRoom(u.a, u.host)).toBe(true);
  });

  it("reads Redis, not this process's cache: a fresh registry with no open room answers the same", async () => {
    const { registry } = setup();
    const u = users();
    await roomWith(registry, u.host, u.a);
    const fresh = setup().registry;
    expect(fresh.count()).toBe(0);
    expect(await fresh.sharedRoom(u.host, u.a)).toBe(true);
  });

  it("is read only: the rooms set, then one pipeline of HEXISTS pairs; no write, no EXPIRE", async () => {
    const { registry } = setup();
    const u = users();
    const first = await roomWith(registry, u.host, u.a);
    const second = await roomWith(registry, u.c, u.b);
    const pipelines = vi.spyOn(redis, "pipeline");
    const groups = recordCommands();
    expect(await registry.sharedRoom(u.a, u.b)).toBe(false);
    const sent = groups().map(({ commands }) => commands[0]!);
    expect(pipelines).toHaveBeenCalledTimes(1);
    expect(sent[0]).toEqual(["smembers", ROOMS_KEY]);
    const lookups = sent.slice(1);
    expect(lookups.every(([name]) => name === "hexists")).toBe(true);
    for (const lobbyId of [first, second])
      for (const userId of [u.a, u.b])
        expect(lookups).toContainEqual(["hexists", membersKey(lobbyId), userId]);
    expect(lookups.length % 2).toBe(0);
  });
});

describe("room registry: the host watches (#876)", () => {
  const ada = { name: "Ada" };
  async function watching(registry: RoomRegistry) {
    const lobbyId = await openRoom(registry);
    await registry.join(lobbyId, { userId: "host", name: "Ada" });
    await registry.join(lobbyId, { userId: "b", name: "Bob" });
    return lobbyId;
  }

  it("C2 the patch true frees the host's desk; hostUserId stays; the host joins with no desk", async () => {
    const { registry } = setup();
    const lobbyId = await watching(registry);
    const on = await registry.updateSettings(lobbyId, "host", { hostWatches: true }, ada);
    expect(on).toEqual({
      ok: true,
      settings: { ...settings, hostWatches: true },
      members: [m(2, "Bob", false)],
      hostDesk: null,
    });
    expect((await registry.room(lobbyId))?.hostUserId).toBe("host");
    const again = await registry.join(lobbyId, { userId: "host", name: "Ada" });
    expect(again).toMatchObject({ ok: true, desk: null, members: [m(2, "Bob", false)] });
    expect(await registry.members(lobbyId)).toEqual([m(2, "Bob", false)]);
  });

  it("C2 the watching host joins with no desk during the race it started (its seat view)", async () => {
    const { registry } = setup();
    const lobbyId = await watching(registry);
    await registry.updateSettings(lobbyId, "host", { hostWatches: true }, ada);
    await registry.setPhase(lobbyId, "running");
    expect(await registry.join(lobbyId, { userId: "host", name: "Ada" })).toMatchObject({
      ok: true,
      desk: null,
      members: [m(2, "Bob", false)],
    });
    expect(await registry.join(lobbyId, { userId: "c", name: "Cy" })).toEqual({
      ok: false,
      reason: "in-progress",
    });
  });

  it("C2 the patch false seats the host at the lowest free desk; refused room-full at 30 desks", async () => {
    const { registry } = setup();
    const lobbyId = await watching(registry);
    await registry.updateSettings(lobbyId, "host", { hostWatches: true }, ada);
    const back = await registry.updateSettings(lobbyId, "host", { hostWatches: false }, ada);
    expect(back).toMatchObject({ ok: true, hostDesk: 1, members: [m(1, "Ada", true), m(2, "Bob", false)] });

    await registry.updateSettings(lobbyId, "host", { hostWatches: true }, ada);
    for (let i = 0; i < ROOM_SEATS - 1; i++) {
      expect((await registry.join(lobbyId, { userId: `u${i}`, name: `U${i}` })).ok).toBe(true);
    }
    expect(await registry.members(lobbyId)).toHaveLength(ROOM_SEATS);
    const full = await registry.updateSettings(lobbyId, "host", { hostWatches: false }, ada);
    expect(full).toEqual({ ok: false, reason: "room-full" });
    expect((await registry.settings(lobbyId))?.hostWatches).toBe(true);
    expect(await registry.join(lobbyId, { userId: "late", name: "Late" })).toEqual({
      ok: false,
      reason: "room-full",
    });
  });

  it("C2 anyone else's patch is not-host", async () => {
    const { registry } = setup();
    const lobbyId = await watching(registry);
    expect(await registry.updateSettings(lobbyId, "b", { hostWatches: true }, ada)).toEqual({
      ok: false,
      reason: "not-host",
    });
  });

  it("C2 the room stays open with no seated human while the host watches", async () => {
    const { registry } = setup();
    const lobbyId = await watching(registry);
    await registry.updateSettings(lobbyId, "host", { hostWatches: true }, ada);
    expect(await registry.leave(lobbyId, "b")).toEqual({ members: [], closed: false, kept: false });
    expect(await registry.room(lobbyId)).not.toBeNull();
  });

  it("C4 the watching host's leave promotes the earliest-joined human and turns hostWatches off in the same write", async () => {
    const { registry, clock } = setup();
    const lobbyId = await openRoom(registry);
    await registry.join(lobbyId, { userId: "host", name: "Ada" });
    await registry.updateSettings(lobbyId, "host", { hostWatches: true }, ada);
    await registry.join(lobbyId, { userId: "b", name: "Bob" });
    clock.advance(1_000);
    await registry.join(lobbyId, { userId: "c", name: "Cy" });
    const left = await registry.leave(lobbyId, "host");
    expect(left).toEqual({
      members: [m(1, "Bob", true), m(2, "Cy", false)],
      closed: false,
      kept: false,
      newHost: { userId: "b", desk: 1 },
      settings: { ...settings, hostWatches: false },
    });
    const room = await registry.room(lobbyId);
    expect(room?.hostUserId).toBe("b");
    expect(room?.settings.hostWatches).toBe(false);
  });

  it("C4 the watching host's leave with no human seated closes the room", async () => {
    const { registry } = setup();
    const lobbyId = await openRoom(registry);
    await registry.join(lobbyId, { userId: "host", name: "Ada" });
    await registry.updateSettings(lobbyId, "host", { hostWatches: true }, ada);
    expect(await registry.leave(lobbyId, "host")).toEqual({
      members: [],
      closed: true,
      kept: false,
    });
    expect(await registry.room(lobbyId)).toBeNull();
  });
});
