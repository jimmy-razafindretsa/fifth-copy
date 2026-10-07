import type { Redis } from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialState, type Keystroke } from "@fifth-copy/engine";
import {
  DEFAULT_RACE_SETTINGS,
  endedSchema,
  MAX_KEYS_PER_BATCH,
  PLAYER_STATUS_CODES,
  playerStateSchema,
  PROTOCOL_VERSION,
  snapshotSchema,
  type RaceInfo,
} from "@fifth-copy/protocol";
import { connectRedis, startedRace, typeKeys, until, type Booted } from "../testing/harness";
import { createDesksState, deskStateOf, type DeskState } from "./desks-state";
import { traceCapOf } from "./desks-state";
import { ingest, KEYS_BURST, KEYS_PER_SECOND, MAX_LAG_MS, MAX_LEAD_MS } from "./ingest";
import { desksKey } from "./keys";
import type { RaceEnded } from "./lifecycle";

// #173: keystroke ingestion. Unit level (runtime only, no Redis) for the clamping table; socket level
// (real Redis, fake clock and scheduler, fake WebApi) for C1, C2 and C5.

const T0 = 1_000_000;
const race: RaceInfo = {
  raceId: "6f1c2a4e-8b9d-4c3e-9f0a-1b2c3d4e5f60",
  text: "bonjour",
  language: "fr",
  wordCount: 1,
  t0: T0,
  timerS: null,
};
const desks = [1, 2].map((desk) => ({ desk, userId: `u${desk}`, name: `D${desk}`, isBot: false }));

function runtime() {
  const state = createDesksState({ redis: {} as Redis });
  return { state, rt: state.open("lob", { race, settings: DEFAULT_RACE_SETTINGS, desks }) };
}
const keys = (chars: string, t: number, step = 0): Keystroke[] =>
  [...chars].map((key, i) => ({ t: t + i * step, key }));

describe("ingest: gates (C2)", () => {
  it("no runtime is before-go, an ended runtime is not-running, neither changes a state", () => {
    expect(ingest(undefined, 1, keys("b", 0), T0)).toEqual({
      rejected: "before-go",
      terminal: false,
    });
    const { state, rt } = runtime();
    state.end("lob");
    expect(ingest(rt, 1, keys("b", 0), T0 + 100)).toEqual({
      rejected: "not-running",
      terminal: false,
    });
    expect(rt.states.get(1)?.cursor).toBe(0);
  });

  it("drops silently a desk outside the race or not typing", () => {
    const { state, rt } = runtime();
    expect(ingest(rt, 9, keys("b", 0), T0)).toEqual({ terminal: false });
    const asleep: DeskState = { ...rt.states.get(2)!, status: "asleep" };
    state.set("lob", 2, asleep);
    expect(ingest(rt, 2, keys("b", 0), T0)).toEqual({ terminal: false });
    expect(rt.states.get(2)).toBe(asleep);
  });
});

