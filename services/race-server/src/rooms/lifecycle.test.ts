import { afterEach, describe, expect, it, vi } from "vitest";
import { BACKSPACE } from "@fifth-copy/engine";
import {
  countdownSchema,
  DEFAULT_RACE_SETTINGS,
  endedSchema,
  MAX_RACE_MS,
  PROTOCOL_VERSION,
  welcomeSchema,
  type Countdown,
  type Ended,
  type HostStartAck,
  type Pong,
  type RaceSettings,
  type Snapshot,
  INTERNAL_HEADERS,
  startRaceRequestSchema,
} from "@fifth-copy/protocol";
import { verifyInternalRequest } from "../http/hmac";
import { createWebApi, type WebApi } from "../persist/web-api";
import {
  boot,
  connectError,
  connectRedis,
  FIXTURE_TEXT,
  ackResults,
  fixtureWebApi,
  HOST_SUB,
  track,
  typeKeys,
  until,
  WAIT_MS,
  type Booted,
  SECRET,
  type Client,
} from "../testing/harness";
import { startWebStub, STUB_TEXT, type WebStub } from "../testing/web-stub";
import { desksKey, ENDED_GRACE_TTL_S, membersKey, roomKey, traceKey } from "./keys";
import type { RaceEnded } from "./lifecycle";

// #166: the room lifecycle over the wire, real Redis, fake clock and scheduler, fake WebApi
// (ADR 0006, 0008; ARCHITECTURE 7.1, 7.3, 10). Socket-level: this is the card's e2e.
let t: Booted | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await t?.stop();
  t = undefined;
});

type Seen = ReturnType<typeof track> & { countdown: Countdown[]; ended: Ended[]; pong: Pong[] };

function watch(client: Client): Seen {
  const seen = Object.assign(track(client), {
    countdown: [] as Countdown[],
    ended: [] as Ended[],
    pong: [] as Pong[],
  });
  client.on("countdown", (c) => void seen.countdown.push(c));
  client.on("ended", (e) => void seen.ended.push(e));
  client.on("pong", (p) => void seen.pong.push(p));
  return seen;
}

function start(client: Client, payload: unknown = { v: PROTOCOL_VERSION }): Promise<HostStartAck> {
  return client.timeout(2_000).emitWithAck("host:start", payload as never);
}

/** Boots a room with the host and `players` players connected and seated. */
async function room({
  players = 1,
  settings = DEFAULT_RACE_SETTINGS,
  webApi,
  onRaceEnded,
}: {
  players?: number;
  settings?: RaceSettings;
  webApi?: WebApi;
  onRaceEnded?: (ended: RaceEnded) => void;
} = {}) {
  t = await boot(process.env.REDIS_URL, { webApi, onRaceEnded });
  const booted = t;
  const lobby = await booted.openRoom("KGB-4821", settings);
  const connectAs = async (sub: string, name: string, role: "host" | "player" = "player") =>
    booted.connect({
      v: PROTOCOL_VERSION,
      token: await booted.token({ lobby, sub, name, role }),
    });
  const host = await connectAs(HOST_SUB, "Ada", "host");
  const seenHost = watch(host);
  const others: { client: Client; seen: Seen }[] = [];
  for (let i = 0; i < players; i++) {
    const client = await connectAs(`usr_p${i}`, `Clerk ${i}`);
    others.push({ client, seen: watch(client) });
  }
  await until(
    // The settings' bots are seated at open (#156) and count in the roster.
    () =>
      [seenHost, ...others.map((o) => o.seen)].every(
        (s) => s.roster?.length === players + 1 + settings.bots.length,
      ),
    WAIT_MS,
    "everyone seated",
  );
  return { booted, lobby, host, seenHost, others, connectAs };
}

async function hash(lobby: string) {
  const redis = await connectRedis(process.env.REDIS_URL);
  try {
    return { fields: await redis.hgetall(roomKey(lobby)), ttl: await redis.ttl(roomKey(lobby)) };
  } finally {
    redis.disconnect();
  }
}

/** Polls an async check (Redis reads) every 20 ms, with the harness deadline and message. */
async function eventually(check: () => Promise<boolean>, what: string, ms = WAIT_MS) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Runs `fn` with a short-lived Redis connection. */
async function redis<T>(fn: (c: Awaited<ReturnType<typeof connectRedis>>) => Promise<T>) {
  const c = await connectRedis(process.env.REDIS_URL);
  try {
    return await fn(c);
  } finally {
    c.disconnect();
  }
}

const phaseOf = async (lobby: string) => (await hash(lobby)).fields.phase;
/** Lets in-flight socket messages land before asserting that nothing arrived. */
const settle = () => new Promise((r) => setTimeout(r, 150));

