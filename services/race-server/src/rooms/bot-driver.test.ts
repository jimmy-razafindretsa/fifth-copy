import type { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import {
  analyseTrace,
  BOT_LEVELS,
  charsOf,
  DEFAULT_THRESHOLDS,
  mulberry32,
  normalizeTypeable,
  type BotLevel,
} from "@fifth-copy/engine";
import { DEFAULT_RACE_SETTINGS, type RaceInfo, type RaceSettings } from "@fifth-copy/protocol";
import { createFakeClock, createFakeScheduler } from "../clock";
import { createBotDrivers } from "./bot-driver";
import { createDesksState, textOf, withOverlay, type RoomRuntime } from "./desks-state";
import { ingest } from "./ingest";

// #366: the bot driver, Redis-free (the runtime only), on a fake clock and scheduler, seeded rng.

const T0 = 5_000_000;
const WORDS =
  "le commis range les dossiers du bureau avant l'aube, chaque formulaire porte un tampon et une date; le directeur attend le rapport complet.".split(
    " ",
  );
/** `n` words of office prose (punctuation and accents included), normalised. */
const textOf_ = (n: number) =>
  normalizeTypeable(Array.from({ length: n }, (_, i) => WORDS[i % WORDS.length]).join(" "));

function setup({
  words = 100,
  levels = ["clerk"] as BotLevel[],
  settings = DEFAULT_RACE_SETTINGS as RaceSettings,
  seed = 7,
} = {}) {
  const clock = createFakeClock(T0);
  const scheduler = createFakeScheduler(clock);
  const desksState = createDesksState({ redis: {} as Redis });
  const race: RaceInfo = {
    raceId: "6f1c2a4e-8b9d-4c3e-9f0a-1b2c3d4e5f60",
    text: textOf_(words),
    language: "fr",
    wordCount: words,
    t0: T0,
    timerS: null,
  };
  const desks = [
    { desk: 1, userId: "u1", name: "Ada", isBot: false },
    ...levels.map((_, i) => ({ desk: i + 2, userId: null, name: `Bot ${i}`, isBot: true })),
  ];
  const rt = desksState.open("lob", { race, settings, desks });
  let ingested = 0;
  const drivers = createBotDrivers({
    clock,
    scheduler,
    rng: mulberry32(seed),
    ingest: (runtime, desk, batch, now) => {
      ingested += batch.length;
      return ingest(runtime, desk, batch, now);
    },
  });
  const bots = levels.map((level, i) => ({ desk: i + 2, level }));
  return { clock, scheduler, desksState, rt, drivers, bots, ingested: () => ingested };
}

/** Advances in 1 s steps until `done` or `maxMs`. */
function run(clock: { advance(ms: number): void }, done: () => boolean, maxMs = 3_600_000) {
  for (let t = 0; t < maxMs && !done(); t += 1_000) clock.advance(1_000);
}

const flagsOf = (rt: RoomRuntime, desk: number) => {
  const s = rt.states.get(desk)!;
  return analyseTrace(
    {
      keystrokes: s.trace,
      text: textOf(rt, desk),
      settings: rt.engine,
      recorded: { cursor: s.cursor, correct: s.correct, errors: s.errors },
      timingAnomalies: s.timingAnomalies,
    },
    DEFAULT_THRESHOLDS,
  );
};

describe("bot driver: types through ingest to the end (C1, C5)", () => {
  for (const level of BOT_LEVELS) {
    it(`a ${level} finishes a 100-word text; one trace entry per accepted key; analyseTrace clean`, () => {
      const { clock, scheduler, rt, drivers, bots, ingested } = setup({ levels: [level] });
      drivers.start(rt, bots, "fr");
      expect(drivers.active("lob")).toEqual([2]);
      // No key before the first delay: the first one lands strictly after GO.
      expect(rt.states.get(2)!.trace).toHaveLength(0);
      run(clock, () => rt.states.get(2)!.status !== "typing");
      const s = rt.states.get(2)!;
      expect(s.status).toBe("finished");
      expect(s.cursor).toBe(rt.textLength);
      expect(s.droppedKeys).toBe(0);
      expect(s.trace).toHaveLength(ingested());
      // `t` is the server elapsed since GO: monotonic, within the race.
      expect(s.trace.every((k, i) => i === 0 || k.t >= s.trace[i - 1]!.t)).toBe(true);
      expect(s.trace[0]!.t).toBeGreaterThan(0);
      // Whole ms, as on the wire (`raceMsSchema`): the results carry `finishedAt` and the trace.
      expect(s.trace.every((k) => Number.isInteger(k.t))).toBe(true);
      expect(Number.isInteger(s.finishedAt)).toBe(true);
      expect(s.timingAnomalies).toBe(0);
      expect(flagsOf(rt, 2)).toEqual([]);
      // The human desk is untouched; the driver dropped its timer at the finish.
      expect(rt.states.get(1)!.trace).toHaveLength(0);
      expect(drivers.active("lob")).toEqual([]);
      expect(scheduler.armed()).toBe(0);
    });
  }

  it("a bot in block mode without backspace finishes too and its trace is clean", () => {
    const settings = { ...DEFAULT_RACE_SETTINGS, errorMode: "block" as const, backspace: false };
    const { clock, rt, drivers, bots } = setup({ levels: ["recruit"], settings, words: 40 });
    drivers.start(rt, bots, "fr");
    run(clock, () => rt.states.get(2)!.status !== "typing");
    expect(rt.states.get(2)!.status).toBe("finished");
    expect(flagsOf(rt, 2)).toEqual([]);
  });
});

describe("bot driver: the same path as humans (C2)", () => {
  it("a Major over a 500-word text: no dropped key, no timing anomaly, clean trace", () => {
    const { clock, rt, drivers, bots } = setup({ levels: ["major"], words: 500 });
    drivers.start(rt, bots, "fr");
    run(clock, () => rt.states.get(2)!.status !== "typing");
    const s = rt.states.get(2)!;
    expect(s.status).toBe("finished");
    expect(s.droppedKeys).toBe(0);
    expect(s.timingAnomalies).toBe(0);
    expect(flagsOf(rt, 2)).toEqual([]);
  });

  it("every bot key goes through ingest's budget: an emptied budget drops the key", () => {
    const { clock, rt, drivers, bots, ingested } = setup({ levels: ["major"] });
    drivers.start(rt, bots, "fr");
    // An empty budget stamped in the future: the first bot key finds no token.
    rt.budgets.set(2, { tokens: 0, at: Number.POSITIVE_INFINITY });
    clock.advance(1_000);
    const s = rt.states.get(2)!;
    expect(s.droppedKeys).toBe(1);
    expect(s.trace.length + s.droppedKeys).toBe(ingested());
  });
});

describe("bot driver: stops (C3)", () => {
  it("stop(lobby) cancels every timer; no key afterwards", () => {
    const { clock, scheduler, rt, drivers, bots } = setup({ levels: ["clerk", "major"] });
    drivers.start(rt, bots, "fr");
    clock.advance(2_000);
    expect(drivers.active("lob")).toEqual([2, 3]);
    expect(scheduler.armed()).toBe(2);
    drivers.stop("lob");
    expect(scheduler.armed()).toBe(0);
    const before = [2, 3].map((d) => rt.states.get(d)!.trace.length);
    clock.advance(30_000);
    expect([2, 3].map((d) => rt.states.get(d)!.trace.length)).toEqual(before);
    expect(drivers.active("lob")).toEqual([]);
  });

  it("close() cancels every room's timers", () => {
    const { clock, scheduler, rt, drivers, bots } = setup({ levels: ["clerk"] });
    drivers.start(rt, bots, "fr");
    drivers.close();
    expect(scheduler.armed()).toBe(0);
    clock.advance(10_000);
    expect(rt.states.get(2)!.trace).toHaveLength(0);
  });

  it("an ending or ended runtime takes no bot key and drops the timer", () => {
    const a = setup({ levels: ["clerk"] });
    a.drivers.start(a.rt, a.bots, "fr");
    a.rt.ending = true;
    a.clock.advance(10_000);
    expect(a.rt.states.get(2)!.trace).toHaveLength(0);
    expect(a.scheduler.armed()).toBe(0);

    const b = setup({ levels: ["clerk"] });
    b.drivers.start(b.rt, b.bots, "fr");
    b.desksState.end("lob");
    b.clock.advance(10_000);
    expect(b.rt.states.get(2)!.trace).toHaveLength(0);
    expect(b.scheduler.armed()).toBe(0);
  });

  it("a new start replaces the room's drivers (Race again); a desk outside the race gets none", () => {
    const { scheduler, rt, drivers, bots } = setup({ levels: ["clerk"] });
    drivers.start(rt, bots, "fr");
    drivers.start(rt, [...bots, { desk: 9, level: "major" }], "fr");
    expect(scheduler.armed()).toBe(1);
    expect(drivers.active("lob")).toEqual([2]);
  });
});

describe("bot driver: bonuses aimed at a bot (C6)", () => {
  it("an Extra Paperwork overlay lengthens the bot's trace by the overlay's keys", () => {
    const extra = ["formulaire", "tampon"];
    const extraKeys = extra.join(" ").length + 1; // the separator before the first extra word
    const plain = setup({ levels: ["officer"], words: 30, seed: 11 });
    const hit = setup({ levels: ["officer"], words: 30, seed: 11 });
    // A recruit-free comparison: the effective text grows by `extraKeys`, the bot types all of it.
    hit.desksState.set(
      "lob",
      2,
      withOverlay(hit.rt, 2, hit.rt.states.get(2)!, { extra, removed: [] }),
    );
    for (const r of [plain, hit]) {
      r.drivers.start(r.rt, r.bots, "fr");
      run(r.clock, () => r.rt.states.get(2)!.status !== "typing");
      expect(r.rt.states.get(2)!.status).toBe("finished");
    }
    expect(charsOf(textOf(hit.rt, 2)).length).toBe(hit.rt.textLength + extraKeys);
    expect(hit.rt.states.get(2)!.cursor).toBe(plain.rt.states.get(2)!.cursor + extraKeys);
    expect(hit.rt.states.get(2)!.correct).toBeGreaterThanOrEqual(
      plain.rt.states.get(2)!.correct + extraKeys,
    );
    expect(hit.rt.states.get(2)!.trace.length).toBeGreaterThan(plain.rt.states.get(2)!.trace.length);
    expect(flagsOf(hit.rt, 2)).toEqual([]);
  });

  it("an overlay landing mid-race is picked up on the next key", () => {
    const { clock, desksState, rt, drivers, bots } = setup({ levels: ["major"], words: 20 });
    drivers.start(rt, bots, "fr");
    clock.advance(3_000);
    expect(rt.states.get(2)!.status).toBe("typing");
    desksState.set("lob", 2, withOverlay(rt, 2, rt.states.get(2)!, { extra: ["dossier"], removed: [] }));
    run(clock, () => rt.states.get(2)!.status !== "typing");
    expect(rt.states.get(2)!.status).toBe("finished");
    expect(rt.states.get(2)!.cursor).toBe(rt.textLength + " dossier".length);
  });
});
