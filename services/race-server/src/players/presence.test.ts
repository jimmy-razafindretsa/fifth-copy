import type { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RACE_SETTINGS,
  PLAYER_STATUS_CODES,
  PROTOCOL_VERSION,
  welcomeSchema,
  type RaceEvent,
} from "@fifth-copy/protocol";
import { BACKSPACE, type PlayerStatus } from "@fifth-copy/engine";
import { resumeKey, roomKey } from "../rooms/keys";
import { LAST_LEAVE_GRACE_MS } from "./last-leave";
import {
  hostStart,
  connectError,
  boot,
  connectRedis,
  HOST_SUB,
  reachGo,
  startedRace,
  textWebApi,
  typeKeys,
  until,
  WAIT_MS,
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
  await until(() => who.seen.snapshots.length > before, WAIT_MS, "snapshot");
}

/**
 * Advances the fake clock by `ms` in 1 s steps (ticks fire along the way). With `awake`, `who`
 * sends a wrong key and its correction every 20 s (not on the last step), so a connected desk
 * never reaches the idle kick (#183) while the test is about something else; its cursor is
 * unchanged.
 */
async function advance(b: Booted, ms: number, awake?: { who: Racer; lobby: string }) {
  for (let left = ms; left > 0; left -= 1_000) {
    b.clock.advance(Math.min(1_000, left));
    await new Promise((r) => setImmediate(r));
    // Never on the last step: the race may end there.
    if (!awake || left <= 1_000 || (ms - left + 1_000) % 20_000 !== 0) continue;
    const before = b.server.desks.states(awake.lobby).get(awake.who.desk)?.total ?? 0;
    const t = b.clock.now() - b.server.desks.get(awake.lobby)!.t0;
    awake.who.client.emit("keys", {
      v: PROTOCOL_VERSION,
      batch: [
        { t, key: "x" },
        { t, key: BACKSPACE },
      ],
    });
    await until(
      () => (b.server.desks.states(awake.lobby).get(awake.who.desk)?.total ?? 0) > before,
      WAIT_MS,
      "awake keys",
    );
  }
}

const statusOf = (b: Booted, lobby: string, desk: number) =>
  b.server.desks.states(lobby).get(desk)?.status;

