import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RACE_SETTINGS,
  PROTOCOL_VERSION,
  type CloseLobbyRequest,
  type RaceResultsRequest,
  type RankingEntry,
  type SetLobbyHostRequest,
} from "@fifth-copy/protocol";
import { createFakeClock, createFakeScheduler } from "../clock";
import { OUTBOX_TTL_S, OUTBOXES_KEY, outboxKey } from "../rooms/keys";
import {
  boot,
  connectRedis,
  fixtureWebApi,
  startedRace,
  track,
  until,
  type Booted,
} from "../testing/harness";
import { membersKey, roomKey } from "../rooms/keys";
import { LAST_LEAVE_GRACE_MS } from "../players/last-leave";
import { closeLobbyRequest, lobbyCloseOutboxId, sendOutboxEntry } from "./lobby-close";
import { lobbyHostOutboxId, sendLobbyHost, setLobbyHostRequest } from "./lobby-host";
import { createOutbox, retryDelayMs } from "./outbox";
import { WebApiStatusError, type WebApi } from "./web-api";
import { buildResults, sendResults } from "./results";

// #189 C2, C3: the results outbox on real Redis, in a key space of its own (ioredis keyPrefix), so
// no other test file's server drains these entries and these servers drain no one else's.

const url = process.env.REDIS_URL;
const prefix = `t189-outbox-${randomUUID()}:`;
let redis: Redis;

beforeAll(async () => {
  redis = await connectRedis(url, prefix);
});
afterAll(async () => {
  const ids = await redis.smembers(OUTBOXES_KEY);
  await redis.del(OUTBOXES_KEY, ...ids.map(outboxKey));
  redis.disconnect();
});
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const pendingIn = async (id: string) => ({
  length: await redis.llen(outboxKey(id)),
  listed: (await redis.sismember(OUTBOXES_KEY, id)) === 1,
});

function results(desks: number): RaceResultsRequest[] {
  const ranking: RankingEntry[] = Array.from({ length: desks }, (_, i) => ({
    place: i + 1,
    desk: i + 1,
    name: `Clerk ${i + 1}`,
    isBot: false,
    status: "typing",
    wpm: 0,
    rawWpm: 0,
    accuracy: 1,
    progress: 0,
    finishedAt: null,
  }));
  return buildResults(
    {
      lobbyId: "lob_1",
      raceId: randomUUID(),
      reason: "timer",
      ranking,
      endedAt: 1_767_225_660_000,
      elapsedMs: 60_000,
    },
    {
      text: "bonjour",
      engine: { errorMode: "continue", backspace: true },
      desks: ranking.map((e) => ({
        desk: e.desk,
        userId: `u${e.desk}`,
        name: e.name,
        isBot: false,
      })),
      states: new Map(),
    },
  );
}

describe("retryDelayMs", () => {
  it("1 s, 2 s, 4 s ... capped at 60 s", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 50].map(retryDelayMs)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000,
    ]);
  });
});

