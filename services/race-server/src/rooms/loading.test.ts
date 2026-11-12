import { afterEach, describe, expect, it } from "vitest";
import {
  countdownSchema,
  DEFAULT_RACE_SETTINGS,
  loadingSchema,
  PLAYER_STATUS_CODES,
  PROTOCOL_VERSION,
  readinessSchema,
  type Countdown,
  type HostStartAck,
  type Loading,
  type RaceSettings,
  type Readiness,
} from "@fifth-copy/protocol";
import {
  boot,
  connectError,
  connectRedis,
  fixtureWebApi,
  HOST_SUB,
  until,
  WAIT_MS,
  watchRace,
  type Booted,
  type Client,
  type RaceSeen,
} from "../testing/harness";
import { membersKey, roomKey } from "./keys";

// #926: the readiness barrier (ADR 0006 server authority; ARCHITECTURE 7.1 "Loading"). Real Redis,
// fake clock and scheduler, real socket.io-client sockets. Seats here never answer `loading` by
// themselves (`ready: false`): each test sends `ready` when the criterion needs it.

const v = PROTOCOL_VERSION;
const LIMIT = 30_000;
const COUNTDOWN = 3_000;
let t: Booted | undefined;
afterEach(async () => {
  await t?.stop();
  t = undefined;
});

type Seen = RaceSeen & { loading: Loading[]; readiness: Readiness[]; countdown: Countdown[] };
type Seat = { client: Client; seen: Seen; sub: string; token: string; desk: number | null };

function watch(client: Client): Seen {
  const seen = Object.assign(watchRace(client), {
    loading: [] as Loading[],
    readiness: [] as Readiness[],
    countdown: [] as Countdown[],
  });
  client.on("loading", (l) => void seen.loading.push(l));
  client.on("readiness", (r) => void seen.readiness.push(r));
  client.on("countdown", (c) => void seen.countdown.push(c));
  return seen;
}

/** Lets in-flight socket messages land before asserting that nothing arrived. */
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

async function hash(lobby: string) {
  const redis = await connectRedis(process.env.REDIS_URL);
  try {
    return { fields: await redis.hgetall(roomKey(lobby)), ttl: await redis.ttl(roomKey(lobby)) };
  } finally {
    redis.disconnect();
  }
}