async function cursorReached(b: Booted, lobby: string, desk: number, cursor: number) {
  await until(
    () => b.server.desks.states(lobby).get(desk)?.cursor === cursor,
    WAIT_MS,
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
  await until(() => kinds(host.seen.events, "line-cut").length === 1, WAIT_MS, "line-cut event");
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
    await until(() => kinds(host.seen.events, "line-cut").length === 1, WAIT_MS, "line-cut event");
    booted.clock.advance(race.t0 - booted.clock.now());
    await until(() => booted!.server.desks.get(race.lobby)?.phase === "running", WAIT_MS, "GO");
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
    await advance(b, 60_000, { who: host, lobby });

    const back = b.connect({ v: PROTOCOL_VERSION, token: player.token, resumeKey: key });
    const again = watchRace(back);
    await until(() => !!again.welcome, WAIT_MS, "welcome after resume");
    const welcome = again.welcome!;
    expect(welcomeSchema.safeParse(welcome).success).toBe(true);
    expect(welcome).toMatchObject({
      you: player.desk,
      room: { phase: "running" },
      race: { text: "bonjour" },
      state: { cursor: 3, status: "typing" },
      resumeKey: key,
    });
    await until(() => kinds(host.seen.events, "resumed").length === 1, WAIT_MS, "resumed event");
    expect(kinds(host.seen.events, "resumed")[0]).toMatchObject({ desk: player.desk });
    // Back under the room TTL.
    expect(await redis.ttl(resumeKey(key))).toBeGreaterThan(GRACE_MS / 1000);

    // The remaining keys continue from the server's cursor.
    typeKeys(back, "jour", b.clock.now() - welcome.race!.t0);
    await until(() => statusOf(b, lobby, player.desk) === "finished", WAIT_MS, "finished");
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
    await until(() => kinds(host.seen.events, "line-cut").length === 1, WAIT_MS, "line-cut");

    await advance(b, GRACE_MS - 1_000, { who: host, lobby });
    expect(statusOf(b, lobby, cut.desk)).toBe("line-cut");
    await advance(b, 1_000);
    await until(() => statusOf(b, lobby, cut.desk) === "expired", WAIT_MS, "expired");
    await tick(b, host);
    expect(lastRow(host, cut.desk)).toEqual([cut.desk, 3, 3, 0, PLAYER_STATUS_CODES.expired, 3]);
    // The resume-key drop lands after the in-memory state the wait above saw (#600).
    await expect
      .poll(() => redis.exists(resumeKey(key)), { timeout: WAIT_MS, interval: 20 })
      .toBe(0);
    // Coming back with the old key after expiry: welcomed with the outcome, no resume.
    const late = watchRace(b.connect({ v: PROTOCOL_VERSION, token: cut.token, resumeKey: key }));
    await until(() => !!late.welcome, WAIT_MS, "late welcome");
    expect(late.welcome).toMatchObject({
      you: cut.desk,
      room: { phase: "running" },
      state: { status: "expired", cursor: 3 },
    });
    expect(kinds(host.seen.events, "resumed")).toHaveLength(0);

    await advance(b, 180_000 - GRACE_MS, { who: host, lobby });
    await until(() => host.seen.ended.length === 1, WAIT_MS, "ended");
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
    await until(() => host.seen.ended.length === 1, WAIT_MS, "ended");
    const entry = host.seen.ended[0]!.ranking.find((r) => r.desk === player.desk);
    expect(host.seen.ended[0]!.reason).toBe("timer");
    expect(entry?.status).toBe("expired");
    expect(entry?.progress).toBeCloseTo(3 / 7);
    // The resume-key drop lands after the in-memory state the wait above saw (#600).
    await expect
      .poll(() => redis.exists(resumeKey(key)), { timeout: WAIT_MS, interval: 20 })
      .toBe(0);
    // No grace timer outlives the race.
    expect(b.scheduler.armed()).toBe(0);
  });

  it("every desk expiring ends the race all-finished", async () => {
    const ended: string[] = [];
    const race = await cutRace({ onRaceEnded: (e) => void ended.push(e.reason) });
    const { booted: b, host, lobby } = race;
    host.client.disconnect();
    await until(() => statusOf(b, lobby, host.desk) === "line-cut", WAIT_MS, "host line-cut");
    await advance(b, GRACE_MS + 1_000);
    await until(() => ended.length === 1, WAIT_MS, "ended");
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
    await until(() => !!hostTab.welcome, WAIT_MS, "host tab welcome");
    expect(hostTab.welcome?.you).toBe(host.desk);

    // The cut user with a made-up key: welcomed (a member), the desk stays line-cut.
    const madeUp = watchRace(
      b.connect({ v: PROTOCOL_VERSION, token: player.token, resumeKey: "f0".repeat(32) }),
    );
    await until(() => !!madeUp.welcome, WAIT_MS, "made-up welcome");
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
    await until(() => !!tab2.welcome, WAIT_MS, "tab 2 welcome");
    expect(tab2.welcome?.resumeKey).toBe(player.seen.welcome?.resumeKey);

    player.client.disconnect();
    await new Promise((r) => setTimeout(r, 200));
    await tick(b, host);
    expect(kinds(host.seen.events, "line-cut")).toHaveLength(0);
    expect(statusOf(b, race.lobby, player.desk)).toBe("typing");
    expect(b.server.presence.isConnected(race.lobby, player.desk)).toBe(true);

    tab2Client.disconnect();
    await until(() => kinds(host.seen.events, "line-cut").length === 1, WAIT_MS, "line cut");
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
    await until(() => host.seen.ended.length === 1, WAIT_MS, "ended");
    player.client.disconnect();
    await until(() => host.seen.roster?.length === 1, WAIT_MS, "roster 1");
    expect((await b.server.registry.members(lobby))?.map((m) => m.desk)).toEqual([1]);
  });
});

// #658: a member kept through the race for a line cut is released once it ends, so the room can close.
describe("members who dropped during the race leave at its end (#658)", () => {
  it("C1: a line-cut member with no socket at the end leaves the room; the others get the roster", async () => {
    const {
      booted: b,
      lobby,
      host,
      player,
    } = await cutRace({
      settings: { ...DEFAULT_RACE_SETTINGS, timerS: 60 },
    });
    await advance(b, 60_000);
    await until(() => host.seen.ended.length === 1, WAIT_MS, "ended");
    await until(() => host.seen.roster?.length === 1, WAIT_MS, "roster without the dropped desk");
    expect((await b.server.registry.members(lobby))?.map((m) => m.desk)).toEqual([host.desk]);
    expect(b.server.presence.sockets(lobby, player.sub)).toBe(0);
  });

  it("C3: a member who resumed before the end keeps the desk after it", async () => {
    const {
      booted: b,
      lobby,
      host,
      player,
      key,
    } = await cutRace({
      settings: { ...DEFAULT_RACE_SETTINGS, timerS: 60 },
    });
    const back = b.connect({ v: PROTOCOL_VERSION, token: player.token, resumeKey: key });
    const again = watchRace(back);
    await until(() => !!again.welcome, WAIT_MS, "welcome after resume");
    await advance(b, 60_000, { who: host, lobby });
    await until(() => host.seen.ended.length === 1, WAIT_MS, "ended");
    const entry = host.seen.ended[0]!.ranking.find((r) => r.desk === player.desk);
    expect(entry?.status).not.toBe("expired");
    // the release runs after the end: give it the same chance it had in C1
    await new Promise((r) => setTimeout(r, 100));
    expect((await b.server.registry.members(lobby))?.map((m) => m.desk)).toEqual([1, 2]);
  });
});