describe("ingest: server clock (C2)", () => {
  const at = 10_000; // server elapsed since GO
  const cases: [string, Keystroke[], number[], number][] = [
    ["on time", keys("bon", at - 50, 10), [at - 50, at - 40, at - 30], 0],
    [
      "10 s ahead: clamped to +lead",
      keys("bo", at + 10_000, 5),
      [at + MAX_LEAD_MS, at + MAX_LEAD_MS],
      1,
    ],
    ["3 s behind: clamped to -lag", keys("b", at - 3_000), [at - MAX_LAG_MS], 1],
    [
      "decreasing: applied in order, raised to lastT",
      [
        { t: at - 10, key: "b" },
        { t: at - 30, key: "o" },
      ],
      [at - 10, at - 10],
      1,
    ],
  ];
  for (const [name, batch, applied, anomalies] of cases) {
    it(name, () => {
      const { rt } = runtime();
      ingest(rt, 1, batch, T0 + at);
      const desk = rt.states.get(1)!;
      expect(desk.trace.map((k) => k.t)).toEqual(applied);
      expect(desk.trace.map((k) => k.key)).toEqual(batch.map((k) => k.key));
      expect(desk.cursor).toBe(batch.length);
      expect(desk.timingAnomalies).toBe(anomalies);
      expect(desk.lastKeyAt).toBe(T0 + at);
      expect(rt.dirty.has(1)).toBe(true);
    });
  }

  it("a t below the desk's lastT from an earlier batch counts one anomaly and is applied", () => {
    const { rt } = runtime();
    ingest(rt, 1, keys("b", 5_000), T0 + 5_000);
    ingest(rt, 1, keys("o", 4_000), T0 + 5_100);
    const desk = rt.states.get(1)!;
    expect(desk.cursor).toBe(2);
    expect(desk.trace.map((k) => k.t)).toEqual([5_000, 5_000]);
    expect(desk.timingAnomalies).toBe(1);
  });

  it("never passes MAX_RACE_MS or goes below zero", () => {
    const { rt } = runtime();
    ingest(rt, 1, keys("b", 0), T0 - 500);
    expect(rt.states.get(1)!.trace[0]!.t).toBe(0);
    ingest(rt, 1, keys("o", 4_000_000), T0 + 3_700_000);
    expect(rt.states.get(1)!.trace[1]!.t).toBe(3_600_000);
  });

  it("finishing reports terminal and drops the rest of the batch", () => {
    const { rt } = runtime();
    expect(ingest(rt, 1, keys("bonjourxx", 100, 10), T0 + 200)).toEqual({ terminal: true });
    const desk = rt.states.get(1)!;
    expect(desk).toMatchObject({ cursor: 7, status: "finished", finishedAt: 160 });
    expect(desk.trace).toHaveLength(7);
  });

  it("an engine-rejected key is traced but changes nothing else", () => {
    const { rt } = runtime();
    const before = deskStateOf(initialState(), {
      lastKeyAt: T0,
      timingAnomalies: 0,
      droppedKeys: 0,
      trace: [],
    });
    expect(rt.states.get(1)).toEqual(before);
    ingest(rt, 1, [{ t: 100, key: "☃" }], T0 + 100);
    expect(rt.states.get(1)).toMatchObject({ cursor: 0, total: 0, trace: [{ t: 100, key: "☃" }] });
  });
});

describe("ingest: per-desk bounds", () => {
  /** 64 keys alternating a wrong key and Backspace: the cursor never passes 1. */
  const churn = (t: number): Keystroke[] =>
    Array.from({ length: 64 }, (_, i) => ({ t, key: i % 2 === 0 ? "x" : "Backspace" }));

  it("stores at most traceCapOf(textLength) keystrokes; the rest is counted, not applied", () => {
    const { rt } = runtime();
    const cap = traceCapOf(rt.textLength);
    const batches = Math.ceil(cap / 64) + 5;
    for (let i = 0; i < batches; i++) {
      // 2 s apart: the rate budget is full again at every batch.
      const elapsed = 2_000 * (i + 1);
      ingest(rt, 1, churn(elapsed), T0 + elapsed);
    }
    const desk = rt.states.get(1)!;
    expect(desk.trace).toHaveLength(cap);
    expect(desk.droppedKeys).toBe(batches * 64 - cap);
    expect(desk.total).toBe(cap);
    expect(desk.status).toBe("typing");
  });

  it("accepts a burst of KEYS_BURST, then KEYS_PER_SECOND; excess keys are counted, not applied", () => {
    const { rt } = runtime();
    for (let i = 0; i < 3; i++) ingest(rt, 1, churn(1_000), T0 + 1_000);
    expect(rt.states.get(1)).toMatchObject({ total: KEYS_BURST, droppedKeys: 3 * 64 - KEYS_BURST });
    ingest(rt, 1, churn(2_000), T0 + 2_000);
    expect(rt.states.get(1)!.total).toBe(KEYS_BURST + KEYS_PER_SECOND);
    // Another desk's budget is its own.
    ingest(rt, 2, churn(2_000), T0 + 2_000);
    expect(rt.states.get(2)).toMatchObject({ total: 64, droppedKeys: 0 });
  });

  it("never drops a 150 WPM typist with corrections over 2 minutes, in 50 ms batches", () => {
    const text = "le formulaire est en triple exemplaire et doit etre signe par le chef ".repeat(
      30,
    );
    const state = createDesksState({ redis: {} as Redis });
    const rt = state.open("lob", {
      race: { ...race, text },
      settings: DEFAULT_RACE_SETTINGS,
      desks,
    });
    const perSecond = (150 * 5) / 60; // 12.5 characters per second
    let typedChars = 0;
    let pending: Keystroke[] = [];
    for (let ms = 0; ms <= 120_000; ms += 10) {
      if (ms * perSecond >= (typedChars + 1) * 1000) {
        const ch = text[typedChars]!;
        // Every 20th character is mistyped first, then erased.
        if (typedChars % 20 === 0) pending.push({ t: ms, key: "q" }, { t: ms, key: "Backspace" });
        pending.push({ t: ms, key: ch });
        typedChars += 1;
      }
      if (ms % 50 === 0 && pending.length > 0) {
        ingest(rt, 1, pending, T0 + ms);
        pending = [];
      }
    }
    const desk = rt.states.get(1)!;
    expect(typedChars).toBe(1_500);
    expect(desk).toMatchObject({ droppedKeys: 0, timingAnomalies: 0, errors: 0 });
    expect(desk.cursor).toBe(typedChars);
  });
});