/** Polls an async check every 20 ms with the harness deadline. */
async function eventually(check: () => Promise<boolean>, what: string) {
  const deadline = Date.now() + WAIT_MS;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** A room with the host (desk 1) and `players` guests (desks 2..), none answering `loading`. */
async function room({
  players = 1,
  settings = DEFAULT_RACE_SETTINGS,
}: { players?: number; settings?: RaceSettings } = {}) {
  const web = fixtureWebApi({ now: () => Date.now() });
  t = await boot(process.env.REDIS_URL, { webApi: web.api });
  const booted = t;
  const lobby = await booted.openRoom("KGB-4821", settings);
  const join = async (
    sub: string,
    role: "host" | "player" | "spectator" = "player",
    resumeKey?: string,
  ): Promise<Seat> => {
    const token = await booted.token({ lobby, sub, name: sub, role });
    const client = booted.connect(
      { v, token, ...(resumeKey ? { resumeKey } : {}) },
      { ready: false },
    );
    const seen = watch(client);
    await until(() => !!seen.welcome, WAIT_MS, `${sub} welcome`);
    return { client, seen, sub, token, desk: seen.welcome!.you };
  };
  const host = await join(HOST_SUB, "host");
  const guests: Seat[] = [];
  for (let i = 0; i < players; i++) guests.push(await join(`usr_g${i}`));
  const seats = [host, ...guests];
  const desks = seats.filter((s) => s.desk !== null).length + settings.bots.length;
  await until(() => seats.every((s) => s.seen.roster?.length === desks), WAIT_MS, "seated");
  const start = (): Promise<HostStartAck> =>
    host.client.timeout(2_000).emitWithAck("host:start", { v });
  const ready = (seat: Seat, raceId: string) => seat.client.emit("ready", { v, raceId });
  return { booted, lobby, web, host, guests, seats, join, start, ready };
}

describe("readiness barrier: start and release (#926 C1, C9)", () => {
  it("START loads; no countdown while a connected seat is pending; the last ready releases at once", async () => {
    const r = await room({ players: 1 });
    const watcher = await r.join("usr_watch", "spectator");
    const startedAt = r.booted.clock.now();
    const ack = await r.start();
    expect(ack).toEqual({ ok: true, raceId: expect.any(String) });
    const raceId = (ack as { raceId: string }).raceId;
    expect(r.web.calls).toHaveLength(1);

    for (const seen of [r.host.seen, r.guests[0]!.seen, watcher.seen]) {
      await until(() => seen.loading.length === 1, WAIT_MS, "loading");
      const loading = loadingSchema.parse(seen.loading[0]);
      expect(loading.pending).toEqual([1, 2]);
      expect(loading.race.raceId).toBe(raceId);
      expect(loading.race.text).toBe("Le formulaire est en triple exemplaire.");
      // While loading, `t0` is the latest possible GO, never GO.
      expect(loading.race.t0).toBe(startedAt + LIMIT + COUNTDOWN);
    }
    const loaded = await hash(r.lobby);
    expect(loaded.fields.phase).toBe("loading");
    expect(loaded.ttl).toBeGreaterThan(0);

    // `host:start` during the loading is refused; the host's own ready leaves the guest pending.
    expect(await r.start()).toEqual({ ok: false, error: "not-waiting" });
    r.ready(r.host, raceId);
    await until(() => r.guests[0]!.seen.readiness.length === 1, WAIT_MS, "readiness");
    expect(readinessSchema.parse(r.guests[0]!.seen.readiness[0])).toEqual({
      v,
      raceId,
      pending: [2],
    });
    r.booted.clock.advance(LIMIT - 1_000);
    await settle();
    expect(r.host.seen.countdown).toHaveLength(0);
    expect((await hash(r.lobby)).fields.phase).toBe("loading");
    expect(r.booted.server.desks.get(r.lobby)).toBeUndefined();

    const releasedAt = r.booted.clock.now();
    r.ready(r.guests[0]!, raceId);
    for (const seen of [r.host.seen, r.guests[0]!.seen, watcher.seen]) {
      await until(() => seen.countdown.length === 1, WAIT_MS, "countdown");
      expect(countdownSchema.parse(seen.countdown[0]).race.t0).toBe(releasedAt + COUNTDOWN);
    }
    const released = await hash(r.lobby);
    expect(released.fields).toMatchObject({
      phase: "countdown",
      t0: String(releasedAt + COUNTDOWN),
    });
    expect(released.ttl).toBeGreaterThan(0);
    r.booted.clock.advance(COUNTDOWN);
    await eventually(async () => (await hash(r.lobby)).fields.phase === "running", "running");
  });

  it("a public room's automatic start and Race again load too; a bot is never awaited", async () => {
    const settings = {
      ...DEFAULT_RACE_SETTINGS,
      lobbyType: "public",
      timerS: 60,
      bots: [{ level: "clerk" }],
    } satisfies RaceSettings;
    const r = await room({ players: 0, settings });
    // #814: the room starts by itself after its 45 s, once armed.
    await until(() => r.booted.scheduler.armed() >= 1, WAIT_MS, "automatic start armed");
    r.booted.clock.advance(45_000);
    await until(() => r.host.seen.loading.length === 1, WAIT_MS, "automatic loading");
    const first = r.host.seen.loading[0]!;
    expect(first.pending).toEqual([1]);
    r.ready(r.host, first.race.raceId);
    await until(
      () => r.host.seen.countdown.length === 1,
      WAIT_MS,
      "countdown on the human's ready",
    );
    r.booted.clock.advance(COUNTDOWN + 60_000);
    await until(() => r.host.seen.ended.length === 1, WAIT_MS, "ended");

    // Race again (#143): the same barrier.
    expect((await r.start()).ok).toBe(true);
    await until(() => r.host.seen.loading.length === 2, WAIT_MS, "second loading");
    expect(r.host.seen.loading[1]!.pending).toEqual([1]);
    expect(r.host.seen.countdown).toHaveLength(1);
  });
});

describe("readiness barrier: the hard limit (#926 C2)", () => {
  it("at the limit the room counts down for everyone; the late desk races on and its ready changes nothing", async () => {
    const r = await room({ players: 1 });
    const startedAt = r.booted.clock.now();
    const ack = await r.start();
    const raceId = (ack as { raceId: string }).raceId;
    r.ready(r.host, raceId);
    await until(() => r.host.seen.readiness.length === 1, WAIT_MS, "readiness");

    r.booted.clock.advance(LIMIT - 1);
    await settle();
    expect(r.host.seen.countdown).toHaveLength(0);
    r.booted.clock.advance(1);
    for (const seen of [r.host.seen, r.guests[0]!.seen]) {
      await until(() => seen.countdown.length === 1, WAIT_MS, "countdown at the limit");
      expect(seen.countdown[0]!.race.t0).toBe(startedAt + LIMIT + COUNTDOWN);
    }
    // The late desk's ready after the release changes nothing.
    r.ready(r.guests[0]!, raceId);
    await settle();
    expect(r.host.seen.countdown).toHaveLength(1);
    expect(r.host.seen.readiness).toHaveLength(1);

    r.booted.clock.advance(COUNTDOWN);
    await until(() => r.booted.server.desks.get(r.lobby)?.phase === "running", WAIT_MS, "GO");
    const runtime = r.booted.server.desks.get(r.lobby)!;
    expect(runtime.desks.map((d) => d.desk)).toEqual([1, 2]);
    expect(r.booted.server.desks.states(r.lobby).get(2)?.status).toBe("typing");
    r.booted.clock.advance(100);
    await until(() => r.host.seen.snapshots.length > 0, WAIT_MS, "snapshot");
    const late = r.host.seen.snapshots.at(-1)!.desks.find(([desk]) => desk === 2);
    expect(late?.[4]).toBe(PLAYER_STATUS_CODES.typing);
  });

  it("a disconnect and a reconnect never move the limit", async () => {
    const r = await room({ players: 1 });
    const startedAt = r.booted.clock.now();
    await r.start();
    await until(() => r.host.seen.loading.length === 1, WAIT_MS, "loading");
    r.booted.clock.advance(10_000);
    r.guests[0]!.client.disconnect();
    await until(() => r.host.seen.events.some((e) => e.kind === "line-cut"), WAIT_MS, "line-cut");
    const back = await r.join("usr_g0");
    expect(back.seen.welcome!.room.phase).toBe("loading");
    expect(back.seen.welcome!.pending).toContain(2);
    r.booted.clock.advance(LIMIT - 10_000);
    await until(() => back.seen.countdown.length === 1, WAIT_MS, "countdown at the limit");
    expect(back.seen.countdown[0]!.race.t0).toBe(startedAt + LIMIT + COUNTDOWN);
  });
});

describe("readiness barrier: the same start instant (#926 C6)", () => {
  it("every seat and spectator socket gets one countdown t0; no desk runs before it", async () => {
    const r = await room({ players: 2 });
    const watchers = [await r.join("usr_w1", "spectator"), await r.join("usr_w2", "spectator")];
    const ack = await r.start();
    const raceId = (ack as { raceId: string }).raceId;
    for (const seat of r.seats) r.ready(seat, raceId);
    const everyone = [...r.seats, ...watchers];
    await until(() => everyone.every((s) => s.seen.countdown.length === 1), WAIT_MS, "countdowns");
    const t0s = new Set(everyone.map((s) => s.seen.countdown[0]!.race.t0));
    expect(t0s.size).toBe(1);
    const [t0] = [...t0s];
    r.booted.clock.advance(t0! - r.booted.clock.now() - 1);
    await settle();
    expect(r.booted.server.desks.get(r.lobby)).toBeUndefined();
    r.booted.clock.advance(1);
    await until(() => r.booted.server.desks.get(r.lobby)?.phase === "running", WAIT_MS, "GO");
  });
});

describe("readiness barrier: bots, presence, joiners, watchers (#926 C7)", () => {
  it("a desk whose last socket closes is cut, unmarked and no longer awaited: the room goes when the rest are ready", async () => {
    const r = await room({ players: 2 });
    const ack = await r.start();
    const raceId = (ack as { raceId: string }).raceId;
    r.ready(r.host, raceId);
    r.ready(r.guests[0]!, raceId);
    await until(
      () => r.host.seen.readiness.at(-1)?.pending.join() === "3",
      WAIT_MS,
      "pending desk 3",
    );
    r.guests[1]!.client.disconnect();
    await until(() => r.host.seen.countdown.length === 1, WAIT_MS, "countdown once desk 3 is away");
    expect(r.host.seen.events).toContainEqual({ v, kind: "line-cut", desk: 3 });
  });

  it("with no connected human left the room goes at once; a user back before the release must report again", async () => {
    const r = await room({ players: 1 });
    const ack = await r.start();
    const raceId = (ack as { raceId: string }).raceId;
    // The guest reports, then drops: its mark goes with its last socket.
    r.ready(r.guests[0]!, raceId);
    await until(() => r.host.seen.readiness.at(-1)?.pending.join() === "1", WAIT_MS, "guest ready");
    const resumeKey = r.guests[0]!.seen.welcome!.resumeKey!;
    r.guests[0]!.client.disconnect();
    await until(() => r.host.seen.events.some((e) => e.kind === "line-cut"), WAIT_MS, "line-cut");
    const back = await r.join("usr_g0", "player", resumeKey);
    expect(back.seen.welcome!.pending).toEqual([1, 2]);
    await until(
      () => r.host.seen.readiness.at(-1)?.pending.join() === "1,2",
      WAIT_MS,
      "guest awaited again",
    );
    r.ready(r.host, raceId);
    await settle();
    expect(r.host.seen.countdown).toHaveLength(0);
    // Everyone away: nobody is awaited any more, the room counts down at once.
    back.client.disconnect();
    await until(() => r.host.seen.countdown.length === 1, WAIT_MS, "countdown with nobody pending");
  });

  it("a stranger's handshake during the loading is refused in-progress", async () => {
    const r = await room({ players: 1 });
    await r.start();
    await until(() => r.host.seen.loading.length === 1, WAIT_MS, "loading");
    const late = r.booted.connect(
      { v, token: await r.booted.token({ lobby: r.lobby, sub: "usr_late", name: "Lou" }) },
      { ready: false },
    );
    expect(await connectError(late)).toBe("in-progress");
  });

  it("the watching host and a spectator are never awaited and their ready is dropped", async () => {
    const r = await room({
      players: 2,
      settings: { ...DEFAULT_RACE_SETTINGS, hostWatches: true },
    });
    expect(r.host.desk).toBeNull();
    const watcher = await r.join("usr_watch", "spectator");
    const ack = await r.start();
    const raceId = (ack as { raceId: string }).raceId;
    await until(() => r.host.seen.loading.length === 1, WAIT_MS, "loading");
    expect(r.host.seen.loading[0]!.pending).toEqual([1, 2]);
    r.ready(r.host, raceId);
    r.ready(watcher, raceId);
    await settle();
    expect(r.guests[0]!.seen.readiness).toHaveLength(0);
    r.ready(r.guests[0]!, raceId);
    r.ready(r.guests[1]!, raceId);
    await until(
      () => r.host.seen.countdown.length === 1,
      WAIT_MS,
      "countdown on the typists' ready",
    );
  });

  it("a room lost during the loading hears ended void and never hangs", async () => {
    const r = await room({ players: 1 });
    const ack = await r.start();
    const raceId = (ack as { raceId: string }).raceId;
    await until(() => r.host.seen.loading.length === 1, WAIT_MS, "loading");
    const redis = await connectRedis(process.env.REDIS_URL);
    try {
      await redis.del(roomKey(r.lobby), membersKey(r.lobby));
    } finally {
      redis.disconnect();
    }
    r.ready(r.host, raceId);
    await until(() => r.host.seen.ended.length === 1, WAIT_MS, "ended void");
    expect(r.host.seen.ended[0]).toEqual({ v, raceId, reason: "void", ranking: [] });
    expect(r.host.seen.countdown).toHaveLength(0);
  });
});

describe("readiness barrier: the ready edge (#926 C8)", () => {
  it("a malformed ready, another race, outside loading or a repeat emits nothing", async () => {
    const r = await room({ players: 1 });
    const send = (raw: unknown) => r.host.client.emit("ready", raw as never);
    // Waiting: no race to be ready for.
    send({ v, raceId: "3f0c8a52-6a3e-4c1b-9d7e-2b5f1e8a4c90" });
    const ack = await r.start();
    const raceId = (ack as { raceId: string }).raceId;
    await until(() => r.host.seen.loading.length === 1, WAIT_MS, "loading");
    send({ v, raceId: "nope" });
    // From the guest: `ready` has a budget of 5 per 10 s per identity (#207), the host spends 5.
    const guestSend = (raw: unknown) => r.guests[0]!.client.emit("ready", raw as never);
    guestSend({ v, raceId, desk: 2 });
    guestSend({ v: v - 1, raceId });
    send({ v, raceId: "3f0c8a52-6a3e-4c1b-9d7e-2b5f1e8a4c90" });
    await settle();
    expect(r.host.seen.readiness).toHaveLength(0);
    expect(r.host.seen.rejected).toHaveLength(0);

    send({ v, raceId });
    await until(() => r.host.seen.readiness.length === 1, WAIT_MS, "readiness");
    send({ v, raceId });
    await settle();
    expect(r.host.seen.readiness).toHaveLength(1);
    expect(r.host.seen.countdown).toHaveLength(0);
    expect(r.host.client.connected).toBe(true);
  });
});
