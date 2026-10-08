import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Command, Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initialState } from "@fifth-copy/engine";
import { DEFAULT_RACE_SETTINGS, snapshotSchema, type RaceInfo } from "@fifth-copy/protocol";
import { connectRedis } from "../testing/harness";
import { createDesksState, deskBonusOf, type DeskState } from "./desks-state";
import { desksKey, ROOM_TTL_S, traceKey } from "./keys";
import { collectSnapshot } from "./live-rank";

// #173 C6: the per-tick budget for 100 desks at late-race magnitudes (ARCHITECTURE 10: snapshot
// serialisation < 2 ms; 7.9: bytes out per snapshot). Real Redis for the mirror write.
let redis: Redis;
const lobbies: string[] = [];
beforeAll(async () => {
  redis = await connectRedis(process.env.REDIS_URL);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  const keys = lobbies.flatMap((id) => [
    desksKey(id),
    ...Array.from({ length: DESKS }, (_, i) => traceKey(id, i + 1)),
  ]);
  if (keys.length) await redis.del(...keys);
  redis.disconnect();
});

const DESKS = 100;
const TEXT_CHARS = 3_000;
const word = "exemplaire ";
const race: RaceInfo = {
  raceId: "6f1c2a4e-8b9d-4c3e-9f0a-1b2c3d4e5f60",
  text: word
    .repeat(Math.ceil(TEXT_CHARS / word.length))
    .slice(0, TEXT_CHARS)
    .trim(),
  language: "fr",
  wordCount: 273,
  t0: 0,
  timerS: null,
};

/** Desk `i` at cursor >= 2 000 and errors >= 40, with a full `typed` row and trace. */
function lateDesk(i: number): DeskState {
  const cursor = 2_000 + ((i * 37) % 900);
  const errors = 40 + (i % 50);
  const finished = i % 10 === 0;
  return {
    ...initialState(),
    cursor,
    correct: cursor - errors,
    errors,
    total: cursor + 15,
    typed: Array.from({ length: cursor }, (_, k) => (k % 50 === 0 ? "x" : null)),
    status: finished ? "finished" : "typing",
    lastT: 400_000 + i,
    finishedAt: finished ? 400_000 + i : null,
    ...deskBonusOf(TEXT_CHARS),
    lastKeyAt: 400_000 + i,
    timingAnomalies: 0,
    droppedKeys: 0,
    trace: Array.from({ length: cursor + 15 }, (_, k) => ({ t: k * 150, key: "e" })),
  };
}

