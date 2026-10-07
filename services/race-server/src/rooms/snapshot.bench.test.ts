import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Command, Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initialState } from "@fifth-copy/engine";
import { DEFAULT_RACE_SETTINGS, snapshotSchema, type RaceInfo } from "@fifth-copy/protocol";
import { connectRedis } from "../testing/harness";
import { createDesksState, type DeskState } from "./desks-state";
import { desksKey, ROOM_TTL_S } from "./keys";
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
  if (lobbies.length) await redis.del(...lobbies.map(desksKey));
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
    lastKeyAt: 400_000 + i,
    timingAnomalies: 0,
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

  it("writes 100 changed desks in one pipeline (one EXEC) with the room TTL", async () => {
    const { lobbyId, desksState } = lateRoom();
    const sent: string[][] = [];
    const original = redis.sendCommand.bind(redis);
    vi.spyOn(redis, "sendCommand").mockImplementation((command: Command, ...rest) => {
      sent.push([command.name.toLowerCase(), ...command.args.slice(0, 3).map(String)]);
      return original(command, ...(rest as []));
    });
    const start = performance.now();
    await desksState.flush(lobbyId);
    const flushMs = performance.now() - start;

    expect(sent.filter(([name]) => name === "exec")).toHaveLength(1);
    expect(sent.map(([name]) => name)).toEqual(["multi", "hset", "expire", "exec"]);
    expect(sent[2]).toEqual(["expire", desksKey(lobbyId), String(ROOM_TTL_S)]);
    expect(await redis.hlen(desksKey(lobbyId))).toBe(DESKS);
    expect(await redis.ttl(desksKey(lobbyId))).toBeGreaterThan(0);

    // Measured, not asserted (BRIEF risk b): the full mirror (typed row and trace per desk).
    const stringify = performance.now();
    for (let desk = 1; desk <= DESKS; desk++) JSON.stringify(desksState.states(lobbyId).get(desk));
    console.log(
      JSON.stringify({
        bench: "desks-mirror",
        stringifyMs: performance.now() - stringify,
        flushMs,
      }),
    );
  });
});