describe("outbox (C2)", () => {
  function setup(answers: boolean[]) {
    const clock = createFakeClock(1_767_225_600_000);
    const scheduler = createFakeScheduler(clock);
    const sent: { at: number; entry: unknown }[] = [];
    const outbox = createOutbox({
      redis,
      clock,
      scheduler,
      send: async (entry) => {
        sent.push({ at: clock.now(), entry });
        const ok = answers.shift();
        if (ok === undefined) throw new Error("web down");
        return ok;
      },
    });
    return { clock, scheduler, sent, outbox };
  }

  it("fails twice then succeeds: sent 3 times 1 s then 2 s apart, then removed; TTLs while pending", async () => {
    const { clock, scheduler, sent, outbox } = setup([false, false, true]);
    const [entry] = results(3);
    const id = entry!.raceId;
    await outbox.enqueue(id, [entry]);
    await until(() => sent.length === 1, 2_000, "first send");
    await settle();
    expect(await pendingIn(id)).toEqual({ length: 1, listed: true });
    const ttl = await redis.ttl(outboxKey(id));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(OUTBOX_TTL_S);
    expect(await redis.ttl(OUTBOXES_KEY)).toBeGreaterThan(0);

    clock.advance(999);
    await settle();
    expect(sent).toHaveLength(1);
    clock.advance(1);
    await until(() => sent.length === 2, 2_000, "second send");
    await settle();
    clock.advance(2_000);
    await until(() => sent.length === 3, 2_000, "third send");
    await until(() => scheduler.armed() === 0, 2_000, "no retry left");
    await settle();

    expect(sent.map((s) => s.at - sent[0]!.at)).toEqual([0, 1_000, 3_000]);
    expect(sent.every((s) => JSON.stringify(s.entry) === JSON.stringify(entry))).toBe(true);
    expect(await pendingIn(id)).toEqual({ length: 0, listed: false });
    outbox.close();
  });

  it("Race again (#143): a second race of the room gets its own entry; the first stays untouched", async () => {
    const { clock, sent, outbox } = setup([false, true, true]);
    const [first] = results(2);
    const [second] = results(2);
    await outbox.enqueue(first!.raceId, [first!]);
    await until(() => sent.length === 1, 2_000, "first race sent, refused");
    await outbox.enqueue(second!.raceId, [second!]);
    await until(() => sent.length === 2, 2_000, "second race sent");
    await settle();
    expect(await pendingIn(second!.raceId)).toEqual({ length: 0, listed: false });
    expect(await pendingIn(first!.raceId)).toEqual({ length: 1, listed: true });
    expect(JSON.parse((await redis.lindex(outboxKey(first!.raceId), 0))!)).toEqual(first);

    clock.advance(1_000);
    await until(() => sent.length === 3, 2_000, "first race retried");
    await settle();
    expect(sent.map((s) => (s.entry as RaceResultsRequest).raceId)).toEqual([
      first!.raceId,
      second!.raceId,
      first!.raceId,
    ]);
    expect(await pendingIn(first!.raceId)).toEqual({ length: 0, listed: false });
    outbox.close();
  });

  it("30 results are 2 chunks, sent in order, then removed", async () => {
    const { sent, outbox } = setup([true, true]);
    const chunks = results(30);
    expect(chunks).toHaveLength(2);
    const id = chunks[0]!.raceId;
    await outbox.enqueue(id, chunks);
    await until(() => sent.length === 2, 2_000, "two sends");
    await settle();
    expect(sent.map((s) => (s.entry as RaceResultsRequest).results.length)).toEqual([25, 5]);
    expect(await pendingIn(id)).toEqual({ length: 0, listed: false });
    outbox.close();
  });

  it("a rejected send is retried; after 24 h on the clock the race is dropped", async () => {
    const { clock, scheduler, sent, outbox } = setup([]);
    const [entry] = results(1);
    const id = entry!.raceId;
    await outbox.enqueue(id, [entry]);
    await until(() => sent.length === 1, 2_000, "first send");
    await settle();
    clock.advance(OUTBOX_TTL_S * 1000);
    await until(() => sent.length === 2, 2_000, "retry");
    await settle();
    expect(scheduler.armed()).toBe(0);
    expect(await pendingIn(id)).toEqual({ length: 0, listed: false });
    outbox.close();
  });

  it("close cancels the pending retry", async () => {
    const { scheduler, sent, outbox } = setup([false]);
    const [entry] = results(1);
    await outbox.enqueue(entry!.raceId, [entry]);
    await until(() => sent.length === 1, 2_000, "first send");
    await until(() => scheduler.armed() === 1, 2_000, "retry armed");
    outbox.close();
    expect(scheduler.armed()).toBe(0);
    await redis.del(outboxKey(entry!.raceId));
    await redis.srem(OUTBOXES_KEY, entry!.raceId);
  });

  it("sendResults wiring: a partial acknowledgement keeps the entry", async () => {
    const clock = createFakeClock(0);
    const scheduler = createFakeScheduler(clock);
    let calls = 0;
    const outbox = createOutbox({
      redis,
      clock,
      scheduler,
      send: sendResults({
        postResults: async (request) => {
          calls += 1;
          return { v: request.v, raceId: request.raceId, persisted: [request.results[0]!.desk] };
        },
      }),
    });
    const [entry] = results(2);
    await outbox.enqueue(entry!.raceId, [entry]);
    await until(() => calls === 1, 2_000, "send");
    await settle();
    expect(await pendingIn(entry!.raceId)).toEqual({ length: 1, listed: true });
    outbox.close();
    await redis.del(outboxKey(entry!.raceId));
    await redis.srem(OUTBOXES_KEY, entry!.raceId);
  });
});

