import { describe, expect, it } from "vitest";
import { STREAK_THRESHOLDS, streaksOf, type StreakRow } from "./streaks";

// #936 C1: clean streaks per accuracy threshold, a pure function over the counted results in race order.
const T0 = Date.UTC(2026, 10, 1);
/** Results one minute apart, in the order given: [accuracy, cleanWpm]. */
const file = (...races: [number, number][]): StreakRow[] =>
  races.map(([accuracy, cleanWpm], i) => ({
    createdAt: new Date(T0 + i * 60_000),
    accuracy,
    cleanWpm,
  }));
const at = (rows: StreakRow[], threshold: number) =>
  streaksOf(rows).find((s) => s.threshold === threshold)!;

describe("streaksOf (#936 C1)", () => {
  it("lists the four thresholds 100, 98, 95, 90 in that order", () => {
    expect(STREAK_THRESHOLDS).toEqual([100, 98, 95, 90]);
    expect(streaksOf([]).map((s) => s.threshold)).toEqual([100, 98, 95, 90]);
  });

  it("an empty file: 0, null, 0 at every threshold", () => {
    for (const s of streaksOf([]))
      expect(s).toMatchObject({ best: 0, wpmDuring: null, current: 0 });
  });

  it("no race at 100 %: best 0 and no WPM there, the lower thresholds still count", () => {
    const rows = file([0.99, 40], [0.985, 42], [0.97, 38]);
    expect(at(rows, 100)).toEqual({ threshold: 100, best: 0, wpmDuring: null, current: 0 });
    expect(at(rows, 98)).toEqual({ threshold: 98, best: 2, wpmDuring: 41, current: 0 });
    expect(at(rows, 95)).toEqual({ threshold: 95, best: 3, wpmDuring: 40, current: 3 });
  });

  it("at or above: exactly 95 % and 90 % count (float shares)", () => {
    const rows = file([0.95, 30], [0.9, 31], [0.98, 32]);
    expect(at(rows, 95).best).toBe(1);
    expect(at(rows, 90)).toMatchObject({ best: 3, current: 3 });
    expect(at(rows, 98)).toMatchObject({ best: 1, current: 1, wpmDuring: 32 });
  });

  it("tied runs: the latest one gives the WPM during", () => {
    const rows = file([0.92, 30], [0.93, 32], [0.5, 60], [0.91, 50], [0.94, 54], [0.6, 20]);
    expect(at(rows, 90)).toEqual({ threshold: 90, best: 2, wpmDuring: 52, current: 0 });
  });

  it("current is the run ending at the latest race; a longer run earlier stays the best", () => {
    const rows = file([1, 40], [1, 41], [1, 42], [0.7, 10], [1, 50]);
    expect(at(rows, 100)).toEqual({ threshold: 100, best: 3, wpmDuring: 41, current: 1 });
  });

  it("reads race order, not the order given", () => {
    const rows = file([0.99, 40], [0.5, 10], [0.99, 44]).reverse();
    expect(at(rows, 98)).toMatchObject({ best: 1, wpmDuring: 44, current: 1 });
  });
});
