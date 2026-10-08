import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RACE_SETTINGS, PROTOCOL_VERSION, type HostStartAck } from "@fifth-copy/protocol";
import {
  boot,
  connectError,
  connectRedis,
  fixtureWebApi,
  HOST_SUB,
  typeKeys,
  until,
  watchRace,
  type Booted,
  type Racer,
} from "../testing/harness";
import { TICK_MS } from "./tick";
import {
  desksKey,
  membersKey,
  OUTBOXES_KEY,
  resumeIndexKey,
  resumeKey,
  roomKey,
  ROOMS_KEY,
  traceKey,
  VOID_TTL_S,
} from "./keys";
import { RECONCILE_MS } from "./registry";

// #204: room recovery after a restart and after a Redis loss (ADR 0008 "Restart behaviour"), real
// Redis, fake clock and scheduler. Each test runs in a key space of its own (ioredis keyPrefix), so
// its `rooms` index holds only its rooms and recovery may be on.

const url = process.env.REDIS_URL;
const v = PROTOCOL_VERSION;
let open: { b: Booted; redis: Redis } | undefined;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (open) {
    await open.b.stop();
    open.redis.disconnect();
  }
  open = undefined;
});

/** Boots a server with recovery on, in a fresh key space; `redis` reads that space. */
async function bootSpace() {
  const prefix = `t204-${randomUUID()}:`;
  const web = fixtureWebApi({ now: () => Date.now() });
  const b = await boot(url, { redisPrefix: prefix, recovery: true, webApi: web.api });
  const redis = await connectRedis(url, prefix);
  open = { b, redis };
  return { b, redis, web, prefix };
}

/** Restarts the server of `open` (keys kept) and tracks the new boot for cleanup. */
async function restart() {
  const b = await open!.b.restart();
  open!.b = b;
  return b;
}

/** Seats the host and `players - 1` players over sockets. */
async function seat(b: Booted, lobby: string, players = 2): Promise<Racer[]> {
  const racers: Racer[] = [];
  for (let i = 0; i < players; i++) {
    const sub = i === 0 ? HOST_SUB : `usr_p${i}`;
    const role = i === 0 ? "host" : "player";
    const token = await b.token({ lobby, sub, name: `Clerk ${i}`, role });
    const client = b.connect({ v, token });
    const seen = watchRace(client);
    await until(() => !!seen.welcome, 3_000, `welcome ${i}`);
    racers.push({ client, seen, desk: seen.welcome!.you!, sub, token });
  }
  await until(() => racers.every((r) => r.seen.roster?.length === players), 3_000, "seated");
  return racers;
}

/** Starts the race from the host's socket and reaches GO; returns the race id. */
async function run(b: Booted, lobby: string, racers: Racer[]) {
  const ack: HostStartAck = await racers[0]!.client.timeout(2_000).emitWithAck("host:start", { v });
  if (!ack.ok) throw new Error(`start failed: ${ack.error}`);
  b.clock.advance(3_000);
  await until(() => b.server.desks.get(lobby)?.phase === "running", 3_000, "GO");
  return ack.raceId;
}

/** Polls an async check every 20 ms. */
async function eventually(check: () => Promise<boolean>, ms: number, what: string) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const settle = (ms = 100) => new Promise((r) => setTimeout(r, ms));

/** A running room with both desks typing and their counters and traces mirrored to Redis. */
async function typingRoom(b: Booted, redis: Redis) {
  const lobby = await b.openRoom("RUN-0001");
  const racers = await seat(b, lobby);
  const raceId = await run(b, lobby, racers);
  typeKeys(racers[0]!.client, "Le f", 100, 10);
  typeKeys(racers[1]!.client, "Le", 100, 10);
  await until(
    () => (b.server.desks.states(lobby).get(1)?.trace.length ?? 0) === 4,
    2_000,
    "keys applied",
  );
  await until(() => (b.server.desks.states(lobby).get(2)?.trace.length ?? 0) === 2, 2_000, "keys");
  b.clock.advance(TICK_MS);
  await eventually(
    async () =>
      (await redis.hlen(desksKey(lobby))) === 2 &&
      (await redis.exists(traceKey(lobby, 1), traceKey(lobby, 2))) === 2,
    2_000,
    "desks mirrored",
  );
  return { lobby, racers, raceId };
}

async function health(b: Booted) {
  const res = await fetch(`${b.url}/health`);
  return { status: res.status, body: (await res.json()) as { rooms: number } };
}

