import { describe, expect, it } from "vitest";
import { initialState, type PlayerState } from "../reducers/state";
import { accuracy, elapsedFor, progress, rawWpm, wpm } from "./scoring";

/**
 * C1: one row per (correct, errors, total, elapsed ms since GO) with the expected numbers to 3 decimals.
 * WPM counts 5-character words; `total` counts every accepted press, Backspace included (spec 4.2).
 */
const FORMULAS: {
  name: string;
  correct: number;
  errors: number;
  total: number;
  elapsedMs: number;
  wpm: number;
  rawWpm: number;
  accuracy: number;
}[] = [
  {
    name: "spec example: 350 correct chars in 60 s",
    correct: 350,
    errors: 0,
    total: 350,
    elapsedMs: 60_000,
    wpm: 70,
    rawWpm: 70,
    accuracy: 1,
  },
  {
    name: "nothing typed, no time",
    correct: 0,
    errors: 0,
    total: 0,
    elapsedMs: 0,
    wpm: 0,
    rawWpm: 0,
    accuracy: 1,
  },
  {
    name: "elapsed 0 never divides by zero",
    correct: 100,
    errors: 0,
    total: 100,
    elapsedMs: 0,
    wpm: 0,
    rawWpm: 0,
    accuracy: 1,
  },
  {
    name: "negative elapsed is treated as no time",
    correct: 100,
    errors: 3,
    total: 103,
    elapsedMs: -500,
    wpm: 0,
    rawWpm: 0,
    accuracy: 0.971,
  },
  {
    name: "total 0 gives accuracy 1",
    correct: 0,
    errors: 0,
    total: 0,
    elapsedMs: 30_000,
    wpm: 0,
    rawWpm: 0,
    accuracy: 1,
  },
  {
    name: "Continue mode with errors",
    correct: 300,
    errors: 20,
    total: 320,
    elapsedMs: 60_000,
    wpm: 60,
    rawWpm: 64,
    accuracy: 0.9375,
  },
  {
    name: "fast half minute with errors",
    correct: 250,
    errors: 50,
    total: 300,
    elapsedMs: 30_000,
    wpm: 100,
    rawWpm: 120,
    accuracy: 0.833,
  },
  {
    name: "Backspace presses count in total: 2 typed, 2 erased, 2 retyped",
    correct: 2,
    errors: 0,
    total: 6,
    elapsedMs: 1_000,
    wpm: 24,
    rawWpm: 24,
    accuracy: 0.333,
  },
  {
    name: "one char in 90 s",
    correct: 1,
    errors: 0,
    total: 1,
    elapsedMs: 90_000,
    wpm: 0.133,
    rawWpm: 0.133,
    accuracy: 1,
  },
  {
    name: "Block mode: wrong presses counted in total only",
    correct: 500,
    errors: 0,
    total: 520,
    elapsedMs: 120_000,
    wpm: 50,
    rawWpm: 50,
    accuracy: 0.962,
  },
  {
    name: "Continue mode over two minutes",
    correct: 500,
    errors: 5,
    total: 505,
    elapsedMs: 120_000,
    wpm: 50,
    rawWpm: 50.5,
    accuracy: 0.99,
  },
  {
    name: "sub-second burst",
    correct: 7,
    errors: 0,
    total: 7,
    elapsedMs: 700,
    wpm: 120,
    rawWpm: 120,
    accuracy: 1,
  },
  {
    name: "only errors",
    correct: 0,
    errors: 10,
    total: 10,
    elapsedMs: 60_000,
    wpm: 0,
    rawWpm: 2,
    accuracy: 0,
  },
];

describe("scoring formulas (C1)", () => {
  it("has at least 10 rows", () => {
    expect(FORMULAS.length).toBeGreaterThanOrEqual(10);
  });

  it.each(FORMULAS)("$name", (row) => {
    expect(wpm(row, row.elapsedMs)).toBeCloseTo(row.wpm, 3);
    expect(rawWpm(row, row.elapsedMs)).toBeCloseTo(row.rawWpm, 3);
    expect(accuracy(row)).toBeCloseTo(row.accuracy, 3);
  });

  it("accuracy stays in [0, 1]", () => {
    expect(accuracy({ correct: 5, total: 3 })).toBe(1);
    expect(accuracy({ correct: -1, total: 3 })).toBe(0);
  });
});

function state(over: Partial<PlayerState>): PlayerState {
  return { ...initialState(), ...over };
}

describe("progress (C2)", () => {
  it.each([
    { name: "start of text", s: state({ cursor: 0 }), len: 200, expected: 0 },
    { name: "a quarter in", s: state({ cursor: 50 }), len: 200, expected: 0.25 },
    {
      name: "one char before the end, still typing",
      s: state({ cursor: 199 }),
      len: 200,
      expected: 0.995,
    },
    {
      name: "finished state is 1",
      s: state({ cursor: 200, status: "finished", finishedAt: 9_000 }),
      len: 200,
      expected: 1,
    },
    {
      name: "frozen asleep progress",
      s: state({ cursor: 120, status: "asleep" }),
      len: 200,
      expected: 0.6,
    },
    {
      name: "cursor past the end is clamped",
      s: state({ cursor: 250, status: "line-cut" }),
      len: 200,
      expected: 1,
    },
    { name: "empty text, unfinished, is 0 (no NaN)", s: state({ cursor: 0 }), len: 0, expected: 0 },
  ])("$name", ({ s, len, expected }) => {
    expect(progress(s, len)).toBeCloseTo(expected, 3);
  });
});

describe("elapsedFor (C2)", () => {
  it.each([
    {
      name: "finished player: finishedAt",
      s: state({ status: "finished", finishedAt: 42_000, lastT: 42_000 }),
      race: 90_000,
      expected: 42_000,
    },
    {
      name: "typing player: race elapsed",
      s: state({ status: "typing", lastT: 30_000 }),
      race: 90_000,
      expected: 90_000,
    },
    {
      name: "asleep player: whatever the caller passes",
      s: state({ status: "asleep", lastT: 20_000 }),
      race: 20_000,
      expected: 20_000,
    },
    {
      name: "abandoned player: race elapsed",
      s: state({ status: "abandoned", lastT: 5_000 }),
      race: 5_000,
      expected: 5_000,
    },
  ])("$name", ({ s, race, expected }) => {
    expect(elapsedFor(s, race)).toBe(expected);
  });

  it("feeds wpm: a finisher is timed at finishedAt, not race end", () => {
    const s = state({ status: "finished", finishedAt: 60_000, correct: 350, cursor: 350 });
    expect(wpm(s, elapsedFor(s, 120_000))).toBeCloseTo(70, 3);
  });
});
