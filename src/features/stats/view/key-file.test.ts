import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/time";
import {
  type CharStatRow,
  KEY_FILE_DAYS,
  KEY_GOAL_WPM,
  type KeyFile,
  type KeyFileEntry,
  keyFileOf,
  type PairStatRow,
  REFERENCE_KEYS,
} from "./key-file";

// #961 C1-C4: the per-key read model over the daily aggregates (ADR 0024: avg ms = totalMs / timedHits).
// A key's speed is 12000 * timedHits / totalMs WPM (five characters a word).

const START = "2026-09-01";
const dayN = (i: number) => addDays(START, i);

/** One character row; `ms` is the mean timing of a timed hit (60000 / (5 * wpm)). */
const row = (
  i: number,
  char: string,
  { hits = 10, errors = 0, timedHits = hits, wpm = 40, layout = "FR_CA" as const } = {},
): CharStatRow => ({
  day: dayN(i),
  char,
  layout,
  hits,
  errors,
  timedHits,
  totalMs: Math.round((12000 * timedHits) / wpm),
});

const pair = (p: string, hits: number, errors: number, wpm: number | null): PairStatRow => ({
  pair: p,
  hits,
  errors,
  timedHits: wpm === null ? 0 : hits,
  totalMs: wpm === null ? 0 : Math.round((12000 * hits) / wpm),
});

const key = (file: KeyFile, char: string): KeyFileEntry => {
  const entry = file.keys.find((k) => k.char === char);
  if (!entry) throw new Error(`no entry for ${char}`);
  return entry;
};

describe("keyFileOf: days and the 30 reference keys (C1)", () => {
  it("the reference keys are A to Z then É È À Ç", () => {
    expect(REFERENCE_KEYS.join("")).toBe("abcdefghijklmnopqrstuvwxyzéèàç");
    expect(REFERENCE_KEYS).toHaveLength(30);
  });

  it("an empty file: no day, 30 keys at zero with null figures, no pair, no character", () => {
    const file = keyFileOf([], []);
    expect(file.days).toEqual([]);
    expect(file.keys.map((k) => k.char)).toEqual([...REFERENCE_KEYS]);
    for (const k of file.keys) {
      expect(k).toEqual({
        char: k.char,
        state: "none",
        series: [],
        hits: 0,
        errors: 0,
        errorRate: null,
        averageWpm: null,
        latestWpm: null,
        bestWpm: null,
        learningRate: null,
      });
    }
    expect(file.mostTyped).toBeNull();
    expect(file.pairs).toEqual([]);
    expect(file.byChar).toEqual({});
  });

  it("one day: layouts are summed, the speed comes from the sums, a key never met stays empty", () => {
    const file = keyFileOf(
      [
        row(0, "a", { hits: 10, errors: 1, wpm: 40 }),
        row(0, "a", { hits: 10, errors: 3, wpm: 40, layout: "US_QWERTY" as never }),
        row(0, "é", { hits: 4, errors: 2, timedHits: 4, wpm: 30 }),
      ],
      [],
    );
    expect(file.days).toEqual([dayN(0)]);
    const a = key(file, "a");
    expect(a).toMatchObject({ hits: 20, errors: 4, errorRate: 0.2, series: [40] });
    expect(a.averageWpm).toBeCloseTo(40, 6);
    expect(a.latestWpm).toBeCloseTo(40, 6);
    expect(a.bestWpm).toBeCloseTo(40, 6);
    expect(a.learningRate).toBeNull();
    expect(key(file, "é").series[0]).toBeCloseTo(30, 6);
    expect(key(file, "z")).toMatchObject({
      hits: 0,
      errors: 0,
      series: [null],
      errorRate: null,
      averageWpm: null,
      latestWpm: null,
      bestWpm: null,
      state: "none",
    });
  });

  it("the series is 12000 * timedHits / totalMs on each day", () => {
    const file = keyFileOf(
      [{ day: dayN(0), char: "k", layout: "CSA", hits: 6, errors: 0, timedHits: 5, totalMs: 1500 }],
      [],
    );
    expect(key(file, "k").series).toEqual([40]);
    expect(key(file, "k").averageWpm).toBe(40);
  });

  it("41 days: the 40 latest are kept, oldest first; the oldest day counts nowhere", () => {
    const rows = Array.from({ length: 41 }, (_, i) => row(40 - i, "e", { wpm: 20 + (40 - i) }));
    rows.push(row(0, "q", { hits: 50 }));
    const file = keyFileOf(rows, []);
    expect(KEY_FILE_DAYS).toBe(40);
    expect(file.days).toHaveLength(40);
    expect(file.days[0]).toBe(dayN(1));
    expect(file.days[39]).toBe(dayN(40));
    const e = key(file, "e");
    expect(e.series).toHaveLength(40);
    expect(e.series[0]).toBeCloseTo(21, 2);
    expect(e.hits).toBe(400);
    expect(e.latestWpm).toBeCloseTo(60, 2);
    expect(e.bestWpm).toBeCloseTo(60, 2);
    expect(key(file, "q").hits).toBe(0);
    expect(file.byChar.q).toBeUndefined();
  });

  it("a day with 2 timed hits is a gap in the series; the window's sums still count it", () => {
    const file = keyFileOf(
      [
        row(0, "b", { hits: 10, wpm: 30 }),
        row(1, "b", { hits: 2, timedHits: 2, wpm: 90 }),
        row(2, "c", { hits: 10 }),
      ],
      [],
    );
    const b = key(file, "b");
    expect(b.series.map((v) => (v === null ? null : Math.round(v)))).toEqual([30, null, null]);
    expect(b.latestWpm).toBeCloseTo(30, 6);
    expect(b.bestWpm).toBeCloseTo(30, 6);
    expect(b.hits).toBe(12);
    // (10 + 2) timed hits over (4000 + 267) ms
    expect(b.averageWpm).toBeCloseTo((12000 * 12) / (4000 + 267), 6);
  });

  it("a key with only 2 timed hits in the whole window has no series point but an average", () => {
    const file = keyFileOf([row(0, "d", { hits: 5, timedHits: 2, wpm: 50 })], []);
    const d = key(file, "d");
    expect(d.series).toEqual([null]);
    expect(d.latestWpm).toBeNull();
    expect(d.bestWpm).toBeNull();
    expect(d.averageWpm).toBeCloseTo(50, 6);
  });

  it("a falling key: a negative learning rate over the last 15 present values, per day", () => {
    // 20 days, 2 WPM lost a day; the first 5 days are a fast plateau the slope must ignore.
    const rows = Array.from({ length: 20 }, (_, i) =>
      row(i, "f", { wpm: i < 5 ? 200 : 80 - 2 * i }),
    );
    const f = key(keyFileOf(rows, []), "f");
    expect(f.learningRate).toBeCloseTo(-2, 2);
    expect(f.latestWpm).toBeCloseTo(42, 2);
    expect(f.bestWpm).toBeCloseTo(200, 2);
  });

  it("the learning rate needs 6 present values", () => {
    const five = Array.from({ length: 5 }, (_, i) => row(i, "g", { wpm: 30 + i }));
    expect(key(keyFileOf(five, []), "g").learningRate).toBeNull();
    const six = Array.from({ length: 6 }, (_, i) => row(i, "g", { wpm: 30 + i }));
    expect(key(keyFileOf(six, []), "g").learningRate).toBeCloseTo(1, 3);
  });
});