describe("close() while a disconnect is still reading Redis (#886)", () => {
  it("the queued disconnect arms no grace timer and cuts no line once close() ran", async () => {
    const race = await startedRace(process.env.REDIS_URL, { players: 2 });
    booted = race.booted;
    const [host, player] = race.racers as [Racer, Racer];
    const { registry, presence } = race.booted.server;
    const armed = race.booted.scheduler.armed();
    // The disconnect's room read is held until after close(): the order a shutdown can meet
    // when a socket drops just before it (the flaky "close() leaves no timer armed").
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const read = registry.room.bind(registry);
    const room = vi.spyOn(registry, "room").mockImplementation(async (id) => {
      await held;
      return read(id);
    });
    player.client.disconnect();
    await until(() => room.mock.calls.length > 0, WAIT_MS, "disconnect reading the room");
    presence.close();
    release();
    // The room's queue is FIFO: once this runs, the queued disconnect has finished.
    await registry.withRoom(race.lobby, async () => {});
    expect(race.booted.scheduler.armed()).toBe(armed);
    expect(kinds(host.seen.events, "line-cut")).toEqual([]);
    expect(statusOf(race.booted, race.lobby, player.desk)).toBe("typing");
  });
});

describe("host hand-over mid-race (#137 C2)", () => {
  it("the host's line-cut expiring passes the role to the earliest-joined human: new-host, roster, host commands", async () => {
    const race = await startedRace(process.env.REDIS_URL, {
      players: 3,
      settings: { ...DEFAULT_RACE_SETTINGS, timerS: 180 },
    });
    booted = race.booted;
    const b = race.booted;
    const { lobby } = race;
    const [host, a, guest] = race.racers as [Racer, Racer, Racer];
    host.client.disconnect();
    await until(() => kinds(a.seen.events, "line-cut").length === 1, WAIT_MS, "line-cut");
    // Inside the grace the host keeps the role (a reload resumes it).
    await advance(b, GRACE_MS - 1_000, { who: a, lobby });
    expect(kinds(a.seen.events, "new-host")).toHaveLength(0);

    await advance(b, 1_000);
    await until(() => kinds(guest.seen.events, "new-host").length === 1, WAIT_MS, "new-host");
    expect(kinds(a.seen.events, "new-host")).toEqual([
      { v: PROTOCOL_VERSION, kind: "new-host", desk: a.desk },
    ]);
    await until(
      () => guest.seen.roster?.find((m) => m.desk === a.desk)?.isHost === true,
      WAIT_MS,
      "roster with the new host",
    );
    expect(guest.seen.roster?.filter((m) => m.isHost).map((m) => m.desk)).toEqual([a.desk]);
    expect(await redis.hget(roomKey(lobby), "hostUserId")).toBe(a.sub);
  });

  it("the host abandoning (Reassigned) hands the role over at once; a guest abandoning does not", async () => {
    const race = await startedRace(process.env.REDIS_URL, { players: 3 });
    booted = race.booted;
    const [host, a, guest] = race.racers as [Racer, Racer, Racer];
    guest.client.emit("abandon", { v: PROTOCOL_VERSION });
    await until(
      () => race.booted.server.desks.states(race.lobby).get(guest.desk)?.status === "abandoned",
      WAIT_MS,
      "guest abandoned",
    );
    expect(kinds(a.seen.events, "new-host")).toHaveLength(0);

    host.client.emit("abandon", { v: PROTOCOL_VERSION });
    await until(() => kinds(a.seen.events, "new-host").length === 1, WAIT_MS, "new-host");
    expect(kinds(a.seen.events, "new-host")[0]).toMatchObject({ desk: a.desk });
  });
});