describe("room recovery: rehydrate on boot (#204 C1)", () => {
  it("brings waiting and ended rooms back as they were and voids the running one", async () => {
    let { b } = await bootSpace();
    const { redis } = open!;
    const { registry, lifecycle } = b.server;

    // Ended: two seats, a 60 s race run to its timer end.
    const ended = await b.openRoom("END-0001", { ...DEFAULT_RACE_SETTINGS, timerS: 60 });
    await registry.join(ended, { userId: HOST_SUB, name: "Host" });
    await registry.join(ended, { userId: "usr_e1", name: "Eve" });
    expect((await lifecycle.start(ended, { sub: HOST_SUB, role: "host" })).ok).toBe(true);
    b.clock.advance(3_000 + 60_000);
    await eventually(async () => (await registry.room(ended))?.phase === "ended", 2_000, "ended");

    // Waiting: two members.
    const waiting = await b.openRoom("WAI-0001");
    await registry.join(waiting, { userId: "usr_w1", name: "Wim" });
    await registry.join(waiting, { userId: "usr_w2", name: "Wes" });

    // Running: two desks typing, over sockets.
    const { lobby: running, racers } = await typingRoom(b, redis);
    const resumeKeys = Object.values(await redis.hgetall(resumeIndexKey(running)));
    expect(resumeKeys).toHaveLength(2);

    const waitingMembers = await redis.hgetall(membersKey(waiting));
    const endedBefore = [
      await redis.hgetall(roomKey(ended)),
      await redis.hgetall(membersKey(ended)),
    ];
    const runningMembers = await redis.hgetall(membersKey(running));
    expect(Object.keys(waitingMembers)).toHaveLength(2);

    b = await restart();
    void racers;

    expect(b.server.registry.count()).toBe(3);
    expect(await redis.hgetall(membersKey(waiting))).toEqual(waitingMembers);
    expect([await redis.hgetall(roomKey(ended)), await redis.hgetall(membersKey(ended))]).toEqual(
      endedBefore,
    );

    const voided = await redis.hgetall(roomKey(running));
    expect(voided).toMatchObject({
      phase: "ended",
      endReason: "void",
      endedAt: String(b.clock.now()),
    });
    expect(voided.race).toBeUndefined();
    expect(voided.raceId).toBeDefined();
    expect(await redis.hgetall(membersKey(running))).toEqual(runningMembers);
    expect(await redis.exists(desksKey(running), traceKey(running, 1), traceKey(running, 2))).toBe(
      0,
    );
    expect(await redis.exists(resumeIndexKey(running), ...resumeKeys.map(resumeKey))).toBe(0);
    for (const key of [roomKey(running), membersKey(running)]) {
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(VOID_TTL_S);
    }
    expect(await redis.smembers(ROOMS_KEY)).toEqual(
      expect.arrayContaining([waiting, ended, running]),
    );
  });

  it("drops from the index an id whose room keys are gone", async () => {
    let { b } = await bootSpace();
    const { redis } = open!;
    const gone = await b.openRoom("GON-0001");
    const kept = await b.openRoom("KEP-0001");
    await redis.del(roomKey(gone), membersKey(gone));
    b = await restart();
    expect(b.server.registry.count()).toBe(1);
    expect(await redis.smembers(ROOMS_KEY)).toEqual([kept]);
  });
});

describe("room recovery: client view of a voided room (#204 C2)", () => {
  it("welcome ended, then ended void; host:start not-waiting; deleted keys are no-room", async () => {
    let { b } = await bootSpace();
    const { redis } = open!;
    const { lobby, racers, raceId } = await typingRoom(b, redis);
    const stale = racers[0]!.seen.welcome!.resumeKey;
    expect(stale).toBeTruthy();

    b = await restart();
    const client = b.connect({ v, token: racers[0]!.token, resumeKey: stale });
    const order: string[] = [];
    client.onAny((event: string) => void order.push(event));
    const seen = watchRace(client);
    const since = Date.now();
    await until(() => seen.ended.length === 1, 1_000, "ended void");
    expect(Date.now() - since).toBeLessThan(1_000);
    expect(seen.welcome).toMatchObject({ room: { phase: "ended" }, race: null });
    expect(seen.ended[0]).toEqual({ v, raceId, reason: "void", ranking: [] });
    expect(order.indexOf("welcome")).toBeLessThan(order.indexOf("ended"));

    const ack: HostStartAck = await client.timeout(2_000).emitWithAck("host:start", { v });
    expect(ack).toEqual({ ok: false, error: "not-waiting" });
    await settle();
    expect(seen.ended).toHaveLength(1);

    await redis.del(roomKey(lobby), membersKey(lobby));
    const other = b.connect({ v, token: racers[1]!.token });
    expect(await connectError(other)).toBe("no-room");
  });
});