function lateRoom() {
  const lobbyId = `lob_${randomUUID()}`;
  lobbies.push(lobbyId);
  const desksState = createDesksState({ redis });
  const desks = Array.from({ length: DESKS }, (_, i) => ({
    desk: i + 1,
    userId: `u${i}`,
    name: `Clerk ${i}`,
    isBot: false,
  }));
  const runtime = desksState.open(lobbyId, { race, settings: DEFAULT_RACE_SETTINGS, desks });
  for (const { desk } of desks) desksState.set(lobbyId, desk, lateDesk(desk));
  return { lobbyId, desksState, runtime };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

describe("snapshot budget (C6)", () => {
  it("builds and stringifies a 100-desk late-race snapshot in < 2 ms (median of 50) and < 2 600 bytes", () => {
    const { runtime } = lateRoom();
    for (let i = 0; i < 10; i++) JSON.stringify(collectSnapshot(runtime, 420_000).snapshot);
    const times: number[] = [];
    let json = "";
    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      json = JSON.stringify(collectSnapshot(runtime, 420_000).snapshot);
      times.push(performance.now() - start);
    }
    const snapshot = snapshotSchema.parse(JSON.parse(json));
    expect(snapshot.desks).toHaveLength(DESKS);
    expect(Math.min(...snapshot.desks.map(([, cursor]) => cursor))).toBeGreaterThanOrEqual(2_000);
    expect(Math.min(...snapshot.desks.map(([, , , errors]) => errors))).toBeGreaterThanOrEqual(40);
    expect(median(times)).toBeLessThan(2);
    expect(Buffer.byteLength(json)).toBeLessThan(2_600);
    console.log(
      JSON.stringify({
        bench: "snapshot",
        medianMs: median(times),
        bytes: Buffer.byteLength(json),
      }),
    );
  });

  it("writes 100 changed desks in one pipeline (one EXEC), every written key with the room TTL", async () => {
    const { lobbyId, desksState } = lateRoom();
    const sent = spyCommands();
    const start = performance.now();
    await desksState.flush(lobbyId);
    const flushMs = performance.now() - start;

    expect(sent.filter(({ name }) => name === "exec")).toHaveLength(1);
    expect(sent.slice(0, 3).map(({ args }) => args.slice(0, 2))).toEqual([
      [],
      [desksKey(lobbyId), "1"],
      [desksKey(lobbyId), String(ROOM_TTL_S)],
    ]);
    expectEveryWriteHasTtl(sent);
    expect(await redis.hlen(desksKey(lobbyId))).toBe(DESKS);
    expect(await redis.ttl(desksKey(lobbyId))).toBeGreaterThan(0);
    const seven = desksState.states(lobbyId).get(7)!;
    expect(await redis.llen(traceKey(lobbyId, 7))).toBe(seven.trace.length);
    expect(await redis.ttl(traceKey(lobbyId, 7))).toBeGreaterThan(0);
    console.log(JSON.stringify({ bench: "desks-mirror-first", flushMs }));
  });

  it("C1: the next tick (2 new keys x 100 desks) builds in < 10 ms (median of 20) and queues < 100 kB", async () => {
    const { lobbyId, desksState } = lateRoom();
    await desksState.flush(lobbyId);
    const builds: number[] = [];
    const flushes: number[] = [];
    let bytes = 0;
    for (let run = 0; run < 20; run++) {
      for (let desk = 1; desk <= DESKS; desk++) {
        const state = desksState.states(lobbyId).get(desk)!;
        state.trace.push({ t: 500_000 + run * 2, key: "e" }, { t: 500_001 + run * 2, key: "e" });
        desksState.set(lobbyId, desk, { ...state, total: state.total + 2 });
      }
      const sent = spyCommands();
      const start = performance.now();
      await desksState.flush(lobbyId);
      flushes.push(performance.now() - start);
      const exec = sent.find(({ name }) => name === "exec")!;
      builds.push(exec.at - start);
      expect(sent.filter(({ name }) => name === "exec")).toHaveLength(1);
      expect(sent.filter(({ name }) => name === "del")).toHaveLength(0);
      expectEveryWriteHasTtl(sent);
      bytes = Math.max(
        bytes,
        sent.reduce((sum, { bytes: b }) => sum + b, 0),
      );
      vi.restoreAllMocks();
    }
    expect(median(builds)).toBeLessThan(10);
    expect(bytes).toBeLessThan(100_000);

    // The mirror still holds the whole trace, in order.
    const seven = desksState.states(lobbyId).get(7)!;
    const stored = (await redis.lrange(traceKey(lobbyId, 7), 0, -1)).map((e) => JSON.parse(e));
    expect(stored).toEqual(seven.trace);
    console.log(
      JSON.stringify({
        bench: "desks-mirror-next",
        buildMs: median(builds),
        flushMs: median(flushes),
        bytes,
      }),
    );
  });
});

type Sent = { name: string; args: string[]; bytes: number; at: number };

/** Records every command with its argument bytes and the instant it was handed to the client. */
function spyCommands() {
  const sent: Sent[] = [];
  const original = redis.sendCommand.bind(redis);
  vi.spyOn(redis, "sendCommand").mockImplementation((command: Command, ...rest) => {
    const args = command.args.map(String);
    const bytes = command.args.reduce<number>(
      (sum, a) => sum + (Buffer.isBuffer(a) ? a.length : Buffer.byteLength(String(a))),
      0,
    );
    sent.push({ name: command.name.toLowerCase(), args, bytes, at: performance.now() });
    return original(command, ...(rest as []));
  });
  return sent;
}

/** Every key written in the transaction (HSET, RPUSH, DEL) also gets `EXPIRE key ROOM_TTL_S` (C2). */
function expectEveryWriteHasTtl(sent: Sent[]) {
  const written = new Set(
    sent.filter(({ name }) => ["hset", "rpush", "del"].includes(name)).map(({ args }) => args[0]),
  );
  const expired = new Set(
    sent
      .filter(({ name, args }) => name === "expire" && args[1] === String(ROOM_TTL_S))
      .map(({ args }) => args[0]),
  );
  for (const key of written) expect(expired, `TTL for ${key}`).toContain(key);
}