describe("lifecycle: host start and countdown (C1)", () => {
  it("acks ok, broadcasts countdown with t0 = now + 3 s and the text, then runs at GO", async () => {
    const { booted, lobby, host, seenHost, others, connectAs } = await room();
    const startedAt = booted.clock.now();

    const ack = await start(host);
    expect(ack).toEqual({ ok: true, raceId: expect.any(String) });
    const raceId = (ack as { raceId: string }).raceId;

    await until(
      () => seenHost.countdown.length === 1 && others[0]!.seen.countdown.length === 1,
      WAIT_MS,
      "countdown to every member",
    );
    for (const seen of [seenHost, others[0]!.seen]) {
      const countdown = countdownSchema.parse(seen.countdown[0]);
      expect(countdown.race).toEqual({
        raceId,
        text: FIXTURE_TEXT.content,
        language: FIXTURE_TEXT.language,
        wordCount: FIXTURE_TEXT.wordCount,
        t0: startedAt + 3000,
        timerS: null,
      });
    }
    const { fields, ttl } = await hash(lobby);
    expect(fields).toMatchObject({ phase: "countdown", raceId, t0: String(startedAt + 3000) });
    expect(ttl).toBeGreaterThan(0);

    booted.clock.advance(2_999);
    await settle();
    expect(await phaseOf(lobby)).toBe("countdown");
    booted.clock.advance(1);
    await eventually(async () => (await phaseOf(lobby)) === "running", "phase running");

    // A second tab of a member: welcome with the current phase and the race filled.
    const tab = watch(await connectAs("usr_p0", "Clerk 0"));
    await until(() => !!tab.welcome, WAIT_MS, "second tab welcome");
    expect(welcomeSchema.parse(tab.welcome)).toMatchObject({
      you: 2,
      room: { phase: "running" },
      race: seenHost.countdown[0]!.race,
    });
  });

  it("sends the web app the room's settings and every seated desk", async () => {
    const web = fixtureWebApi({ now: () => 0 });
    const { host, lobby } = await room({ players: 2, webApi: web.api });
    await start(host);
    expect(web.calls).toEqual([
      {
        v: PROTOCOL_VERSION,
        raceId: expect.any(String),
        lobbyId: lobby,
        hostUserId: HOST_SUB,
        settings: DEFAULT_RACE_SETTINGS,
        desks: [
          { desk: 1, userId: HOST_SUB, name: "Ada", isBot: false },
          { desk: 2, userId: "usr_p0", name: "Clerk 0", isBot: false },
          { desk: 3, userId: "usr_p1", name: "Clerk 1", isBot: false },
        ],
      },
    ]);
  });
});

describe("lifecycle: bots count as desks (#156 C3)", () => {
  it("the host alone with one bot starts; the start request lists the bot without a user", async () => {
    const web = fixtureWebApi({ now: () => 0 });
    const settings: RaceSettings = { ...DEFAULT_RACE_SETTINGS, bots: [{ level: "clerk" }] };
    const { host } = await room({ players: 0, settings, webApi: web.api });
    expect(await start(host)).toEqual({ ok: true, raceId: expect.any(String) });
    expect(web.calls).toHaveLength(1);
    expect(startRaceRequestSchema.safeParse(web.calls[0]).success).toBe(true);
    expect(web.calls[0]!.desks).toEqual([
      { desk: 1, userId: HOST_SUB, name: "Ada", isBot: false },
      { desk: 2, userId: null, name: expect.any(String), isBot: true },
    ]);
  });
});

