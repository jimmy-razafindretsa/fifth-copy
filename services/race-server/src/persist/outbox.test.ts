import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RACE_SETTINGS,
  type RaceResultsRequest,
  type RankingEntry,
} from "@fifth-copy/protocol";
import { createFakeClock, createFakeScheduler } from "../clock";
import { OUTBOX_TTL_S, OUTBOXES_KEY, outboxKey } from "../rooms/keys";
import {
  boot,
  connectRedis,
  fixtureWebApi,
  startedRace,
  until,
  type Booted,
} from "../testing/harness";
import { createOutbox, retryDelayMs } from "./outbox";
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