// ---------- socket level ----------

let booted: Booted | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await booted?.stop();
  booted = undefined;
});

const settle = () => new Promise((r) => setTimeout(r, 150));
/** Advances the fake clock one tick at a time (each tick's async work lands in between). */
async function ticks(b: Booted, n: number) {
  for (let i = 0; i < n; i++) {
    b.clock.advance(100);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("keys over the wire (C1)", () => {
  it("bonjour in two batches: finished tuple, finished event, desk hash with a 7-key trace", async () => {
    const r = await startedRace(process.env.REDIS_URL);
    booted = r.booted;
    const [, me] = r.racers;
    typeKeys(me!.client, "bon", 50, 20);
    await settle();
    typeKeys(me!.client, "jour", 150, 20);
    await settle();
    await ticks(r.booted, 3);

    const last = snapshotSchema.parse(me!.seen.snapshots.at(-1));
    expect(last.desks).toContainEqual([me!.desk, 7, 7, 0, PLAYER_STATUS_CODES.finished]);
    expect(last.ranks[0]).toBe(me!.desk);
    await until(
      () => r.racers[0]!.seen.events.some((e) => e.kind === "finished"),
      2_000,
      "finished to the room",
    );
    expect(r.racers[0]!.seen.events.filter((e) => e.kind === "finished")).toEqual([
      { v: PROTOCOL_VERSION, kind: "finished", desk: me!.desk, place: 1 },
    ]);

    const redis = await connectRedis(process.env.REDIS_URL);
    try {
      const raw = await redis.hget(desksKey(r.lobby), String(me!.desk));
      const stored = JSON.parse(raw!) as DeskState;
      expect(playerStateSchema.parse(stored)).toMatchObject({ cursor: 7, status: "finished" });
      expect(stored.trace).toHaveLength(7);
      expect(await redis.ttl(desksKey(r.lobby))).toBeGreaterThan(0);
    } finally {
      redis.disconnect();
    }
  });
});

describe("keys over the wire: authority (C2)", () => {
  it("during countdown: rejected before-go, nothing applied", async () => {
    const r = await startedRace(process.env.REDIS_URL, { go: false });
    booted = r.booted;
    const [, me] = r.racers;
    typeKeys(me!.client, "b", 0);
    await until(() => me!.seen.rejected.length === 1, 2_000, "rejected");
    expect(me!.seen.rejected[0]).toEqual({ v: PROTOCOL_VERSION, reason: "before-go" });
    expect(r.booted.server.desks.get(r.lobby)).toBeUndefined();
  });

  it("65 keys, a non-integer t or a cursor field change nothing and crash nothing", async () => {
    const r = await startedRace(process.env.REDIS_URL);
    booted = r.booted;
    const [, me] = r.racers;
    const tooMany = Array.from({ length: MAX_KEYS_PER_BATCH + 1 }, () => ({ t: 10, key: "b" }));
    me!.client.emit("keys", { v: PROTOCOL_VERSION, batch: tooMany });
    me!.client.emit("keys", { v: PROTOCOL_VERSION, batch: [{ t: 1.5, key: "b" }] });
    me!.client.emit("keys", "nope" as never);
    me!.client.emit("keys", {
      v: PROTOCOL_VERSION,
      cursor: 50,
      batch: [{ t: 10, key: "b" }],
    } as never);
    await settle();
    await ticks(r.booted, 1);
    const last = snapshotSchema.parse(me!.seen.snapshots.at(-1));
    expect(last.desks).toContainEqual([me!.desk, 1, 1, 0, PLAYER_STATUS_CODES.typing]);
    expect(me!.seen.rejected).toEqual([]);
    expect(r.booted.server.desks.states(r.lobby).get(me!.desk)?.trace).toHaveLength(1);
  });

  it("a batch 10 s ahead is clamped and applied with one anomaly", async () => {
    const r = await startedRace(process.env.REDIS_URL);
    booted = r.booted;
    const [, me] = r.racers;
    typeKeys(me!.client, "bo", 10_000, 10);
    await settle();
    const state = r.booted.server.desks.states(r.lobby).get(me!.desk)!;
    expect(state).toMatchObject({ cursor: 2, timingAnomalies: 1 });
    expect(state.trace.map((k) => k.t)).toEqual([MAX_LEAD_MS, MAX_LEAD_MS]);
  });
});

describe("all-finished (C5)", () => {
  it("ends once when the last typing desk finishes; no snapshot after ended; keys -> not-running", async () => {
    const ends: RaceEnded[] = [];
    const r = await startedRace(process.env.REDIS_URL, {
      players: 3,
      onRaceEnded: (e) => void ends.push(e),
    });
    booted = r.booted;
    const [host, two, three] = r.racers;
    // Desk 3 is abandoned by a direct status set (the seam #178/#183 use).
    const desks = r.booted.server.desks;
    desks.set(r.lobby, three!.desk, {
      ...desks.states(r.lobby).get(three!.desk)!,
      status: "abandoned",
    });
    typeKeys(two!.client, "bonjour", 100, 10);
    await settle();
    await ticks(r.booted, 1);
    expect(host!.seen.ended).toHaveLength(0);
    r.booted.clock.advance(200);
    typeKeys(host!.client, "bonjour", 300, 10);

    await until(() => host!.seen.ended.length === 1, 2_000, "ended");
    const ended = endedSchema.parse(host!.seen.ended[0]);
    expect(ended.reason).toBe("all-finished");
    expect(ended.ranking.map((e) => [e.place, e.desk, e.status])).toEqual([
      [1, two!.desk, "finished"],
      [2, host!.desk, "finished"],
      [3, three!.desk, "abandoned"],
    ]);
    expect(ends).toHaveLength(1);

    const seenAtEnd = host!.seen.snapshots.length;
    // The last finisher still gets its finished event, before `ended`.
    expect(host!.seen.events.filter((e) => e.kind === "finished").map((e) => e.desk)).toEqual([
      two!.desk,
      host!.desk,
    ]);
    await ticks(r.booted, 5);
    await settle();
    expect(host!.seen.snapshots).toHaveLength(seenAtEnd);
    expect(host!.seen.ended).toHaveLength(1);
    expect(r.booted.scheduler.armed()).toBe(0);

    typeKeys(two!.client, "x", 900);
    await until(() => two!.seen.rejected.length === 1, 2_000, "rejected");
    expect(two!.seen.rejected[0]).toEqual({ v: PROTOCOL_VERSION, reason: "not-running" });
  });
});
