import { describe, expect, it } from "vitest";
import {
  accuracyScale,
  accuracyTickLabels,
  CURVE_RACES,
  dotsPath,
  linePath,
  movingAverage,
  performanceCurve,
  speedScale,
  speedTickLabels,
  trendLine,
  xAt,
  yAt,
} from "./performance-curve";

// Contract of #933 C1: the curve's pure geometry (moving average, least-squares trend, two scales).

const NBSP = "\u00a0";

describe("movingAverage (C1)", () => {
  it("k = 0 returns the points", () => {
    expect(movingAverage([3, 9, 6], 0)).toEqual([3, 9, 6]);
  });

  it("averages the points from i − k to i + k that exist (edges take fewer)", () => {
    expect(movingAverage([2, 4, 6, 8, 10], 1)).toEqual([3, 4, 6, 8, 9]);
    expect(movingAverage([2, 4, 6, 8, 10], 8)).toEqual([6, 6, 6, 6, 6]);
  });

  it("keeps a missing point missing and skips it in its neighbours' means", () => {
    expect(movingAverage([2, null, 6], 1)).toEqual([2, null, 6]);
  });
});

describe("trendLine (C1)", () => {
  it("is none under six points", () => {
    expect(trendLine([1, 2, 3, 4, 5])).toBeNull();
  });

  it("is the least-squares line of the series", () => {
    const line = trendLine([10, 12, 14, 16, 18, 20])!;
    expect(line.slope).toBeCloseTo(2);
    expect(line.intercept).toBeCloseTo(10);
    const noisy = trendLine([1, 3, 2, 4, 3, 5])!;
    // x̄ = 2.5, ȳ = 3; Σ(x−x̄)(y−ȳ) = 11, Σ(x−x̄)² = 17.5
    expect(noisy.slope).toBeCloseTo(11 / 17.5);
    expect(noisy.intercept).toBeCloseTo(3 - (11 / 17.5) * 2.5);
  });
});

describe("speedScale (C1)", () => {
  it("five whole, evenly spaced ticks around the slowest and fastest races", () => {
    const scale = speedScale([28.2, 47.6, 35]);
    expect(scale.ticks).toEqual([48, 42, 36, 30, 24]);
    expect(scale.low).toBeLessThanOrEqual(28.2);
    expect(scale.high).toBeGreaterThanOrEqual(47.6);
  });

  it.each([[[61.4, 40.2, 52.5]], [[42, 42, 42]], [[0.5, 3]], [[110, 260]], [[33.3, 33.9]]])(
    "holds for %j",
    (values) => {
      const { ticks, low, high } = speedScale(values);
      expect(ticks).toHaveLength(5);
      ticks.forEach((t) => expect(Number.isInteger(t)).toBe(true));
      const steps = ticks.slice(1).map((t, i) => ticks[i] - t);
      expect(new Set(steps).size).toBe(1);
      expect(low).toBeLessThanOrEqual(Math.min(...values));
      expect(high).toBeGreaterThanOrEqual(Math.max(...values));
    },
  );
});

describe("accuracyScale (C1)", () => {
  it.each([
    [
      [94.6, 99.2],
      [100, 97.5, 95, 92.5, 90],
    ],
    [
      [90, 100],
      [100, 97.5, 95, 92.5, 90],
    ],
    [
      [89.9, 97],
      [100, 95, 90, 85, 80],
    ],
    [
      [71, 97],
      [100, 90, 80, 70, 60],
    ],
    [
      [42, 97],
      [100, 75, 50, 25, 0],
    ],
  ])("lowest %j -> %j", (values, ticks) => {
    expect(accuracyScale(values).ticks).toEqual(ticks);
  });

  it("labels: decimal comma in French, point in English, the unit on the ends", () => {
    const scale = accuracyScale([95]);
    expect(accuracyTickLabels(scale, "fr")).toEqual([
      `100${NBSP}%`,
      "97,5",
      "95",
      "92,5",
      `90${NBSP}%`,
    ]);
    expect(accuracyTickLabels(scale, "en")).toEqual(["100%", "97.5", "95", "92.5", "90%"]);
    expect(speedTickLabels(speedScale([24, 48]))).toEqual(["48", "42", "36", "30", "24"]);
  });
});

describe("geometry (C1, card UI)", () => {
  it("x from 20 to 980, values from y 280 (lowest tick) to y 20 (highest)", () => {
    expect(xAt(0, 40)).toBe(20);
    expect(xAt(39, 40)).toBe(980);
    const scale = speedScale([24, 48]);
    expect(yAt(24, scale)).toBe(280);
    expect(yAt(48, scale)).toBe(20);
    expect(yAt(36, scale)).toBe(150);
  });

  it("paths: round dots per point, one polyline, a missing point lifts the pen", () => {
    const scale = speedScale([24, 48]);
    expect(dotsPath([24, 48], scale)).toBe("M20.0 280.0h0M980.0 20.0h0");
    expect(linePath([24, null, 36, 48], scale)).toBe("M20.0 280.0M660.0 150.0L980.0 20.0");
  });
});

describe("performanceCurve (C1)", () => {
  const races = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ cleanWpm: 30 + i, accuracy: 0.95 }));

  it("is none under three races", () => {
    expect(performanceCurve(races(2), 3)).toBeNull();
  });

  it("draws the 40 latest races; the trend from six", () => {
    const curve = performanceCurve(races(55), 3)!;
    expect(curve.count).toBe(CURVE_RACES);
    expect(curve.speed.scale.low).toBeLessThanOrEqual(45);
    expect(curve.trend?.direction).toBe("up");
    expect(performanceCurve(races(5), 3)!.trend).toBeNull();
  });

  it("smoothing moves the lines only: dots, scales and trend stay", () => {
    const points = races(20).map((p, i) => ({ ...p, cleanWpm: p.cleanWpm + (i % 2 ? 4 : -4) }));
    const a = performanceCurve(points, 0)!;
    const b = performanceCurve(points, 6)!;
    expect(b.speed.line).not.toBe(a.speed.line);
    expect(b.speed.dots).toBe(a.speed.dots);
    expect(b.accuracy.dots).toBe(a.accuracy.dots);
    expect(b.speed.scale).toEqual(a.speed.scale);
    expect(b.trend).toEqual(a.trend);
  });

  it("flat and falling trends", () => {
    const flat = Array.from({ length: 8 }, () => ({ cleanWpm: 40, accuracy: 0.9 }));
    expect(performanceCurve(flat, 3)!.trend?.direction).toBe("flat");
    const down = races(8).reverse();
    expect(performanceCurve(down, 3)!.trend?.direction).toBe("down");
  });
});
