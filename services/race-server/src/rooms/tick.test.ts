import type { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RACE_SETTINGS,
  PROTOCOL_VERSION,
  snapshotSchema,
  type RaceEvent,
  type RaceInfo,
  type Snapshot,
} from "@fifth-copy/protocol";
import { createFakeClock, createFakeScheduler } from "../clock";
import { performance } from "node:perf_hooks";
import { createDesksState, traceCapOf } from "./desks-state";
import { ingest } from "./ingest";
import { createTicker, TICK_MS } from "./tick";

// #173: the 10 Hz tick on the fake clock and scheduler (C3). Redis is a stub: the mirror is
// covered by desks-state.test.ts and snapshot.bench.test.ts.

/** A Redis whose MULTI accepts any queued command and EXECs successfully; counts EXECs. */
function stubRedis() {
  const counts = { exec: 0 };
  const chain: Record<string, unknown> = {};
  chain.hset = () => chain;
  chain.expire = () => chain;
  chain.exec = async () => {
    counts.exec += 1;
    return [];
  };
  return { redis: { multi: () => chain } as unknown as Redis, counts };
}

const T0 = 50_000;
const race: RaceInfo = {
  raceId: "6f1c2a4e-8b9d-4c3e-9f0a-1b2c3d4e5f60",
  text: "le formulaire est en triple exemplaire et doit etre signe par le chef de service",
  language: "fr",
  wordCount: 15,
  t0: T0,
  timerS: null,
};
const desks = [1, 2, 3].map((desk) => ({ desk, userId: `u${desk}`, name: "D", isBot: false }));

function setup() {
  const clock = createFakeClock(T0);
  const scheduler = createFakeScheduler(clock);
  const { redis, counts } = stubRedis();
  const desksState = createDesksState({ redis });
  const snapshots: Snapshot[] = [];
  const events: RaceEvent[] = [];
  const terminal: string[] = [];
  const ticker = createTicker({
    desksState,
    clock,
    scheduler,
    emit: {
      room: (_lobby: string, event: string, payload: unknown) => {
        if (event === "snapshot") snapshots.push(payload as Snapshot);
        else events.push(payload as RaceEvent);
      },
      desk: (_lobby, _desk, payload) => void events.push(payload),
    },
    onTerminal: (lobby) => void terminal.push(lobby),
  });
  const rt = desksState.open("lob", { race, settings: DEFAULT_RACE_SETTINGS, desks });
  ticker.start("lob");
  return { clock, scheduler, desksState, ticker, rt, snapshots, events, terminal, counts };
}

describe("tick loop (C3)", () => {
  it("10 Hz full-state snapshots over 2 s for 3 desks at different speeds", () => {
    const { clock, rt, snapshots, counts } = setup();
    const speed = new Map([
      [1, 1],
      [2, 3],
      [3, 2],
    ]);
    const typed = new Map([...speed.keys()].map((d) => [d, 0]));
    for (let step = 0; step < 20; step++) {
      for (const [desk, perTick] of speed) {
        // Desk 3 stops after 1 s: its tuple must stay in every later snapshot, unchanged.
        if (desk === 3 && step >= 10) continue;
        const from = typed.get(desk)!;
        const chars = race.text.slice(from, from + perTick);
        const t = clock.now() - T0;
        ingest(
          rt,
          desk,
          [...chars].map((key) => ({ t, key })),
          clock.now(),
        );
        typed.set(desk, from + perTick);
      }
      clock.advance(TICK_MS);
    }

    expect(snapshots.length).toBeGreaterThanOrEqual(19);
    expect(snapshots.length).toBeLessThanOrEqual(21);
    for (const snapshot of snapshots) {
      snapshotSchema.parse(snapshot);
      expect(snapshot.desks.map(([desk]) => desk)).toEqual([1, 2, 3]);
      expect([...snapshot.ranks].sort()).toEqual([1, 2, 3]);
      const cursor = new Map(snapshot.desks.map(([desk, c]) => [desk, c]));
      const ordered = snapshot.ranks.map((d) => cursor.get(d)!);
      expect([...ordered].sort((a, b) => b - a)).toEqual(ordered);
    }
    expect(snapshots.at(-1)!.ranks).toEqual([2, 1, 3]);
    expect(snapshots.at(-1)!.t).toBe(2_000);
    const stopped = snapshots.slice(10).map((s) => s.desks.find(([d]) => d === 3));
    expect(new Set(stopped.map((tuple) => JSON.stringify(tuple))).size).toBe(1);
    expect(stopped[0]).toEqual([3, 20, 20, 0, 0]);
    // One mirror write per tick that had changes (the GO write is the first).
    expect(counts.exec).toBe(20);
  });

  it("finish runs one last tick and stops; stop arms nothing; a closed runtime stops the loop", () => {
    const a = setup();
    a.clock.advance(TICK_MS * 3);
    expect(a.snapshots).toHaveLength(3);
    a.ticker.finish("lob");
    expect(a.snapshots).toHaveLength(4);
    a.clock.advance(TICK_MS * 5);
    expect(a.snapshots).toHaveLength(4);
    expect(a.scheduler.armed()).toBe(0);

    const b = setup();
    b.desksState.end("lob");
    b.clock.advance(TICK_MS * 3);
    expect(b.snapshots).toHaveLength(0);
    expect(b.scheduler.armed()).toBe(0);
  });

  it("a desk turning terminal fires finished with its place and onTerminal once", () => {
    const { clock, rt, desksState, events, terminal } = setup();
    ingest(
      rt,
      2,
      [...race.text].map((key) => ({ t: 50, key })),
      T0 + 100,
    );
    desksState.set("lob", 3, { ...rt.states.get(3)!, status: "abandoned" });
    clock.advance(TICK_MS * 3);
    expect(events.filter((e) => e.kind === "finished")).toEqual([
      { v: PROTOCOL_VERSION, kind: "finished", desk: 2, place: 1 },
    ]);
    expect(terminal).toEqual(["lob"]);
  });

  it("a desk streaming keys at the wire's maximum stays bounded; the others keep flowing", () => {
    const { clock, rt, snapshots, desksState } = setup();
    const churn = (t: number) =>
      Array.from({ length: 64 }, (_, i) => ({ t, key: i % 2 === 0 ? "x" : "Backspace" }));
    const durations: number[] = [];
    for (let step = 0; step < 600; step++) {
      const t = clock.now() - T0;
      // Desk 1: one full batch every 10 ms (6 400 keys/s) for 60 s.
      for (let k = 0; k < 10; k++) ingest(rt, 1, churn(t), clock.now());
      // Desk 2: about 1 character per 100 ms, a normal typist.
      if (step < race.text.length) ingest(rt, 2, [{ t, key: race.text[step]! }], clock.now());
      const start = performance.now();
      clock.advance(TICK_MS);
      durations.push(performance.now() - start);
    }
    const flood = desksState.states("lob").get(1)!;
    expect(flood.trace.length).toBeLessThanOrEqual(traceCapOf(rt.textLength));
    expect(flood.droppedKeys).toBe(600 * 640 - flood.trace.length);
    expect(desksState.states("lob").get(2)).toMatchObject({ droppedKeys: 0, status: "finished" });
    expect(snapshots).toHaveLength(600);
    expect(snapshots.every((s) => s.desks.length === 3)).toBe(true);
    // Per-tick work does not grow with the flood: the median tick stays far below TICK_MS.
    const median = [...durations].sort((a, b) => a - b)[durations.length >> 1]!;
    expect(median).toBeLessThan(5);
  });
});