describe("outbox across a restart (C3)", () => {
  let booted: Booted | undefined;
  afterEach(async () => {
    await booted?.stop();
    booted = undefined;
  });

  it("a pending entry survives server.close(); the next server drains it on creation", async () => {
    let failing = 0;
    const r = await startedRace(url, {
      players: 2,
      settings: { ...DEFAULT_RACE_SETTINGS, timerS: 60 },
      redisPrefix: prefix,
      postResults: () => {
        failing += 1;
        return Promise.reject(new Error("web down"));
      },
    });
    booted = r.booted;
    r.booted.clock.advance(r.t0 + 60_000 - r.booted.clock.now());
    await until(() => failing === 1, 3_000, "first failed post");
    const raceId = r.racers[0]!.seen.ended[0]?.raceId ?? (await redis.smembers(OUTBOXES_KEY))[0]!;
    await settle();
    expect(await pendingIn(raceId)).toEqual({ length: 1, listed: true });

    await r.booted.stop();
    booted = undefined;
    expect(await pendingIn(raceId)).toEqual({ length: 1, listed: true });

    const web = fixtureWebApi({ now: () => Date.now() });
    booted = await boot(url, { webApi: web.api, redisPrefix: prefix });
    await until(() => web.results.some((req) => req.raceId === raceId), 3_000, "drained entry");
    const request = web.results.find((req) => req.raceId === raceId)!;
    expect(request.results.map((x) => x.desk)).toEqual([1, 2]);
    await until(() => failing === 1, 100, "no more sends to the old server");
    await settle();
    expect(await pendingIn(raceId)).toEqual({ length: 0, listed: false });
  });

  it("a void end never creates an outbox entry", async () => {
    let posts = 0;
    const r = await startedRace(url, {
      players: 2,
      redisPrefix: prefix,
      postResults: () => {
        posts += 1;
        return Promise.reject(new Error("never called"));
      },
    });
    booted = r.booted;
    await r.booted.server.lifecycle.endRace(r.lobby, "void");
    await until(() => r.racers[0]!.seen.ended.length === 1, 2_000, "ended");
    const { raceId, reason } = r.racers[0]!.seen.ended[0]!;
    expect(reason).toBe("void");
    await settle(100);
    expect(posts).toBe(0);
    expect(await pendingIn(raceId)).toEqual({ length: 0, listed: false });
    expect(await redis.exists(outboxKey(raceId))).toBe(0);
  });
});

