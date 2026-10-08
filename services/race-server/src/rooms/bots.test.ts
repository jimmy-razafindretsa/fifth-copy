import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import {
  DEFAULT_RACE_SETTINGS,
  deskIdentity,
  memberSchema,
  PLAYER_STATUS_CODES,
  PROTOCOL_VERSION,
  type BotLevel,
  type HostSettingsAck,
  type RaceSettings,
} from "@fifth-copy/protocol";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createFakeClock } from "../clock";
import { createRedis } from "../redis/client";
import {
  boot,
  HOST_SUB,
  startedRace,
  track,
  typeKeys,
  until,
  type Booted,
} from "../testing/harness";
import { BOT_NAMES, botName, botUserId, isBotUserId, planBotSeats } from "./bots";
import { membersKey, ROOM_TTL_S, roomKey } from "./keys";
import { createRoomRegistry, type RoomRegistry } from "./registry";

// #156: bot seats in the waiting room (ADR 0006 point 3, 0008; ARCHITECTURE 7.1, 7.5). Pure helpers,
// then the registry against a real Redis, then the socket edge and a race through the harness.

let redis: Redis;
const opened: string[] = [];
let t: Booted | undefined;

beforeAll(async () => {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set: load the worktree .env (set -a; . ./.env)");
  redis = createRedis(url);
  await redis.connect();
});

afterEach(async () => {
  await t?.stop();
  t = undefined;
  const keys = opened.splice(0).flatMap((id) => [roomKey(id), membersKey(id)]);
  if (keys.length) await redis.del(...keys);
});

afterAll(() => redis?.disconnect());

const levels = (...xs: BotLevel[]) => xs.map((level) => ({ level }));

function setup() {
  return createRoomRegistry({ redis, clock: createFakeClock(Date.UTC(2026, 9, 7)) });
}

async function openRoom(registry: RoomRegistry, bots: { level: BotLevel }[] = []) {
  const lobbyId = `lob_${randomUUID()}`;
  opened.push(lobbyId);
  await registry.open({
    lobbyId,
    code: "ABCD",
    hostUserId: "host",
    settings: { ...DEFAULT_RACE_SETTINGS, bots },
  });
  return lobbyId;
}

async function records(lobbyId: string) {
  const raw = await redis.hgetall(membersKey(lobbyId));
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, JSON.parse(v) as unknown]));
}

const EMOJI = /\p{Extended_Pictographic}/u;

describe("bot names (C4)", () => {
  it("14 bots in one room have 14 distinct names from BOT_NAMES or suffixed ' II', no emoji", async () => {
    const registry = setup();
    const lobbyId = await openRoom(registry);
    await registry.join(lobbyId, { userId: "host", name: "Ada" });
    const set = await registry.setBots(lobbyId, levels(...Array<BotLevel>(14).fill("clerk")));
    expect(set.ok).toBe(true);
    const names = (await registry.members(lobbyId))!.filter((m) => m.isBot).map((m) => m.name);
    expect(names).toHaveLength(14);
    expect(new Set(names).size).toBe(14);
    for (const name of names) {
      expect(EMOJI.test(name)).toBe(false);
      const base = name.endsWith(" II") ? name.slice(0, -3) : name;
      expect(BOT_NAMES).toContain(base);
    }
  });

  it("cycles the list by desk with roman suffixes, so 30 desks never repeat a name", () => {
    expect(BOT_NAMES).toHaveLength(12);
    expect(new Set(BOT_NAMES).size).toBe(12);
    expect(botName(1)).toBe(BOT_NAMES[0]);
    expect(botName(13)).toBe(`${BOT_NAMES[0]} II`);
    expect(botName(25)).toBe(`${BOT_NAMES[0]} III`);
    const names = Array.from({ length: 30 }, (_, i) => botName(i + 1));
    expect(new Set(names).size).toBe(30);
  });

  it("bot ids live in their own space", () => {
    expect(botUserId(3)).toBe("bot:3");
    expect(isBotUserId("bot:3")).toBe(true);
    expect(isBotUserId("usr_host")).toBe(false);
  });
});

describe("bot seat plan", () => {
  it("adds at the lowest free desks, never desk 1, and removes the highest bot desks first", () => {
    expect(planBotSeats([], [], ["clerk", "officer"])).toEqual({
      seats: [
        { desk: 2, level: "clerk" },
        { desk: 3, level: "officer" },
      ],
      remove: [],
    });
    // Human at 1 and 3, bot at 2: the new bot takes 4.
    expect(planBotSeats([2], [1, 2, 3], ["major", "recruit"]).seats).toEqual([
      { desk: 2, level: "major" },
      { desk: 4, level: "recruit" },
    ]);
    expect(planBotSeats([2, 3, 4, 5], [1, 2, 3, 4, 5], ["clerk"])).toEqual({
      seats: [{ desk: 2, level: "clerk" }],
      remove: [5, 4, 3],
    });
  });
});