describe("lifecycle: bots type from GO and stop with the race (#366 C3, C4)", () => {
  /** Host (and `players` players) with `bots`, started and run to GO; the host's snapshots kept. */
  async function botRace(bots: RaceSettings["bots"], players = 0) {
    const r = await room({ players, settings: { ...DEFAULT_RACE_SETTINGS, bots } });
    const snapshots: Snapshot[] = [];
    r.host.on("snapshot", (snap) => void snapshots.push(snap));
    const ack = await start(r.host);
    expect(ack).toMatchObject({ ok: true });
    r.booted.clock.advance(3_000);
    await until(() => r.booted.server.desks.get(r.lobby)?.phase === "running", WAIT_MS, "GO");
    return { ...r, snapshots, raceId: (ack as { raceId: string }).raceId };
  }
  const traceOf = (b: Booted, lobby: string, desk: number) =>
    b.server.desks.states(lobby).get(desk)?.trace.length ?? 0;
  /** Advances the fake clock in 100 ms steps, yielding to the socket and Redis between them. */
  async function stepFor(b: Booted, ms: number) {
    for (let done = 0; done < ms; done += 100) {
      b.clock.advance(100);
      await new Promise((r) => setImmediate(r));
    }
  }

  it("a bot removed by a settings change before START gets no driver; the other types, shows in snapshots and the rank", async () => {
    const r = await room({
      players: 0,
      settings: { ...DEFAULT_RACE_SETTINGS, bots: [{ level: "clerk" }, { level: "officer" }] },
    });
    // Bots leave highest desk first (#156): desk 3 goes, desk 2 stays.
    expect(await r.booted.server.registry.setBots(r.lobby, [{ level: "clerk" }])).toMatchObject({
      ok: true,
    });
    expect((await r.booted.server.registry.members(r.lobby))!.map((m) => m.desk)).toEqual([1, 2]);
    const snapshots: Snapshot[] = [];
    r.host.on("snapshot", (snap) => void snapshots.push(snap));
    expect(await start(r.host)).toMatchObject({ ok: true });
    r.booted.clock.advance(3_000);
    await until(() => r.booted.server.desks.get(r.lobby)?.phase === "running", WAIT_MS, "GO");
    expect(r.booted.server.bots.active(r.lobby)).toEqual([2]);
    expect(r.booted.server.desks.get(r.lobby)!.desks.map((d) => d.desk)).toEqual([1, 2]);
    await stepFor(r.booted, 2_000);
    expect(traceOf(r.booted, r.lobby, 2)).toBeGreaterThan(0);
    // The bot leads the silent host in the live rank and its cursor is in the snapshots.
    await until(
      () => (snapshots.at(-1)?.desks.find((d) => d[0] === 2)?.[1] ?? 0) > 0,
      WAIT_MS,
      "bot row",
    );
    expect(snapshots.at(-1)!.ranks[0]).toBe(2);
  });

  it("a host and a bot: the bot finishes first, the race ends all-finished once the host finishes too", async () => {
    const { booted, lobby, host, seenHost } = await botRace([{ level: "major" }]);
    const text = FIXTURE_TEXT.content;
    for (
      let i = 0;
      i < 100 && booted.server.desks.states(lobby).get(2)?.status !== "finished";
      i++
    ) {
      await stepFor(booted, 500);
    }
    expect(booted.server.desks.states(lobby).get(2)?.status).toBe("finished");
    expect(booted.server.bots.active(lobby)).toEqual([]);
    expect(seenHost.ended).toHaveLength(0);
    const elapsed = booted.clock.now() - booted.server.desks.get(lobby)!.t0;
    typeKeys(host, text, elapsed, 1);
    await until(() => seenHost.ended.length === 1, WAIT_MS, "ended");
    expect(seenHost.ended[0]).toMatchObject({ reason: "all-finished" });
    expect(seenHost.ended[0]!.ranking.map((e) => [e.desk, e.isBot, e.status])).toEqual([
      [2, true, "finished"],
      [1, false, "finished"],
    ]);
  });

  it("an ending race (timer) stops every bot timer; no key lands afterwards", async () => {
    const { booted, lobby, seenHost } = await botRace([{ level: "recruit" }, { level: "clerk" }]);
    await stepFor(booted, 1_500);
    expect(booted.server.bots.active(lobby)).toEqual([2, 3]);
    await booted.server.lifecycle.endRace(lobby, "timer");
    expect(booted.server.bots.active(lobby)).toEqual([]);
    await until(() => seenHost.ended.length === 1, WAIT_MS, "ended");
    expect(seenHost.ended[0]!.ranking.filter((e) => e.isBot).map((e) => e.status)).toEqual([
      "typing",
      "typing",
    ]);
  });

  it("voidRoom and a closed room stop the bots", async () => {
    const a = await botRace([{ level: "clerk" }]);
    await stepFor(a.booted, 1_000);
    expect(a.booted.server.bots.active(a.lobby)).toEqual([2]);
    await a.booted.server.lifecycle.voidRoom(a.lobby, a.raceId);
    expect(a.booted.server.bots.active(a.lobby)).toEqual([]);
    await t!.stop();
    t = undefined;

    const b = await botRace([{ level: "clerk" }]);
    await stepFor(b.booted, 1_000);
    const before = traceOf(b.booted, b.lobby, 2);
    b.booted.server.lifecycle.onRoomClosed(b.lobby);
    expect(b.booted.server.bots.active(b.lobby)).toEqual([]);
    expect(b.booted.scheduler.armed()).toBe(0);
    await stepFor(b.booted, 2_000);
    expect(traceOf(b.booted, b.lobby, 2)).toBeLessThanOrEqual(before);
  });

  it("the race server's close() leaves no timer armed, bots included", async () => {
    const r = await botRace([{ level: "clerk" }, { level: "major" }]);
    await stepFor(r.booted, 1_000);
    expect(r.booted.server.bots.active(r.lobby)).toEqual([2, 3]);
    // `restart` closes this server (keys kept) and boots another: the closed one holds nothing.
    t = await r.booted.restart();
    expect(r.booted.server.bots.active(r.lobby)).toEqual([]);
    expect(r.booted.scheduler.armed()).toBe(0);
  });

  it("Race again: the first race's bots stopped at its end, the second race's start at its GO", async () => {
    const r = await botRace([{ level: "clerk" }]);
    await stepFor(r.booted, 1_000);
    await r.booted.server.lifecycle.endRace(r.lobby, "timer");
    await until(() => r.seenHost.ended.length === 1, WAIT_MS, "ended 1");
    expect(r.booted.server.bots.active(r.lobby)).toEqual([]);
    expect(await start(r.host)).toMatchObject({ ok: true });
    r.booted.clock.advance(3_000);
    await until(() => r.booted.server.desks.get(r.lobby)?.phase === "running", WAIT_MS, "GO 2");
    expect(r.booted.server.bots.active(r.lobby)).toEqual([2]);
    expect(traceOf(r.booted, r.lobby, 2)).toBe(0);
    await stepFor(r.booted, 1_500);
    expect(traceOf(r.booted, r.lobby, 2)).toBeGreaterThan(0);
  });
});

