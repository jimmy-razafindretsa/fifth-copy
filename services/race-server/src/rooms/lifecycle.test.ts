import { afterEach, describe, expect, it, vi } from "vitest";
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
  until,
  type Booted,
  SECRET,
  type Client,
} from "../testing/harness";
import { startWebStub, STUB_TEXT, type WebStub } from "../testing/web-stub";
import { membersKey, roomKey } from "./keys";
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
    () => [seenHost, ...others.map((o) => o.seen)].every((s) => s.roster?.length === players + 1),
    3_000,
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

/** Polls an async check (Redis reads) every 20 ms. */
async function eventually(check: () => Promise<boolean>, what: string, ms = 2_000) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
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
      2_000,
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
    await until(() => !!tab.welcome, 2_000, "second tab welcome");
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
    await until(() => everyone.every((s) => s.countdown.length === 1), 2_000, "countdown");
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
    await until(() => !!tab.welcome, 2_000, "second tab welcome");
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
    await until(() => called, 2_000, "web start call");
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
    await until(() => seenHost.countdown.length === 1, 2_000, "countdown");
    booted.clock.advance(3_000);
    await eventually(async () => (await phaseOf(lobby)) === "running", "phase running");
    booted.clock.advance(59_999);
    await settle();
    expect(seenHost.ended).toHaveLength(0);
    booted.clock.advance(1);

    const everyone = [seenHost, ...others.map((o) => o.seen)];
    await until(() => everyone.every((s) => s.ended.length === 1), 2_000, "ended to every member");
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

  it("an untimed race emits nothing after 10 minutes and ends as timer at t0 + MAX_RACE_MS", async () => {
    const { booted, host, lobby, seenHost } = await room();
    await start(host);
    await until(() => seenHost.countdown.length === 1, 2_000, "countdown");
    const t0 = seenHost.countdown[0]!.race.t0;
    expect((await hash(lobby)).fields.endAt).toBe(String(t0 + MAX_RACE_MS));

    booted.clock.advance(3_000 + 10 * 60_000);
    await settle();
    expect(seenHost.ended).toHaveLength(0);
    booted.clock.advance(t0 + MAX_RACE_MS - 1 - booted.clock.now());
    await settle();
    expect(seenHost.ended).toHaveLength(0);
    booted.clock.advance(1);
    await until(() => seenHost.ended.length === 1, 2_000, "hard stop");
    expect(seenHost.ended[0]!.reason).toBe("timer");
  }, 20_000); // ~36 000 fake ticks of 10 Hz snapshots (#173) run inside one hour of fake time
});

describe("lifecycle: clock sync and a clock that never pauses (C4)", () => {
  it("ping { sent } -> pong { sent, serverNow } to the sender only; a bad ping is dropped", async () => {
    const { booted, host, seenHost, others } = await room();
    host.emit("ping", { v: PROTOCOL_VERSION, sent: 123 });
    await until(() => seenHost.pong.length === 1, 2_000, "pong");
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
    await start(host);
    booted.clock.advance(3_000);
    await eventually(async () => (await phaseOf(lobby)) === "running", "phase running");
    const before = (await hash(lobby)).fields;

    others[0]!.client.disconnect();
    await until(() => seenHost.roster?.length === 1, 2_000, "roster after leave");
    const after = await hash(lobby);
    expect(after.fields).toEqual(before);
    expect(after.ttl).toBeGreaterThan(0);

    // The leaver is still ranked from the desks captured at start.
    booted.clock.advance(60_000);
    await until(() => seenHost.ended.length === 1, 2_000, "ended");
    expect(seenHost.ended[0]!.ranking.map((r) => r.desk).sort()).toEqual([1, 2]);
  });
});

describe("lifecycle: room close", () => {
  it("cancels the room's timers when its last member leaves", async () => {
    const { booted, host, lobby, others } = await room();
    await start(host);
    expect(booted.scheduler.armed()).toBe(2);
    others[0]!.client.disconnect();
    host.disconnect();
    await eventually(async () => (await hash(lobby)).fields.openedAt === undefined, "room closed");
    await until(() => booted.scheduler.armed() === 0, 2_000, "no timer armed");
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