describe("registry: bots seated at open (C1)", () => {
  it("one human and two bots: desks 1, 2, 3; bot records in the members hash with the TTL", async () => {
    const registry = setup();
    const lobbyId = await openRoom(registry, levels("clerk", "officer"));
    const joined = await registry.join(lobbyId, { userId: "host", name: "Ada" });
    expect(joined.ok && joined.desk).toBe(1);
    const members = joined.ok ? joined.members : [];
    expect(members.map((m) => [m.desk, m.isBot, m.isHost])).toEqual([
      [1, false, true],
      [2, true, false],
      [3, true, false],
    ]);
    for (const member of members) {
      expect(memberSchema.safeParse(member).success).toBe(true);
      expect(member).toMatchObject(deskIdentity(member.desk));
    }
    expect(new Set(members.map((m) => m.name)).size).toBe(3);
    expect(await records(lobbyId)).toEqual({
      host: { desk: 1, name: "Ada" },
      "bot:2": { desk: 2, name: botName(2), isBot: true, level: "clerk" },
      "bot:3": { desk: 3, name: botName(3), isBot: true, level: "officer" },
    });
    const ttl = await redis.ttl(membersKey(lobbyId));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(ROOM_TTL_S);
  });

  it("a re-open leaves the seats alone", async () => {
    const registry = setup();
    const lobbyId = await openRoom(registry, levels("clerk"));
    await registry.open({
      lobbyId,
      code: "ABCD",
      hostUserId: "host",
      settings: { ...DEFAULT_RACE_SETTINGS, bots: levels("major", "major", "major") },
    });
    expect(Object.keys(await records(lobbyId))).toEqual(["bot:2"]);
  });

  it("the roster over the wire carries the bots (socket)", async () => {
    t = await boot(process.env.REDIS_URL);
    const lobby = await t.openRoom("KGB-4821", {
      ...DEFAULT_RACE_SETTINGS,
      bots: levels("clerk", "officer"),
    });
    const host = track(
      t.connect({
        v: PROTOCOL_VERSION,
        token: await t.token({ lobby, sub: HOST_SUB, name: "Ada", role: "host" }),
      }),
    );
    await until(() => host.roster?.length === 3, 2_000, "roster 3");
    expect(host.welcome?.you).toBe(1);
    expect(host.roster!.map((m) => [m.desk, m.isBot])).toEqual([
      [1, false],
      [2, true],
      [3, true],
    ]);
  });
});