describe("room recovery: nothing persisted for a voided race (#204 C3)", () => {
  it("posts no results and leaves no outbox entry, after a restart and after a loss", async () => {
    const space = await bootSpace();
    const { web, prefix } = space;
    let { b } = space;
    const { redis } = open!;
    const restarted = await typingRoom(b, redis);
    b = await restart();
    const back = b.connect({ v, token: restarted.racers[1]!.token });
    const seen = watchRace(back);
    await until(() => seen.ended.length === 1, 1_000, "ended void");

    const lost = await typingRoom(b, redis);
    await redis.del(roomKey(lost.lobby), desksKey(lost.lobby));
    typeKeys(lost.racers[0]!.client, "o", 300);
    await until(() => b.server.desks.states(lost.lobby).get(1)?.trace.length === 5, 2_000, "key");
    b.clock.advance(TICK_MS);
    await until(() => lost.racers[0]!.seen.ended.length === 1, 2_000, "ended void (loss)");

    b.clock.advance(10 * 60_000);
    await settle(200);
    const raceIds = [restarted.raceId, lost.raceId];
    expect(web.results.filter((r) => raceIds.includes(r.raceId))).toEqual([]);
    expect(await redis.keys(`${prefix}outbox:*`)).toEqual([]);
    expect(await redis.smembers(OUTBOXES_KEY)).toEqual([]);
  });
});

describe("room recovery: count reconciliation (#204 C4)", () => {
  it("a room whose keys vanish leaves count() and /health at the next reconcile", async () => {
    const { b, redis } = await bootSpace();
    const kept = await b.openRoom("KEP-0001");
    const gone = await b.openRoom("GON-0001");
    await b.server.registry.join(gone, { userId: "usr_g1", name: "Gus" });
    expect(b.server.registry.count()).toBe(2);
    expect((await health(b)).body.rooms).toBe(2);

    await redis.del(roomKey(gone), membersKey(gone));
    b.clock.advance(RECONCILE_MS - 1_000);
    await settle();
    expect(b.server.registry.count()).toBe(2);
    b.clock.advance(1_000);
    await until(() => b.server.registry.count() === 1, 2_000, "reconciled");
    expect(await health(b)).toEqual({ status: 200, body: expect.objectContaining({ rooms: 1 }) });
    expect(await redis.smembers(ROOMS_KEY)).toEqual([kept]);

    // The timer re-arms: the next reconcile also sees a later loss.
    await redis.del(roomKey(kept), membersKey(kept));
    b.clock.advance(RECONCILE_MS);
    await until(() => b.server.registry.count() === 0, 2_000, "reconciled again");
  });
});

describe("room recovery: Redis loss mid-race (#204 C5)", () => {
  async function lose(withKeys: boolean) {
    const { b, redis } = await bootSpace();
    const { lobby, racers } = await typingRoom(b, redis);
    expect(b.server.registry.count()).toBe(1);
    await redis.del(desksKey(lobby), roomKey(lobby));
    if (withKeys) {
      typeKeys(racers[0]!.client, "o", 300);
      await until(() => b.server.desks.states(lobby).get(1)?.trace.length === 5, 2_000, "key");
      b.clock.advance(TICK_MS);
    } else {
      // Nothing dirty: the room is probed on its own at most once a second.
      b.clock.advance(1_000);
    }
    await until(() => racers.every((r) => r.seen.ended.length === 1), 2_000, "ended void");
    for (const r of racers) {
      expect(r.seen.ended[0]).toMatchObject({ reason: "void", ranking: [] });
    }
    const snapshots = racers[0]!.seen.snapshots.length;
    b.clock.advance(5_000);
    await settle(200);
    for (const r of racers) expect(r.seen.ended).toHaveLength(1);
    expect(racers[0]!.seen.snapshots.length).toBe(snapshots);
    expect(b.server.desks.get(lobby)).toBeUndefined();
    expect(b.server.registry.count()).toBe(0);
    expect(await health(b)).toEqual({ status: 200, body: expect.objectContaining({ rooms: 0 }) });
    expect(await redis.exists(desksKey(lobby), traceKey(lobby, 1), traceKey(lobby, 2))).toBe(0);
  }

  it("the next tick's flush sees the room gone: one ended void, loop stopped", async () => {
    await lose(true);
  });

  it("with nothing to flush, the once-a-second probe sees it", async () => {
    await lose(false);
  });
});
