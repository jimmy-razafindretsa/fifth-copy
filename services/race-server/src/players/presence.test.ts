import type { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RACE_SETTINGS,
  PLAYER_STATUS_CODES,
  PROTOCOL_VERSION,
  welcomeSchema,
  type RaceEvent,
} from "@fifth-copy/protocol";
import type { PlayerStatus } from "@fifth-copy/engine";
import { resumeKey } from "../rooms/keys";
import {
  connectError,
  connectRedis,
  startedRace,
  typeKeys,
  until,
  watchRace,
  type Booted,
  type Racer,
} from "../testing/harness";

// #178: presence, line cut, resume and grace expiry over the wire (real Redis, fake clock and
// scheduler; ADR 0006, 0008, 0009; ARCHITECTURE 7.1, 7.4, 10). Socket-level: this is the card's e2e.
let booted: Booted | undefined;
let redis: Redis;
beforeAll(async () => {
  redis = await connectRedis(process.env.REDIS_URL);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await booted?.stop();
  booted = undefined;
});
afterAll(() => redis.disconnect());

const GRACE_MS = 120_000;
const kinds = (events: RaceEvent[], kind: RaceEvent["kind"]) =>
  events.filter((e) => e.kind === kind);

/** The desk's `[desk, cursor, correct, errors, statusCode]` in the latest snapshot. */
const lastRow = (r: Racer, desk: number) =>
  r.seen.snapshots.at(-1)?.desks.find((d) => d[0] === desk);

/** Advances one tick (100 ms) and waits until `who` received a snapshot after it. */
async function tick(b: Booted, who: Racer) {
  const before = who.seen.snapshots.length;
  b.clock.advance(100);
  await until(() => who.seen.snapshots.length > before, 2_000, "snapshot");
}

/** Advances the fake clock by `ms` in 1 s steps (ticks fire along the way). */
async function advance(b: Booted, ms: number) {
  for (let left = ms; left > 0; left -= 1_000) {
    b.clock.advance(Math.min(1_000, left));
    await new Promise((r) => setImmediate(r));
  }
}

const statusOf = (b: Booted, lobby: string, desk: number) =>
  b.server.desks.states(lobby).get(desk)?.status;

async function cursorReached(b: Booted, lobby: string, desk: number, cursor: number) {
  await until(
    () => b.server.desks.states(lobby).get(desk)?.cursor === cursor,
    2_000,
    `desk ${desk} at ${cursor}`,
  );
}

/** A race on "bonjour" (7 chars) where racer 1 typed 3 chars, then dropped. */
async function cutRace(options: Parameters<typeof startedRace>[1] = {}) {
  const race = await startedRace(process.env.REDIS_URL, { players: 2, ...options });
  booted = race.booted;
  const [host, player] = race.racers as [Racer, Racer];
  typeKeys(player.client, "bon", 0);
  await cursorReached(race.booted, race.lobby, player.desk, 3);
  const key = player.seen.welcome!.resumeKey!;
  const before = await race.booted.server.registry.room(race.lobby);
  player.client.disconnect();
  await until(() => kinds(host.seen.events, "line-cut").length === 1, 2_000, "line-cut event");
  return { ...race, host, player, key, before };
}

describe("line cut (C1)", () => {
  it("keeps the desk at its cursor, line-cut in the next snapshot, key under the grace, clock untouched", async () => {
    const { booted: b, lobby, host, player, key, before } = await cutRace();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(kinds(host.seen.events, "line-cut")).toEqual([
      { v: PROTOCOL_VERSION, kind: "line-cut", desk: player.desk },
    ]);
    await tick(b, host);
    const row = lastRow(host, player.desk)!;
    expect(row[1]).toBe(3);
    expect(row[4]).toBe(PLAYER_STATUS_CODES["line-cut"]);

    const pttl = await redis.pttl(resumeKey(key));
    expect(pttl).toBeGreaterThan(0);
    expect(pttl).toBeLessThanOrEqual(GRACE_MS);

    const after = await b.server.registry.room(lobby);
    expect(after?.race?.t0).toBe(before?.race?.t0);
    expect(after?.endAt).toBe(before?.endAt);
    expect(after?.phase).toBe("running");
    // The desk is not freed: the members hash still lists the user.
    expect((await b.server.registry.members(lobby))?.map((m) => m.desk)).toEqual([1, 2]);
    expect(b.server.presence.isConnected(lobby, player.desk)).toBe(false);
    expect(b.server.presence.isConnected(lobby, host.desk)).toBe(true);
  });

  it("a desk that drops during the countdown is line-cut from GO", async () => {
    const race = await startedRace(process.env.REDIS_URL, { players: 2, go: false });
    booted = race.booted;
    const [host, player] = race.racers as [Racer, Racer];
    player.client.disconnect();
    await until(() => kinds(host.seen.events, "line-cut").length === 1, 2_000, "line-cut event");
    booted.clock.advance(race.t0 - booted.clock.now());
    await until(() => booted!.server.desks.get(race.lobby)?.phase === "running", 2_000, "GO");
    expect(statusOf(booted, race.lobby, player.desk)).toBe("line-cut");
  });
});