describe("lobby close through the outbox (#734 C2)", () => {
  let booted: Booted | undefined;
  afterEach(async () => {
    await booted?.stop();
    booted = undefined;
  });

  /** A web whose close call fails `down` times (web outage), then acknowledges. */
  function closingWeb(clock: { now(): number }, down = 0) {
    const web = fixtureWebApi(clock);
    const closes: { at: number; request: CloseLobbyRequest }[] = [];
    let failures = down;
    const api: WebApi = {
      ...web.api,
      closeLobby: async (request) => {
        closes.push({ at: clock.now(), request });
        if (failures > 0) {
          failures -= 1;
          throw new Error("web down");
        }
        return { v: PROTOCOL_VERSION, lobbyId: request.lobbyId, changed: true };
      },
    };
    return { api, closes };
  }

  it("sendOutboxEntry: a close entry goes to closeLobby, a results entry to postResults", async () => {
    const calls: string[] = [];
    const web = fixtureWebApi({ now: () => 0 });
    const send = sendOutboxEntry({
      postResults: async (req) => {
        calls.push(`results ${req.raceId}`);
        return web.api.postResults(req);
      },
      closeLobby: async (req) => {
        calls.push(`close ${req.lobbyId}`);
        return { v: PROTOCOL_VERSION, lobbyId: req.lobbyId, changed: false };
      },
      setLobbyHost: async (req) => {
        calls.push(`host ${req.lobbyId} ${req.hostUserId}`);
        return { v: PROTOCOL_VERSION, lobbyId: req.lobbyId, changed: true };
      },
    });
    const [chunk] = results(1);
    expect(await send(closeLobbyRequest("lob_1", 5))).toBe(true);
    expect(await send(chunk)).toBe(true);
    // #137 C3: a host transfer entry goes to setLobbyHost
    expect(await send(setLobbyHostRequest("lob_1", "usr_a"))).toBe(true);
    expect(calls).toEqual(["close lob_1", `results ${chunk!.raceId}`, "host lob_1 usr_a"]);
  });

  it("sendOutboxEntry: a 404 (no such lobby) is acknowledged; a 500 or another lobby's answer is retried", async () => {
    const answer = (fn: WebApi["closeLobby"]) =>
      sendOutboxEntry({
        postResults: () => Promise.reject(new Error("unused")),
        closeLobby: fn,
        setLobbyHost: () => Promise.reject(new Error("unused")),
      });
    const entry = closeLobbyRequest("lob_1", 5);
    expect(await answer(() => Promise.reject(new WebApiStatusError(404)))(entry)).toBe(true);
    await expect(answer(() => Promise.reject(new WebApiStatusError(500)))(entry)).rejects.toThrow();
    expect(
      await answer(async () => ({ v: PROTOCOL_VERSION, lobbyId: "lob_2", changed: true }))(entry),
    ).toBe(false);
  });

  it("the last human leaving a waiting room queues the close after the grace; a web outage is retried and never blocks the leave", async () => {
    const clockRef = { now: () => booted!.clock.now() };
    const web = closingWeb(clockRef, 1);
    booted = await boot(url, { webApi: web.api, redisPrefix: prefix });
    const lobby = await booted.openRoom("CLS-0001");
    const host = booted.connect({ v: PROTOCOL_VERSION, token: await booted.token({ lobby }) });
    const seen = track(host);
    await until(() => !!seen.welcome, 2_000, "welcome");
    host.disconnect();
    await settle(100);
    // Inside the grace (#734: a reload): the room stands, nothing is sent.
    booted.clock.advance(LAST_LEAVE_GRACE_MS - 1);
    await settle();
    expect(web.closes).toHaveLength(0);
    expect(await redis.exists(roomKey(lobby))).toBe(1);

    booted.clock.advance(1);
    const leftAt = booted.clock.now();
    const closes = web.closes;
    await until(() => closes.length === 1, 2_000, "first close call");
    expect(closes[0]!.request).toEqual({ v: PROTOCOL_VERSION, lobbyId: lobby, closedAt: leftAt });
    // The leave completed (keys gone) even though the web is down.
    expect(await redis.exists(roomKey(lobby), membersKey(lobby))).toBe(0);
    await settle();
    const id = lobbyCloseOutboxId(lobby);
    expect(await pendingIn(id)).toEqual({ length: 1, listed: true });
    expect(await redis.ttl(outboxKey(id))).toBeGreaterThan(0);

    booted.clock.advance(1_000);
    await until(() => closes.length === 2, 2_000, "retried close call");
    await settle();
    expect(closes[1]!.request).toEqual(closes[0]!.request);
    expect(await pendingIn(id)).toEqual({ length: 0, listed: false });
  });

  it("host reload does not close: a new socket of the host within the grace keeps the room and its lobby", async () => {
    const web = fixtureWebApi({ now: () => Date.now() });
    booted = await boot(url, { webApi: web.api, redisPrefix: prefix });
    const lobby = await booted.openRoom("RLD-0734");
    const sub = "usr_reloading_host";
    const first = booted.connect({
      v: PROTOCOL_VERSION,
      token: await booted.token({ lobby, sub }),
    });
    const seenFirst = track(first);
    await until(() => !!seenFirst.welcome, 2_000, "first welcome");
    first.disconnect();
    await settle(100);
    booted.clock.advance(1_500);

    const again = booted.connect({
      v: PROTOCOL_VERSION,
      token: await booted.token({ lobby, sub }),
    });
    const seenAgain = track(again);
    await until(() => !!seenAgain.welcome, 2_000, "welcome after the reload");
    expect(seenAgain.welcome?.you).toBe(seenFirst.welcome?.you);
    booted.clock.advance(LAST_LEAVE_GRACE_MS * 2);
    await settle();
    expect(web.closes).toHaveLength(0);
    expect(await redis.exists(roomKey(lobby))).toBe(1);
    expect(await pendingIn(lobbyCloseOutboxId(lobby))).toEqual({ length: 0, listed: false });
  });

  it("a room found gone on rehydrate (#204) has its lobby closed on boot", async () => {
    const web = fixtureWebApi({ now: () => Date.now() });
    booted = await boot(url, { webApi: web.api, redisPrefix: prefix, recovery: true });
    const gone = await booted.openRoom("GON-0734");
    const live = await booted.openRoom("LIV-0734");
    await redis.del(roomKey(gone), membersKey(gone));
    booted = await booted.restart();
    await until(() => web.closes.some((c) => c.lobbyId === gone), 3_000, "gone lobby closed");
    expect(web.closes.map((c) => c.lobbyId)).not.toContain(live);
    await settle();
    expect(await pendingIn(lobbyCloseOutboxId(gone))).toEqual({ length: 0, listed: false });
  });
});