describe("lifecycle: text from the web app over the signed internal API (#199 C5)", () => {
  let stub: WebStub | undefined;
  afterEach(async () => {
    await stub?.close();
    stub = undefined;
  });

  it("host:start -> one signed request listing every desk; countdown and a second tab carry the text", async () => {
    stub = await startWebStub();
    const web = stub;
    // The real HMAC client against the in-process stub; wired once the boot's clock exists.
    const wired: { api?: WebApi } = {};
    const webApi: WebApi = {
      startRace: (req) => wired.api!.startRace(req),
      postResults: ackResults,
    };
    const { booted, lobby, host, seenHost, others, connectAs } = await room({ players: 2, webApi });
    wired.api = createWebApi({
      baseUrl: web.url,
      secret: SECRET,
      clock: booted.clock,
      scheduler: booted.scheduler,
    });

    const ack = await start(host);
    expect(ack).toMatchObject({ ok: true });
    expect(web.requests).toHaveLength(1);
    const [request] = web.requests;
    expect(request).toMatchObject({ method: "POST", url: "/api/internal/races" });
    expect(
      verifyInternalRequest({
        secret: SECRET,
        timestamp: request!.headers[INTERNAL_HEADERS.timestamp] as string,
        nonce: request!.headers[INTERNAL_HEADERS.nonce] as string,
        signature: request!.headers[INTERNAL_HEADERS.signature] as string,
        rawBody: request!.body,
        nowMs: booted.clock.now(),
      }),
    ).toEqual({ ok: true });
    const body = startRaceRequestSchema.parse(JSON.parse(request!.body));
    expect(body).toMatchObject({
      raceId: (ack as { raceId: string }).raceId,
      lobbyId: lobby,
      hostUserId: HOST_SUB,
    });
    expect(body.desks).toEqual([
      { desk: 1, userId: HOST_SUB, name: "Ada", isBot: false },
      { desk: 2, userId: "usr_p0", name: "Clerk 0", isBot: false },
      { desk: 3, userId: "usr_p1", name: "Clerk 1", isBot: false },
    ]);

    const everyone = [seenHost, ...others.map((o) => o.seen)];
    await until(() => everyone.every((s) => s.countdown.length === 1), WAIT_MS, "countdown");
    for (const seen of everyone) {
      expect(seen.countdown[0]!.race).toMatchObject({
        text: STUB_TEXT.content,
        language: STUB_TEXT.language,
        wordCount: STUB_TEXT.wordCount,
      });
    }

    booted.clock.advance(3_000);
    await eventually(async () => (await phaseOf(lobby)) === "running", "phase running");
    const tab = watch(await connectAs("usr_p0", "Clerk 0"));
    await until(() => !!tab.welcome, WAIT_MS, "second tab welcome");
    const welcome = welcomeSchema.parse(tab.welcome);
    expect(welcome.room.phase).toBe("running");
    expect(welcome.race?.text).toBe(STUB_TEXT.content);
    expect(web.requests).toHaveLength(1);
  });
});