describe("registry: setBots re-seats (C2)", () => {
  it("to 4 adds desks 4 and 5; to 1 removes 5, 4, 3 and keeps 2; a human takes the lowest free desk", async () => {
    const registry = setup();
    const lobbyId = await openRoom(registry, levels("clerk", "officer"));
    await registry.join(lobbyId, { userId: "host", name: "Ada" });
    const four = await registry.setBots(lobbyId, levels("clerk", "officer", "major", "recruit"));
    expect(four.ok && four.members.filter((m) => m.isBot).map((m) => m.desk)).toEqual([2, 3, 4, 5]);
    expect((await registry.settings(lobbyId))?.bots).toHaveLength(4);

    const one = await registry.setBots(lobbyId, levels("major"));
    expect(one.ok && one.members.map((m) => m.desk)).toEqual([1, 2]);
    expect(Object.keys(await records(lobbyId)).sort()).toEqual(["bot:2", "host"]);
    expect((await records(lobbyId))["bot:2"]).toMatchObject({ level: "major" });
    expect(await redis.ttl(membersKey(lobbyId))).toBeGreaterThan(0);

    const bob = await registry.join(lobbyId, { userId: "bob", name: "Bob" });
    expect(bob.ok && bob.desk).toBe(3);
  });

  it("is refused outside waiting (not-waiting) and for an unknown room (no-room)", async () => {
    const registry = setup();
    const lobbyId = await openRoom(registry, levels("clerk"));
    await registry.setPhase(lobbyId, "countdown");
    expect(await registry.setBots(lobbyId, levels("clerk", "clerk"))).toEqual({
      ok: false,
      reason: "not-waiting",
    });
    expect(Object.keys(await records(lobbyId))).toEqual(["bot:2"]);
    expect(await registry.setBots(`lob_${randomUUID()}`, [])).toEqual({
      ok: false,
      reason: "no-room",
    });
  });

  it("a bots patch of updateSettings re-seats in the same step and returns the members", async () => {
    const registry = setup();
    const lobbyId = await openRoom(registry);
    await registry.join(lobbyId, { userId: "host", name: "Ada" });
    const result = await registry.updateSettings(lobbyId, "host", { bots: levels("clerk") });
    expect(result.ok && result.members?.map((m) => [m.desk, m.isBot])).toEqual([
      [1, false],
      [2, true],
    ]);
    const other = await registry.updateSettings(lobbyId, "host", { timerS: 60 });
    expect(other.ok && other.members).toBeUndefined();
  });

  it("a join with a bot: id is refused", async () => {
    const registry = setup();
    const lobbyId = await openRoom(registry, levels("clerk"));
    expect(await registry.join(lobbyId, { userId: "bot:2", name: "Eve" })).toEqual({
      ok: false,
      reason: "bot-id",
    });
    expect((await records(lobbyId))["bot:2"]).toMatchObject({ isBot: true });
  });

  it("the host's bots patch broadcasts the new roster; a player's patch is still not-host", async () => {
    t = await boot(process.env.REDIS_URL);
    const lobby = await t.openRoom();
    const host = t.connect({
      v: PROTOCOL_VERSION,
      token: await t.token({ lobby, sub: HOST_SUB, name: "Ada", role: "host" }),
    });
    const player = t.connect({
      v: PROTOCOL_VERSION,
      token: await t.token({ lobby, sub: "usr_player", name: "Bob" }),
    });
    const seenHost = track(host);
    const seenPlayer = track(player);
    await until(() => seenHost.roster?.length === 2 && seenPlayer.roster?.length === 2, 2_000, "2");
    const send = (c: typeof host, patch: Partial<RaceSettings>): Promise<HostSettingsAck> =>
      c.timeout(2_000).emitWithAck("host:settings", { v: PROTOCOL_VERSION, patch } as never);
    expect(await send(player, { bots: levels("clerk") })).toEqual({
      ok: false,
      error: "not-host",
    });
    expect((await send(host, { bots: levels("clerk", "major") })).ok).toBe(true);
    await until(
      () => seenHost.roster?.length === 4 && seenPlayer.roster?.length === 4,
      2_000,
      "roster 4",
    );
    expect(seenPlayer.roster!.map((m) => [m.desk, m.isBot])).toEqual([
      [1, false],
      [2, false],
      [3, true],
      [4, true],
    ]);
  });
});

describe("registry: the last human leaving closes a room with bots (ARCHITECTURE 7.1)", () => {
  it("keeps the bots while a human remains; closes and deletes the keys after the last one", async () => {
    const registry = setup();
    const lobbyId = await openRoom(registry, levels("clerk"));
    await registry.join(lobbyId, { userId: "host", name: "Ada" });
    await registry.join(lobbyId, { userId: "bob", name: "Bob" });
    const first = await registry.leave(lobbyId, "bob");
    expect(first.closed).toBe(false);
    expect(first.members.map((m) => [m.desk, m.isBot])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(await registry.leave(lobbyId, "host")).toEqual({ members: [], closed: true });
    expect(await redis.exists(roomKey(lobbyId), membersKey(lobbyId))).toBe(0);
  });
});

describe("race with a bot (C3)", () => {
  it("host alone + 1 bot starts; the bot sits at cursor 0 typing, and ranks after the human on time", async () => {
    const race = await startedRace(process.env.REDIS_URL, {
      players: 1,
      settings: { ...DEFAULT_RACE_SETTINGS, timerS: 60, bots: levels("clerk") },
    });
    t = race.booted;
    const [host] = race.racers;
    typeKeys(host!.client, "bon", 0);
    await until(() => t!.server.desks.states(race.lobby).get(1)?.cursor === 3, 2_000, "host typed");
    const before = host!.seen.snapshots.length;
    t.clock.advance(100);
    await until(() => host!.seen.snapshots.length > before, 2_000, "snapshot");
    expect(host!.seen.snapshots.at(-1)!.desks.find(([d]) => d === 2)).toEqual([
      2,
      0,
      0,
      0,
      PLAYER_STATUS_CODES.typing,
    ]);

    for (let left = 60_000; left > 0; left -= 1_000) {
      t.clock.advance(1_000);
      await new Promise((r) => setImmediate(r));
      // A key at +30 s keeps the host clear of the idle kick at 60 s (#183).
      if (left === 30_000) {
        typeKeys(host!.client, "j", t.clock.now() - race.t0);
        await until(() => t!.server.desks.states(race.lobby).get(1)?.cursor === 4, 2_000, "host j");
      }
    }
    await until(() => host!.seen.ended.length === 1, 2_000, "ended");
    const { reason, ranking } = host!.seen.ended[0]!;
    expect(reason).toBe("timer");
    expect(ranking.map((r) => [r.place, r.desk, r.isBot, r.status])).toEqual([
      [1, 1, false, "typing"],
      [2, 2, true, "typing"],
    ]);
  });
});