describe("lobby host transfer through the outbox (#137 C3)", () => {
  let booted: Booted | undefined;
  afterEach(async () => {
    await booted?.stop();
    booted = undefined;
  });

  it("sendLobbyHost: a 200 for the lobby and a 404 are acknowledged; a 500 or another lobby's answer is retried", async () => {
    const answer = (fn: WebApi["setLobbyHost"]) => sendLobbyHost({ setLobbyHost: fn });
    const entry = setLobbyHostRequest("lob_1", "usr_a");
    expect(
      await answer(async () => ({ v: PROTOCOL_VERSION, lobbyId: "lob_1", changed: false }))(entry),
    ).toBe(true);
    expect(await answer(() => Promise.reject(new WebApiStatusError(404)))(entry)).toBe(true);
    await expect(answer(() => Promise.reject(new WebApiStatusError(500)))(entry)).rejects.toThrow();
    expect(
      await answer(async () => ({ v: PROTOCOL_VERSION, lobbyId: "lob_2", changed: true }))(entry),
    ).toBe(false);
  });

  it("the host's leave queues the web's record of the promoted user; a web outage is retried and never blocks the promotion", async () => {
    const clock = { now: () => booted!.clock.now() };
    const web = fixtureWebApi(clock);
    const hosts: SetLobbyHostRequest[] = [];
    let failures = 1;
    booted = await boot(url, {
      redisPrefix: prefix,
      webApi: {
        ...web.api,
        setLobbyHost: async (request) => {
          hosts.push(request);
          if (failures-- > 0) throw new Error("web down");
          return { v: PROTOCOL_VERSION, lobbyId: request.lobbyId, changed: true };
        },
      },
    });
    const lobby = await booted.openRoom("HST-0137");
    const join = async (sub: string, role: "host" | "player") => {
      const client = booted!.connect({
        v: PROTOCOL_VERSION,
        token: await booted!.token({ lobby, sub, role }),
      });
      const seen = track(client);
      await until(() => !!seen.welcome, 2_000, `welcome ${sub}`);
      return { client, seen };
    };
    const host = await join("usr_host", "host");
    const a = await join("usr_a", "player");
    host.client.disconnect();
    await until(() => hosts.length === 1, 2_000, "first host call");
    expect(hosts[0]).toEqual({ v: PROTOCOL_VERSION, lobbyId: lobby, hostUserId: "usr_a" });
    // The promotion stands in the room although the web is down.
    expect(await redis.hget(roomKey(lobby), "hostUserId")).toBe("usr_a");
    await until(() => a.seen.roster?.length === 1, 2_000, "roster after the leave");
    expect(a.seen.roster?.[0]).toMatchObject({ isHost: true });
    await settle();
    const id = lobbyHostOutboxId(lobby);
    expect(await pendingIn(id)).toEqual({ length: 1, listed: true });
    expect(await redis.ttl(outboxKey(id))).toBeGreaterThan(0);

    booted.clock.advance(1_000);
    await until(() => hosts.length === 2, 2_000, "retried host call");
    await settle();
    expect(hosts[1]).toEqual(hosts[0]);
    expect(await pendingIn(id)).toEqual({ length: 0, listed: false });
  });
});
