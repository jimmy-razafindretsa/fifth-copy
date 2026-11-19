import { describe, expect, it } from "vitest";
import type { CharStatRow } from "../view/key-file";
import {
  CALLOUT_LIMIT,
  CALLOUT_MIN_CHANGE,
  CALLOUT_MIN_ERRORS,
  CALLOUT_MIN_TIMED_HITS,
  calloutsOf,
  calloutWeeks,
} from "./rule";

// #999 C48: week-over-week callouts per key from the daily character stats, with a stated noise floor.

const TODAY = "2026-11-19";
const THIS = "2026-11-18"; // inside this week (Nov 13-19)
const LAST = "2026-11-10"; // inside last week (Nov 6-12)

/** One day row of `timedHits` presses at `wpm`, `errors` misses out of `hits`. */
const row = (
  day: string,
  char: string,
  wpm: number,
  timedHits = 30,
  errors = 0,
  hits = timedHits,
) =>
  ({
    day,
    char,
    hits,
    errors,
    timedHits,
    totalMs: Math.round((12000 * timedHits) / wpm),
  }) satisfies CharStatRow;

describe("calloutsOf (C48)", () => {
  it("states its rule: 7-day weeks, 20 timed presses a week, 3 misses, a 10 % change, 3 callouts", () => {
    expect(calloutWeeks(TODAY)).toEqual({ thisWeek: "2026-11-13", lastWeek: "2026-11-06" });
    expect([CALLOUT_MIN_TIMED_HITS, CALLOUT_MIN_ERRORS, CALLOUT_MIN_CHANGE, CALLOUT_LIMIT]).toEqual(
      [20, 3, 10, 3],
    );
  });

  it("a key 30 % faster than last week makes the faster callout", () => {
    expect(calloutsOf([row(LAST, "ç", 20), row(THIS, "ç", 26)], TODAY)).toEqual([
      { kind: "faster", char: "ç", pct: 30 },
    ]);
  });

  it("slower, cleaner and messier, the largest changes first, at most three", () => {
    const rows = [
      row(LAST, "a", 40),
      row(THIS, "a", 30), // 25 % slower
      row(LAST, "e", 40, 30, 6),
      row(THIS, "e", 40, 30, 3), // 50 % fewer misses
      row(LAST, "t", 40, 30, 3),
      row(THIS, "t", 40, 30, 6), // 100 % more misses
      row(LAST, "s", 40),
      row(THIS, "s", 44), // 10 % faster: fourth, dropped
    ];
    expect(calloutsOf(rows, TODAY)).toEqual([
      { kind: "messier", char: "t", pct: 100 },
      { kind: "cleaner", char: "e", pct: 50 },
      { kind: "slower", char: "a", pct: 25 },
    ]);
  });

  it("a key short of 20 timed presses in either week is not compared (noise floor)", () => {
    expect(calloutsOf([row(LAST, "ç", 20, 19), row(THIS, "ç", 40)], TODAY)).toEqual([]);
    expect(calloutsOf([row(LAST, "ç", 20), row(THIS, "ç", 40, 19)], TODAY)).toEqual([]);
    // two days of one week add up
    expect(
      calloutsOf(
        [row(LAST, "ç", 20, 10), row("2026-11-11", "ç", 20, 10), row(THIS, "ç", 26)],
        TODAY,
      ),
    ).toEqual([{ kind: "faster", char: "ç", pct: 30 }]);
  });

  it("an error callout needs 3 misses in a week and a miss last week", () => {
    expect(calloutsOf([row(LAST, "e", 40, 30, 2), row(THIS, "e", 40, 30, 1)], TODAY)).toEqual([
      { kind: "steady", char: "e", pct: 0 },
    ]);
    expect(calloutsOf([row(LAST, "e", 40, 30, 0), row(THIS, "e", 40, 30, 5)], TODAY)).toEqual([
      { kind: "steady", char: "e", pct: 0 },
    ]);
  });

  it("with no change, the key most pressed this week is steady", () => {
    expect(
      calloutsOf(
        [row(LAST, "a", 40), row(THIS, "a", 41, 30), row(LAST, "e", 40), row(THIS, "e", 41, 50)],
        TODAY,
      ),
    ).toEqual([{ kind: "steady", char: "e", pct: 0 }]);
  });

  it("only letters; rows outside the two weeks are ignored", () => {
    expect(calloutsOf([row(LAST, " ", 20), row(THIS, " ", 40)], TODAY)).toEqual([]);
    expect(calloutsOf([row(LAST, ",", 20), row(THIS, ",", 40)], TODAY)).toEqual([]);
    expect(calloutsOf([row("2026-11-05", "a", 20), row(THIS, "a", 40)], TODAY)).toEqual([]);
    expect(calloutsOf([row(LAST, "a", 20), row("2026-11-20", "a", 40)], TODAY)).toEqual([]);
  });

  it("no rows, no callout", () => {
    expect(calloutsOf([], TODAY)).toEqual([]);
  });
});