describe("resume (C2)", () => {
  it("same token and key within 60 s: welcome with the server state, resumed, finishes at 7", async () => {
    const lines: string[] = [];
    for (const level of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation(
        (...args: unknown[]) => void lines.push(args.map(String).join(" ")),
      );
    }
    const { booted: b, lobby, host, player, key } = await cutRace();
    await advance(b, 60_000);

    const back = b.connect({ v: PROTOCOL_VERSION, token: player.token, resumeKey: key });
    const again = watchRace(back);
    await until(() => !!again.welcome, 2_000, "welcome after resume");
    const welcome = again.welcome!;
    expect(welcomeSchema.safeParse(welcome).success).toBe(true);
    expect(welcome).toMatchObject({
      you: player.desk,
      room: { phase: "running" },
      race: { text: "bonjour" },
      state: { cursor: 3, status: "typing" },
      resumeKey: key,
    });
    await until(() => kinds(host.seen.events, "resumed").length === 1, 2_000, "resumed event");
    expect(kinds(host.seen.events, "resumed")[0]).toMatchObject({ desk: player.desk });
    // Back under the room TTL.
    expect(await redis.ttl(resumeKey(key))).toBeGreaterThan(GRACE_MS / 1000);

    // The remaining keys continue from the server's cursor.
    typeKeys(back, "jour", b.clock.now() - welcome.race!.t0);
    await until(() => statusOf(b, lobby, player.desk) === "finished", 2_000, "finished");
    expect(b.server.desks.states(lobby).get(player.desk)?.cursor).toBe(7);

    // Listed once, at the same desk.
    expect(welcome.members.filter((m) => m.desk === player.desk)).toHaveLength(1);
    expect(again.roster?.filter((m) => m.desk === player.desk)).toHaveLength(1);
    expect((await b.server.registry.members(lobby))?.map((m) => m.desk)).toEqual([1, 2]);

    // C4: the key never reaches the logs.
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain(key);
  });
});

describe("grace expiry (C3)", () => {
  it("expires after 120 s, ranked by frozen progress among the unfinished, before asleep and abandoned", async () => {
    const race = await startedRace(process.env.REDIS_URL, {
      players: 4,
      settings: { ...DEFAULT_RACE_SETTINGS, timerS: 180 },
    });
    booted = race.booted;
    const b = race.booted;
    const { lobby } = race;
    const [host, cut, sleeper, quitter] = race.racers as [Racer, Racer, Racer, Racer];
    // Host typing at 5/7 (higher progress), the cut desk at 3/7, asleep at 1/7, abandoned at 6/7.
    typeKeys(host.client, "bonjo", 0);
    typeKeys(cut.client, "bon", 0);
    typeKeys(sleeper.client, "b", 0);
    typeKeys(quitter.client, "bonjou", 0);
    await cursorReached(b, lobby, host.desk, 5);
    await cursorReached(b, lobby, cut.desk, 3);
    await cursorReached(b, lobby, sleeper.desk, 1);
    await cursorReached(b, lobby, quitter.desk, 6);
    // asleep and abandoned are #183's and #143's to decide; set through the desks-state seam.
    const force = (desk: number, status: PlayerStatus) =>
      b.server.desks.set(lobby, desk, { ...b.server.desks.states(lobby).get(desk)!, status });
    force(sleeper.desk, "asleep");
    force(quitter.desk, "abandoned");

    const key = cut.seen.welcome!.resumeKey!;
    cut.client.disconnect();
    await until(() => kinds(host.seen.events, "line-cut").length === 1, 2_000, "line-cut");

    await advance(b, GRACE_MS - 1_000);
    expect(statusOf(b, lobby, cut.desk)).toBe("line-cut");
    await advance(b, 1_000);
    await until(() => statusOf(b, lobby, cut.desk) === "expired", 2_000, "expired");
    await tick(b, host);
    expect(lastRow(host, cut.desk)).toEqual([cut.desk, 3, 3, 0, PLAYER_STATUS_CODES.expired]);
    expect(await redis.exists(resumeKey(key))).toBe(0);
    // Coming back with the old key after expiry: welcomed with the outcome, no resume.
    const late = watchRace(b.connect({ v: PROTOCOL_VERSION, token: cut.token, resumeKey: key }));
    await until(() => !!late.welcome, 2_000, "late welcome");
    expect(late.welcome).toMatchObject({
      you: cut.desk,
      room: { phase: "running" },
      state: { status: "expired", cursor: 3 },
    });
    expect(kinds(host.seen.events, "resumed")).toHaveLength(0);

    await advance(b, 180_000 - GRACE_MS);
    await until(() => host.seen.ended.length === 1, 2_000, "ended");
    const ranking = host.seen.ended[0]!.ranking;
    expect(ranking.map((r) => [r.desk, r.status])).toEqual([
      [host.desk, "typing"],
      [cut.desk, "expired"],
      [sleeper.desk, "asleep"],
      [quitter.desk, "abandoned"],
    ]);
    expect(ranking.find((r) => r.desk === cut.desk)?.progress).toBeCloseTo(3 / 7);
  });

  it("the race ending on time while line-cut yields expired; the key is gone", async () => {
    const {
      booted: b,
      host,
      player,
      key,
    } = await cutRace({
      settings: { ...DEFAULT_RACE_SETTINGS, timerS: 60 },
    });
    await advance(b, 60_000);
    await until(() => host.seen.ended.length === 1, 2_000, "ended");
    const entry = host.seen.ended[0]!.ranking.find((r) => r.desk === player.desk);
    expect(host.seen.ended[0]!.reason).toBe("timer");
    expect(entry?.status).toBe("expired");
    expect(entry?.progress).toBeCloseTo(3 / 7);
    expect(await redis.exists(resumeKey(key))).toBe(0);
    // No grace timer outlives the race.
    expect(b.scheduler.armed()).toBe(0);
  });

  it("every desk expiring ends the race all-finished", async () => {
    const ended: string[] = [];
    const race = await cutRace({ onRaceEnded: (e) => void ended.push(e.reason) });
    const { booted: b, host, lobby } = race;
    host.client.disconnect();
    await until(() => statusOf(b, lobby, host.desk) === "line-cut", 2_000, "host line-cut");
    await advance(b, GRACE_MS + 1_000);
    await until(() => ended.length === 1, 2_000, "ended");
    expect(ended).toEqual(["all-finished"]);
  });
});