describe("lifecycle: refusals (C2)", () => {
  it("a player token, or a host role with another sub, is not-host and nothing is emitted", async () => {
    const { lobby, others, seenHost, connectAs } = await room();
    expect(await start(others[0]!.client)).toEqual({ ok: false, error: "not-host" });
    const forged = await connectAs("usr_forger", "Eve", "host");
    expect(await start(forged)).toEqual({ ok: false, error: "not-host" });
    await settle();
    expect(seenHost.countdown).toHaveLength(0);
    expect(await phaseOf(lobby)).toBe("waiting");
  });

  it("the host alone is too-few", async () => {
    const { host } = await room({ players: 0 });
    expect(await start(host)).toEqual({ ok: false, error: "too-few" });
  });

  it("a start during countdown is not-waiting; two concurrent starts give one ok", async () => {
    const { host, seenHost } = await room();
    const [a, b] = await Promise.all([start(host), start(host)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((x) => !x.ok)).toEqual({ ok: false, error: "not-waiting" });
    expect(await start(host)).toEqual({ ok: false, error: "not-waiting" });
    await settle();
    expect(seenHost.countdown).toHaveLength(1);
  });

  it("a failing web start is start-failed, the phase stays waiting, a later start succeeds", async () => {
    const web = fixtureWebApi({ now: () => 0 });
    let fail = true;
    const webApi: WebApi = {
      startRace: (req) => (fail ? Promise.reject(new Error("500")) : web.api.startRace(req)),
      postResults: ackResults,
    };
    const { host, lobby, seenHost } = await room({ webApi });
    expect(await start(host)).toEqual({ ok: false, error: "start-failed" });
    await settle();
    expect(seenHost.countdown).toHaveLength(0);
    expect(await phaseOf(lobby)).toBe("waiting");

    fail = false;
    expect(await start(host)).toMatchObject({ ok: true });
  });

  it("a web start that never answers is start-failed after 5 s on the server clock", async () => {
    let called = false;
    const webApi: WebApi = {
      startRace: () => {
        called = true;
        return new Promise(() => {});
      },
      postResults: ackResults,
    };
    const { booted, host, lobby } = await room({ webApi });
    const ack = start(host);
    await until(() => called, WAIT_MS, "web start call");
    booted.clock.advance(5_000);
    expect(await ack).toEqual({ ok: false, error: "start-failed" });
    expect(await phaseOf(lobby)).toBe("waiting");
  });

  it("a web answer for another race id is start-failed", async () => {
    const web = fixtureWebApi({ now: () => 0 });
    const webApi: WebApi = {
      startRace: async (req) => ({
        ...(await web.api.startRace(req)),
        raceId: "6f1c2a4e-8b9d-4c3e-9f0a-1b2c3d4e5f60",
      }),
      postResults: ackResults,
    };
    const { host } = await room({ webApi });
    expect(await start(host)).toEqual({ ok: false, error: "start-failed" });
  });

  it("a malformed host:start gets no ack", async () => {
    const { host, seenHost } = await room();
    await expect(host.timeout(300).emitWithAck("host:start", "nope" as never)).rejects.toThrow();
    expect(seenHost.countdown).toHaveLength(0);
  });

  it("a new user's handshake during running is refused in-progress", async () => {
    const { booted, host, lobby } = await room();
    await start(host);
    booted.clock.advance(3_000);
    await eventually(async () => (await phaseOf(lobby)) === "running", "phase running");
    const late = booted.connect({
      v: PROTOCOL_VERSION,
      token: await booted.token({ lobby, sub: "usr_late", name: "Lou" }),
    });
    expect(await connectError(late)).toBe("in-progress");
  });
});

describe("lifecycle: timer end (C3)", () => {
  it("ends once at t0 + timerS with a full ranking; a second endRace emits nothing", async () => {
    const ends: RaceEnded[] = [];
    const { booted, host, lobby, seenHost, others } = await room({
      players: 2,
      settings: { ...DEFAULT_RACE_SETTINGS, timerS: 60 },
      onRaceEnded: (e) => void ends.push(e),
    });
    const ack = await start(host);
    await until(() => seenHost.countdown.length === 1, WAIT_MS, "countdown");
    booted.clock.advance(3_000);
    await eventually(async () => (await phaseOf(lobby)) === "running", "phase running");
    booted.clock.advance(59_999);
    await settle();
    expect(seenHost.ended).toHaveLength(0);
    booted.clock.advance(1);

    const everyone = [seenHost, ...others.map((o) => o.seen)];
    await until(
      () => everyone.every((s) => s.ended.length === 1),
      WAIT_MS,
      "ended to every member",
    );
    for (const seen of everyone) {
      const ended = endedSchema.parse(seen.ended[0]);
      expect(ended).toMatchObject({ raceId: (ack as { raceId: string }).raceId, reason: "timer" });
      expect(ended.ranking.map((r) => r.place)).toEqual([1, 2, 3]);
      expect(ended.ranking.map((r) => r.desk).sort()).toEqual([1, 2, 3]);
    }
    expect(await phaseOf(lobby)).toBe("ended");

    await booted.server.lifecycle.endRace(lobby, "timer");
    await settle();
    for (const seen of everyone) expect(seen.ended).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ lobbyId: lobby, reason: "timer" });
  });

  it(
    "an untimed race emits nothing after 10 minutes and ends as timer at t0 + MAX_RACE_MS",
    async () => {
      const { booted, host, lobby, seenHost, others } = await room();
      await start(host);
      await until(() => seenHost.countdown.length === 1, WAIT_MS, "countdown");
      const t0 = seenHost.countdown[0]!.race.t0;
      expect((await hash(lobby)).fields.endAt).toBe(String(t0 + MAX_RACE_MS));
      booted.clock.advance(3_000);
      await until(() => booted.server.desks.get(lobby)?.phase === "running", WAIT_MS, "GO");

      // Both desks send a wrong key and its correction every 40 s, so neither reaches the idle
      // kick (#183) and the race is still running when the hard stop fires.
      const clients = [host, ...others.map((o) => o.client)];
      const awakeUntil = async (at: number) => {
        while (booted.clock.now() < at) {
          booted.clock.advance(Math.min(40_000, at - booted.clock.now()));
          const t = booted.clock.now() - t0;
          const totals = () => [...booted.server.desks.states(lobby).values()].map((d) => d.total);
          const before = totals().reduce((a, b) => a + b, 0);
          for (const c of clients) {
            c.emit("keys", {
              v: PROTOCOL_VERSION,
              batch: [
                { t, key: "x" },
                { t, key: BACKSPACE },
              ],
            });
          }
          await until(
            () => totals().reduce((a, b) => a + b, 0) === before + 2 * clients.length,
            WAIT_MS,
            "awake keys",
          );
        }
      };
      await awakeUntil(t0 + 10 * 60_000);
      await settle();
      expect(seenHost.ended).toHaveLength(0);
      await awakeUntil(t0 + MAX_RACE_MS - 1);
      await settle();
      expect(seenHost.ended).toHaveLength(0);
      booted.clock.advance(1);
      await until(() => seenHost.ended.length === 1, WAIT_MS, "hard stop");
      expect(seenHost.ended[0]!.reason).toBe("timer");
    },
    10 * WAIT_MS,
  ); // ~36 000 fake ticks of 10 Hz snapshots (#173) inside one hour of fake time; scales with the wait deadline (#600)
});