// #876 C4: the watching host has no desk to cut, yet a drop during the countdown or the race keeps
// it as a seated host is kept (#658): the role passes only after the race end and the last-leave grace.
describe("the watching host dropped during the race is kept until its end (#876 C4)", () => {
  /** A room on "bonjour" whose host watches; two typists; started, GO reached unless `go: false`. */
  async function watchedRace(go: boolean) {
    const b = (booted = await boot(process.env.REDIS_URL, { webApi: textWebApi("bonjour") }));
    const lobby = await b.openRoom("KGB-4821", { ...DEFAULT_RACE_SETTINGS, hostWatches: true });
    const join = async (sub: string, role: "host" | "player") => {
      const token = await b.token({ lobby, sub, name: sub, role });
      const client = b.connect({ v: PROTOCOL_VERSION, token });
      const seen = watchRace(client);
      await until(() => !!seen.welcome, WAIT_MS, `welcome ${sub}`);
      return { client, seen, desk: seen.welcome!.you, sub };
    };
    const host = await join(HOST_SUB, "host");
    expect(host.desk).toBeNull();
    const a = await join("usr_a", "player");
    const c = await join("usr_c", "player");
    await until(() => a.seen.roster?.length === 2, WAIT_MS, "two typists");
    const ack = await hostStart(host.client);
    expect(ack).toMatchObject({ ok: true });
    const t0 = b.clock.now() + 3_000;
    if (go) await reachGo(b, lobby, t0);
    return { b, lobby, host, a, c, t0 };
  }
  const newHosts = (events: RaceEvent[]) => events.filter((e) => e.kind === "new-host");

  async function finishAndPromote(
    b: Booted,
    lobby: string,
    a: { client: Racer["client"]; seen: Racer["seen"] },
    c: { client: Racer["client"]; seen: Racer["seen"] },
  ) {
    typeKeys(a.client, "bonjour", 0);
    typeKeys(c.client, "bonjour", 0);
    await until(() => a.seen.ended.length === 1, WAIT_MS, "ended");
    await new Promise((r) => setTimeout(r, 100));
    // released at the end through the last-leave grace: nobody promoted before it runs out
    expect(newHosts(a.seen.events)).toEqual([]);
    expect((await b.server.registry.room(lobby))?.hostUserId).toBe(HOST_SUB);
    b.clock.advance(LAST_LEAVE_GRACE_MS);
    await until(() => newHosts(a.seen.events).length === 1, WAIT_MS, "new-host after the grace");
    const room = await b.server.registry.room(lobby);
    expect(room?.hostUserId).toBe("usr_a");
    expect(room?.settings.hostWatches).toBe(false);
  }

  it("running: past the last-leave grace no new host; the role passes after the end and the grace", async () => {
    const { b, lobby, host, a, c } = await watchedRace(true);
    host.client.disconnect();
    await until(() => b.server.presence.dropped(lobby).includes(HOST_SUB), WAIT_MS, "kept");
    b.clock.advance(LAST_LEAVE_GRACE_MS + 1_000);
    await new Promise((r) => setTimeout(r, 100));
    expect(newHosts(a.seen.events)).toEqual([]);
    expect(kinds(a.seen.events, "line-cut")).toEqual([]);
    expect((await b.server.registry.room(lobby))?.hostUserId).toBe(HOST_SUB);
    await finishAndPromote(b, lobby, a, c);
  });

  it("countdown: kept through GO and the grace; the role passes after the end and the grace", async () => {
    const { b, lobby, host, a, c, t0 } = await watchedRace(false);
    host.client.disconnect();
    await until(() => b.server.presence.dropped(lobby).includes(HOST_SUB), WAIT_MS, "kept");
    await reachGo(b, lobby, t0);
    b.clock.advance(LAST_LEAVE_GRACE_MS);
    await new Promise((r) => setTimeout(r, 100));
    expect(newHosts(a.seen.events)).toEqual([]);
    expect((await b.server.registry.room(lobby))?.hostUserId).toBe(HOST_SUB);
    await finishAndPromote(b, lobby, a, c);
  });

  it("back before the end: the host keeps the role and watches on", async () => {
    const { b, lobby, host, a, c } = await watchedRace(true);
    host.client.disconnect();
    await until(() => b.server.presence.dropped(lobby).includes(HOST_SUB), WAIT_MS, "kept");
    const token = await b.token({ lobby, sub: HOST_SUB, name: HOST_SUB, role: "host" });
    const back = watchRace(b.connect({ v: PROTOCOL_VERSION, token }));
    await until(() => !!back.welcome, WAIT_MS, "welcome back");
    expect(back.welcome?.you).toBeNull();
    typeKeys(a.client, "bonjour", 0);
    typeKeys(c.client, "bonjour", 0);
    await until(() => a.seen.ended.length === 1, WAIT_MS, "ended");
    b.clock.advance(LAST_LEAVE_GRACE_MS + 1_000);
    await new Promise((r) => setTimeout(r, 100));
    expect(newHosts(a.seen.events)).toEqual([]);
    const room = await b.server.registry.room(lobby);
    expect(room?.hostUserId).toBe(HOST_SUB);
    expect(room?.settings.hostWatches).toBe(true);
  });
});