describe("keyFileOf: goal, states and the most typed key (C2)", () => {
  it("goal 35; none, weak under the goal, good at or over it", () => {
    const file = keyFileOf([row(0, "a", { wpm: 34 }), row(0, "s", { hits: 7, wpm: 35 }) /* 2400 ms: exactly 35 */], []);
    expect(KEY_GOAL_WPM).toBe(35);
    expect(file.goal).toBe(35);
    expect(key(file, "a").state).toBe("weak");
    expect(key(file, "s").state).toBe("good");
    expect(key(file, "x").state).toBe("none");
  });

  it("mostTyped: the most hits, the first in reference order when tied", () => {
    expect(
      keyFileOf([row(0, "t", { hits: 9 }), row(0, "é", { hits: 12 })], []).mostTyped,
    ).toBe("é");
    expect(
      keyFileOf([row(0, "t", { hits: 12 }), row(0, "e", { hits: 12 })], []).mostTyped,
    ).toBe("e");
    // a character outside the 30 never wins
    expect(keyFileOf([row(0, "'", { hits: 99 })], []).mostTyped).toBeNull();
  });
});

describe("keyFileOf: letter pairs (C3)", () => {
  it("at least 20 hits, error rate descending, then the lower speed, then alphabetically; at most 6", () => {
    const file = keyFileOf(
      [],
      [
        pair("qu", 40, 4, 50), // 0.1
        pair("ou", 19, 10, 20), // 19 hits: left out
        pair("ai", 20, 2, 30), // 0.1, slower than qu
        pair("es", 40, 4, 50), // 0.1, same speed as qu: alphabetical
        pair("nt", 30, 9, 40), // 0.3
        pair("re", 100, 1, 60),
        pair("le", 100, 0, 60),
        pair("on", 100, 0, 70),
      ],
    );
    expect(file.pairs.map((p) => p.pair)).toEqual(["nt", "ai", "es", "qu", "re", "le"]);
    expect(file.pairs[0]).toEqual({ pair: "nt", errorRate: 0.3, wpm: 40 });
  });

  it("pair rows of several days are summed first; a pair without timed hits has a null speed", () => {
    const file = keyFileOf(
      [],
      [pair("th", 10, 1, null), pair("th", 10, 1, null), pair("he", 10, 0, 40)],
    );
    expect(file.pairs).toEqual([{ pair: "th", errorRate: 0.1, wpm: null }]);
  });

  it("fewer than 6 qualifying pairs gives fewer", () => {
    expect(keyFileOf([], [pair("ab", 25, 0, 30), pair("cd", 5, 5, 30)]).pairs).toHaveLength(1);
  });
});

describe("keyFileOf: every stored character of the window (C4)", () => {
  it("byChar keys any character, layouts and days summed", () => {
    const file = keyFileOf(
      [
        row(0, "'", { hits: 3, errors: 1 }),
        row(1, "'", { hits: 2, errors: 0, layout: "CSA" as never }),
        row(1, "a", { hits: 7, errors: 2 }),
        row(1, " ", { hits: 30, errors: 0 }),
      ],
      [],
    );
    expect(file.byChar).toEqual({
      "'": { hits: 5, errors: 1 },
      a: { hits: 7, errors: 2 },
      " ": { hits: 30, errors: 0 },
    });
  });
});