describe("lifecycle: clock sync and a clock that never pauses (C4)", () => {
  it("ping { sent } -> pong { sent, serverNow } to the sender only; a bad ping is dropped", async () => {
    const { booted, host, seenHost, others } = await room();
    host.emit("ping", { v: PROTOCOL_VERSION, sent: 123 });
    await until(() => seenHost.pong.length === 1, WAIT_MS, "pong");
    expect(seenHost.pong[0]).toEqual({
      v: PROTOCOL_VERSION,
      sent: 123,
      serverNow: booted.clock.now(),
    });

    host.emit("ping", { v: PROTOCOL_VERSION, sent: -1 } as never);
    host.emit("ping", "nope" as never);
    await settle();
    expect(seenHost.pong).toHaveLength(1);
    expect(others[0]!.seen.pong).toHaveLength(0);
  });

  it("a member disconnecting during running leaves t0, endAt and the race unchanged", async () => {
    const { booted, host, lobby, seenHost, others } = await room({
      settings: { ...DEFAULT_RACE_SETTINGS, timerS: 60 },
    });
    const lineCuts: number[] = [];
    host.on("event", (e) => void (e.kind === "line-cut" && lineCuts.push(e.desk)));
    await start(host);
    booted.clock.advance(3_000);
    await eventually(async () => (await phaseOf(lobby)) === "running", "phase running");
    const before = (await hash(lobby)).fields;

    // #178: the desk is line-cut, not freed; the clock never pauses.
    others[0]!.client.disconnect();
    await until(() => lineCuts.length === 1, WAIT_MS, "line cut");
    const after = await hash(lobby);
    expect(after.fields).toEqual(before);
    expect(after.ttl).toBeGreaterThan(0);
    expect(await booted.server.registry.members(lobby)).toHaveLength(2);

    // The dropped desk is still ranked from the desks captured at start.
    booted.clock.advance(60_000);
    await until(() => seenHost.ended.length === 1, WAIT_MS, "ended");
    expect(seenHost.ended[0]!.ranking.map((r) => r.desk).sort()).toEqual([1, 2]);
  });
});