describe("resume keys are bound to the token (C4)", () => {
  it("another user's key, a made-up key or no key: plain join, no resumed, desk unchanged", async () => {
    const { booted: b, lobby, host, player, key } = await cutRace();
    // A non-member holding the cut user's key is still in-progress.
    const stranger = b.connect({
      v: PROTOCOL_VERSION,
      token: await b.token({ lobby, sub: "usr_stranger" }),
      resumeKey: key,
    });
    expect(await connectError(stranger)).toBe("in-progress");

    // Another member (the host, second tab) with the cut user's key: a plain second tab.
    const hostTab = watchRace(
      b.connect({ v: PROTOCOL_VERSION, token: host.token, resumeKey: key }),
    );
    await until(() => !!hostTab.welcome, 2_000, "host tab welcome");
    expect(hostTab.welcome?.you).toBe(host.desk);

    // The cut user with a made-up key: welcomed (a member), the desk stays line-cut.
    const madeUp = watchRace(
      b.connect({ v: PROTOCOL_VERSION, token: player.token, resumeKey: "f0".repeat(32) }),
    );
    await until(() => !!madeUp.welcome, 2_000, "made-up welcome");
    expect(madeUp.welcome).toMatchObject({ you: player.desk, state: { status: "line-cut" } });

    // A resume key with an invalid token is bad-token.
    const forged = b.connect({ v: PROTOCOL_VERSION, token: `${player.token}x`, resumeKey: key });
    expect(await connectError(forged)).toBe("bad-token");

    await tick(b, host);
    expect(kinds(host.seen.events, "resumed")).toHaveLength(0);
    expect(statusOf(b, lobby, player.desk)).toBe("line-cut");
    expect((await b.server.registry.members(lobby))?.map((m) => m.desk)).toEqual([1, 2]);
  });
});

describe("waiting room and tabs (C5)", () => {
  it("a two-tab user closing one tab during running triggers no line cut", async () => {
    const race = await startedRace(process.env.REDIS_URL, { players: 2 });
    booted = race.booted;
    const b = race.booted;
    const [host, player] = race.racers as [Racer, Racer];
    const tab2Client = b.connect({ v: PROTOCOL_VERSION, token: player.token });
    const tab2 = watchRace(tab2Client);
    await until(() => !!tab2.welcome, 2_000, "tab 2 welcome");
    expect(tab2.welcome?.resumeKey).toBe(player.seen.welcome?.resumeKey);

    player.client.disconnect();
    await new Promise((r) => setTimeout(r, 200));
    await tick(b, host);
    expect(kinds(host.seen.events, "line-cut")).toHaveLength(0);
    expect(statusOf(b, race.lobby, player.desk)).toBe("typing");
    expect(b.server.presence.isConnected(race.lobby, player.desk)).toBe(true);

    tab2Client.disconnect();
    await until(() => kinds(host.seen.events, "line-cut").length === 1, 2_000, "line cut");
  });

  it("after the race ends, the last socket of a user frees the desk (roster)", async () => {
    const {
      booted: b,
      lobby,
      racers,
    } = await startedRace(process.env.REDIS_URL, {
      players: 2,
      settings: { ...DEFAULT_RACE_SETTINGS, timerS: 60 },
    });
    booted = b;
    const [host, player] = racers as [Racer, Racer];
    await advance(b, 60_000);
    await until(() => host.seen.ended.length === 1, 2_000, "ended");
    player.client.disconnect();
    await until(() => host.seen.roster?.length === 1, 2_000, "roster 1");
    expect((await b.server.registry.members(lobby))?.map((m) => m.desk)).toEqual([1]);
  });
});