describe("lifecycle: room close", () => {
  it("closing the room cancels its lifecycle and grace timers (#178: no leave mid-race)", async () => {
    const { booted, host, lobby, others } = await room();
    await start(host);
    expect(booted.scheduler.armed()).toBe(2);
    others[0]!.client.disconnect();
    host.disconnect();
    // GO, timer end, two grace timers; the room stays open while the race is on.
    await until(() => booted.scheduler.armed() === 4, WAIT_MS, "grace timers armed");
    expect((await hash(lobby)).fields.openedAt).toBeDefined();
    booted.server.lifecycle.onRoomClosed(lobby);
    expect(booted.scheduler.armed()).toBe(0);
  });

  it("the last member leaving after the end keeps the room for Race again, with no timer left (#143)", async () => {
    const { booted, host, lobby, seenHost, others } = await room({
      settings: { ...DEFAULT_RACE_SETTINGS, timerS: 60 },
    });
    await start(host);
    booted.clock.advance(63_000);
    await until(() => seenHost.ended.length === 1, WAIT_MS, "ended");
    others[0]!.client.disconnect();
    host.disconnect();
    await eventually(async () => {
      const { fields, ttl } = await hash(lobby);
      return fields.phase === "ended" && ttl > 0 && ttl <= ENDED_GRACE_TTL_S;
    }, "room kept under the grace TTL");
    // #658: the process holds nothing of the room any more.
    await until(() => booted.scheduler.armed() === 0, WAIT_MS, "no timer armed");
    expect(booted.server.desks.get(lobby)).toBeUndefined();
  });
});

describe("lifecycle: race again (#143)", () => {
  /** A room of the host and one player whose first race ended on its 60 s timer. */
  async function endedRoom(options: { webApi?: WebApi } = {}) {
    const r = await room({ settings: { ...DEFAULT_RACE_SETTINGS, timerS: 60 }, ...options });
    const first = await start(r.host);
    expect(first).toMatchObject({ ok: true });
    await until(() => r.seenHost.countdown.length === 1, WAIT_MS, "countdown 1");
    r.booted.clock.advance(63_000);
    await until(() => r.seenHost.ended.length === 1, WAIT_MS, "ended 1");
    expect(await phaseOf(r.lobby)).toBe("ended");
    return { ...r, raceId1: (first as { raceId: string }).raceId };
  }

  it("host:start on an ended room starts a new race: new raceId, countdown to all, GO at t0 (C1)", async () => {
    const { booted, host, lobby, seenHost, others, raceId1 } = await endedRoom();
    await redis(async (c) => c.hset(roomKey(lobby), { endReason: "void", endedAt: "1" }));

    const ack = await start(host);
    expect(ack).toEqual({ ok: true, raceId: expect.any(String) });
    const raceId2 = (ack as { raceId: string }).raceId;
    expect(raceId2).not.toBe(raceId1);
    await until(
      () => seenHost.countdown.length === 2 && others[0]!.seen.countdown.length === 2,
      WAIT_MS,
      "second countdown to every member",
    );
    const race = seenHost.countdown[1]!.race;
    expect(race).toMatchObject({ raceId: raceId2, t0: booted.clock.now() + 3_000 });
    const { fields } = await hash(lobby);
    expect(fields).toMatchObject({ phase: "countdown", raceId: raceId2, t0: String(race.t0) });
    expect(JSON.parse(fields.race!)).toEqual(race);
    expect(JSON.parse(fields.desks!)).toHaveLength(2);
    expect(fields.endReason).toBeUndefined();
    expect(fields.endedAt).toBeUndefined();

    booted.clock.advance(3_000);
    await eventually(async () => (await phaseOf(lobby)) === "running", "phase running");
    expect(booted.server.desks.get(lobby)?.raceId).toBe(raceId2);
  });

  it("refusals on an ended room keep it ended: not-host, too-few, start-failed (C1)", async () => {
    let fail = false;
    const web = fixtureWebApi({ now: () => 0 });
    const webApi: WebApi = {
      startRace: (req) => (fail ? Promise.reject(new Error("500")) : web.api.startRace(req)),
      postResults: ackResults,
    };
    const { host, lobby, seenHost, others } = await endedRoom({ webApi });

    expect(await start(others[0]!.client)).toEqual({ ok: false, error: "not-host" });
    fail = true;
    expect(await start(host)).toEqual({ ok: false, error: "start-failed" });
    expect(await phaseOf(lobby)).toBe("ended");
    fail = false;
    others[0]!.client.disconnect();
    await until(() => seenHost.roster?.length === 1, WAIT_MS, "player gone");
    expect(await start(host)).toEqual({ ok: false, error: "too-few" });
    await settle();
    expect(seenHost.countdown).toHaveLength(1);
    expect(await phaseOf(lobby)).toBe("ended");
  });

  it("two races in one room: fresh desks and traces, two results with distinct ids and their own keys (C2)", async () => {
    const web = fixtureWebApi({ now: () => 0 });
    const { booted, host, lobby, seenHost } = await room({
      settings: { ...DEFAULT_RACE_SETTINGS, timerS: 60 },
      webApi: web.api,
    });
    const race = async (n: number, chars: string) => {
      const ack = await start(host);
      expect(ack).toMatchObject({ ok: true });
      await until(() => seenHost.countdown.length === n, WAIT_MS, `countdown ${n}`);
      if (n === 2) {
        // Nothing of race 1 is left before race 2's countdown: no runtime, no mirror, no trace.
        expect(booted.server.desks.get(lobby)).toBeUndefined();
        await redis(async (c) => {
          expect(await c.exists(desksKey(lobby), traceKey(lobby, 1), traceKey(lobby, 2))).toBe(0);
        });
      }
      booted.clock.advance(3_000);
      await until(() => booted.server.desks.get(lobby)?.phase === "running", WAIT_MS, `GO ${n}`);
      expect(booted.server.desks.states(lobby).get(1)?.trace).toEqual([]);
      typeKeys(host, chars, 100, 50);
      await until(
        () => booted.server.desks.states(lobby).get(1)?.trace.length === chars.length,
        WAIT_MS,
        `keys of race ${n}`,
      );
      booted.clock.advance(60_000);
      await until(() => web.results.length === n, WAIT_MS, `results of race ${n}`);
      return (ack as { raceId: string }).raceId;
    };

    const raceId1 = await race(1, "Le for");
    const first = structuredClone(web.results[0]!);
    const raceId2 = await race(2, "Le");

    expect(web.calls.map((c) => c.raceId)).toEqual([raceId1, raceId2]);
    expect(web.results.map((r) => r.raceId)).toEqual([raceId1, raceId2]);
    const desk1 = (n: number) => web.results[n]!.results.find((r) => r.desk === 1)!;
    expect(desk1(0).trace.count).toBe(6);
    expect(desk1(1).trace.count).toBe(2);
    expect(web.results[0]).toEqual(first);
  });

  it("members who left after the end come back at their desks and race again (C3)", async () => {
    const { booted, host, lobby, others, connectAs, raceId1 } = await endedRoom();
    others[0]!.client.disconnect();
    host.disconnect();
    await eventually(async () => (await hash(lobby)).ttl <= ENDED_GRACE_TTL_S, "room kept");

    const host2 = await connectAs(HOST_SUB, "Ada", "host");
    const seen2 = watch(host2);
    const back = await connectAs("usr_p0", "Clerk 0");
    const seenBack = watch(back);
    await until(() => seen2.roster?.length === 2 && !!seenBack.welcome, WAIT_MS, "both back");
    expect(seen2.welcome?.you).toBe(1);
    expect(seenBack.welcome?.you).toBe(2);
    expect((await hash(lobby)).ttl).toBeGreaterThan(ENDED_GRACE_TTL_S);
    // Nobody else comes in after the end (late joiners are #732).
    const late = booted.connect({
      v: PROTOCOL_VERSION,
      token: await booted.token({ lobby, sub: "usr_late", name: "Lou" }),
    });
    expect(await connectError(late)).toBe("in-progress");

    const ack = await start(host2);
    expect(ack).toEqual({ ok: true, raceId: expect.any(String) });
    expect((ack as { raceId: string }).raceId).not.toBe(raceId1);
    await until(
      () => seenBack.countdown.length === 1,
      WAIT_MS,
      "countdown to the returning member",
    );
  });
});

describe("lifecycle: room keys (C6)", () => {
  it("keeps both room keys under a TTL through start and end", async () => {
    const redis = await connectRedis(process.env.REDIS_URL);
    try {
      const { booted, host, lobby } = await room({
        settings: { ...DEFAULT_RACE_SETTINGS, timerS: 60 },
      });
      await start(host);
      booted.clock.advance(63_000);
      await eventually(async () => (await phaseOf(lobby)) === "ended", "phase ended");
      for (const key of [roomKey(lobby), membersKey(lobby)]) {
        expect(await redis.ttl(key)).toBeGreaterThan(0);
      }
    } finally {
      redis.disconnect();
    }
  });
});
