import { describe, expect, it } from "vitest";
import {
  CENSUS_BARS,
  CENSUS_KERNEL,
  CENSUS_MIN_POPULATION,
  CENSUS_MIN_RACES,
  CENSUS_SCALES,
  type Census,
  type CensusDistribution,
  type CensusTypist,
  type CensusViewer,
  censusOf,
} from "./census";

// #966: the typist census. Only aggregates leave `censusOf`: smoothed shapes and the viewer's own
// figures, never a head count, an id or another typist's figure.

const typist = (wpm: number, accuracy = 0.95, best = wpm + 10, bestAccuracy = accuracy + 0.02) => ({
  averageWpm: wpm,
  bestWpm: best,
  averageAccuracy: accuracy,
  bestAccuracy,
});

/** `n` typists spread evenly from `from` to `to` WPM, accuracy 84 to 98 %. */
function spread(n: number, from = 20, to = 100): CensusTypist[] {
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : i / (n - 1);
    return typist(from + t * (to - from), 0.84 + t * 0.14);
  });
}

const viewerOf = (t: CensusTypist, races = 10): NonNullable<CensusViewer> => ({ ...t, races });

const KINDS = ["averageSpeed", "bestSpeed", "averageAccuracy", "bestAccuracy"] as const;

function distributions(census: Census): CensusDistribution[] {
  return KINDS.map((k) => census[k]);
}

describe("censusOf: the population floor (C1)", () => {
  it("exports a floor of 30 typists and a 3-race floor", () => {
    expect(CENSUS_MIN_POPULATION).toBe(30);
    expect(CENSUS_MIN_RACES).toBe(3);
  });

  it("29 typists give null, with or without a viewer", () => {
    const typists = spread(29);
    expect(censusOf(typists, null)).toBeNull();
    expect(censusOf(typists, viewerOf(typists[10]!))).toBeNull();
    expect(censusOf([], null)).toBeNull();
  });

  it("30 typists give four distributions of 60 bars and 60 cumulative values", () => {
    const census = censusOf(spread(30), null);
    expect(census).not.toBeNull();
    expect(Object.keys(census!).sort()).toEqual([...KINDS].sort());
    for (const d of distributions(census!)) {
      expect(d.bars).toHaveLength(CENSUS_BARS);
      expect(d.cumulative).toHaveLength(CENSUS_BARS);
      expect(CENSUS_BARS).toBe(60);
      for (const h of d.bars) {
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(1);
      }
      expect(Math.max(...d.bars)).toBe(1);
      d.cumulative.forEach((c, i) => {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
        if (i > 0) expect(c).toBeGreaterThanOrEqual(d.cumulative[i - 1]!);
      });
      expect(d.cumulative[CENSUS_BARS - 1]).toBeGreaterThan(d.cumulative[0]!);
    }
  });

  it("speed runs over 0 to 150 WPM and accuracy over 80 to 100 %", () => {
    expect(CENSUS_SCALES.speed).toEqual({ min: 0, max: 150 });
    expect(CENSUS_SCALES.accuracy).toEqual({ min: 80, max: 100 });
    const census = censusOf(spread(30), null)!;
    expect([census.averageSpeed.min, census.averageSpeed.max]).toEqual([0, 150]);
    expect([census.bestSpeed.min, census.bestSpeed.max]).toEqual([0, 150]);
    expect([census.averageAccuracy.min, census.averageAccuracy.max]).toEqual([80, 100]);
    expect([census.bestAccuracy.min, census.bestAccuracy.max]).toEqual([80, 100]);
  });

  it("a value outside the scale sits on its end", () => {
    const low = Array.from({ length: 30 }, () => typist(-20, 0.5, -5, 0.6));
    const atLowEnd = Array.from({ length: 30 }, () => typist(0, 0.8, 0, 0.8));
    expect(censusOf(low, null)).toEqual(censusOf(atLowEnd, null));
    const high = Array.from({ length: 30 }, () => typist(400, 1.2, 500, 1.5));
    const atHighEnd = Array.from({ length: 30 }, () => typist(150, 1, 150, 1));
    expect(censusOf(high, null)).toEqual(censusOf(atHighEnd, null));
    const census = censusOf(high, null)!;
    for (const d of distributions(census)) {
      expect(d.bars[CENSUS_BARS - 1]).toBe(1);
      expect(d.bars[0]).toBe(0);
    }
    const viewer = censusOf(high, viewerOf(typist(400, 1.2, 500, 1.5)))!;
    expect(viewer.averageSpeed.position).toBe(1);
    const viewerLow = censusOf(low, viewerOf(typist(-20, 0.5, -5, 0.6)))!;
    expect(viewerLow.averageAccuracy.position).toBe(0);
  });
});

describe("censusOf: smoothing (C2)", () => {
  it("uses a fixed Gaussian kernel of 4 WPM and 0.8 accuracy point", () => {
    expect(CENSUS_KERNEL).toEqual({ speed: 4, accuracy: 0.8 });
  });

  it("a typist alone at 140 WPM raises at least 5 neighbouring bars", () => {
    const typists = [...Array.from({ length: 30 }, () => typist(40, 0.95, 40)), typist(140, 0.95, 140)];
    const census = censusOf(typists, null)!;
    for (const d of [census.averageSpeed, census.bestSpeed]) {
      const at140 = Math.floor((140 / 150) * CENSUS_BARS);
      const around = d.bars.slice(at140 - 4, at140 + 5).filter((h) => h > 0);
      expect(around.length).toBeGreaterThanOrEqual(5);
      // No single bar carries the lone typist: the tallest bar near 140 holds well under their mass.
      const near = d.bars.slice(at140 - 8, CENSUS_BARS);
      const nonZero = near.filter((h) => h > 0);
      expect(Math.max(...near)).toBeLessThan(0.5 * nonZero.reduce((s, h) => s + h, 0));
    }
  });

  it("an accuracy typist alone at the top end raises at least 5 bars", () => {
    const typists = [
      ...Array.from({ length: 30 }, () => typist(40, 0.85, 40, 0.85)),
      typist(40, 0.99, 40, 0.99),
    ];
    const census = censusOf(typists, null)!;
    const at99 = Math.floor(((99 - 80) / 20) * CENSUS_BARS);
    const around = census.averageAccuracy.bars.slice(at99 - 4, at99 + 5).filter((h) => h > 0);
    expect(around.length).toBeGreaterThanOrEqual(5);
  });

  it("identical inputs give identical outputs", () => {
    const typists = spread(57, 10, 130);
    const viewer = viewerOf(typists[20]!);
    expect(censusOf(typists, viewer)).toEqual(censusOf([...typists], { ...viewer }));
    expect(JSON.stringify(censusOf(typists, viewer))).toBe(
      JSON.stringify(censusOf(typists, viewer)),
    );
  });

  it("does not depend on the order of the typists", () => {
    const typists = spread(45, 10, 130);
    expect(censusOf([...typists].reverse(), null)).toEqual(censusOf(typists, null));
  });
});

/** Every key path of a value, arrays collapsed to `[]`. */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return [`${prefix}[]`, ...value.flatMap((v) => keyPaths(v, `${prefix}[]`))].filter(
      (p, i, all) => all.indexOf(p) === i,
    );
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => {
      const path = prefix ? `${prefix}.${k}` : k;
      return [path, ...keyPaths(v, path)];
    });
  }
  return [];
}

const ALLOWED_DISTRIBUTION_KEYS = [
  "min",
  "max",
  "bars",
  "bars[]",
  "cumulative",
  "cumulative[]",
  "value",
  "position",
  "percentile",
];
const ALLOWED_PATHS = new Set([
  ...KINDS,
  ...KINDS.flatMap((k) => ALLOWED_DISTRIBUTION_KEYS.map((key) => `${k}.${key}`)),
]);

describe("censusOf: aggregates only (C3)", () => {
  const typists = spread(41, 15, 120);
  const viewer = viewerOf(typists[17]!);

  it("every key of the result, deep, is on the allow-list", () => {
    for (const census of [censusOf(typists, viewer), censusOf(typists, null)]) {
      const paths = keyPaths(census);
      expect(paths.filter((p) => !ALLOWED_PATHS.has(p))).toEqual([]);
    }
  });

  it("holds no head count: two populations of different sizes and the same shape look alike", () => {
    const once = censusOf(spread(30, 20, 100), null)!;
    const thrice = censusOf([...spread(30, 20, 100), ...spread(30, 20, 100), ...spread(30, 20, 100)], null)!;
    expect(thrice).toEqual(once);
    expect(JSON.stringify(once)).not.toMatch(/"(count|n|size|population|typists|races|id|name|userId)"/);
  });

  it("holds only numbers, nulls and arrays of numbers under the allowed keys", () => {
    const census = censusOf(typists, viewer)!;
    for (const d of distributions(census)) {
      for (const [key, v] of Object.entries(d)) {
        if (key === "bars" || key === "cumulative") {
          expect((v as number[]).every((x) => typeof x === "number" && Number.isFinite(x))).toBe(true);
        } else {
          expect(v === null || (typeof v === "number" && Number.isFinite(v))).toBe(true);
        }
      }
    }
  });

  it("holds no figure of another typist: the viewer's value is the only typist figure", () => {
    const distinct = [...spread(30, 31.37, 99.13), typist(77.77, 0.9311, 88.88, 0.9733)];
    const census = censusOf(distinct, viewerOf(typist(77.77, 0.9311, 88.88, 0.9733)))!;
    for (const d of distributions(census)) {
      // Shapes are fractions of the tallest bar or of the population, never a WPM or an accuracy.
      expect([...d.bars, ...d.cumulative, d.position!].every((x) => x >= 0 && x <= 1)).toBe(true);
    }
    expect(census.averageSpeed.value).toBe(77.8);
    expect(census.bestSpeed.value).toBe(88.9);
    expect(census.averageAccuracy.value).toBe(93.1);
    expect(census.bestAccuracy.value).toBe(97.3);
  });
});

describe("censusOf: the viewer's place (C4)", () => {
  const typists = spread(61, 20, 110);
  const slowest = typists[0]!;
  const median = typists[30]!;
  const fastest = typists[60]!;

  it("the median viewer stands near 50 %, with value and position", () => {
    const census = censusOf(typists, viewerOf(median))!;
    expect(census.averageSpeed.value).toBe(65);
    expect(census.averageSpeed.position).toBeCloseTo(65 / 150, 6);
    expect(census.averageSpeed.percentile).toBeGreaterThan(45);
    expect(census.averageSpeed.percentile).toBeLessThan(55);
    expect(census.averageAccuracy.value).toBe(91);
    expect(census.averageAccuracy.position).toBeCloseTo((91 - 80) / 20, 6);
  });

  it("the slowest viewer stands low, the fastest high but never at 100", () => {
    const low = censusOf(typists, viewerOf(slowest))!;
    const high = censusOf(typists, viewerOf(fastest))!;
    for (const k of KINDS) {
      expect(low[k].percentile).toBeLessThan(5);
      expect(high[k].percentile).toBeGreaterThan(95);
      expect(high[k].percentile).toBeLessThan(100);
    }
  });

  it("is never 100 when someone else is at or above the viewer, even at the end of the scale", () => {
    const crowd = [...Array.from({ length: 300 }, () => typist(30, 0.85)), typist(150, 1, 150, 1)];
    const census = censusOf(crowd, viewerOf(typist(150, 1, 150, 1)))!;
    for (const k of KINDS) expect(census[k].percentile).toBeLessThan(100);
  });

  it("is one decimal, the share of the smoothed population strictly under the value", () => {
    const census = censusOf(typists, viewerOf(median))!;
    for (const k of KINDS) {
      const p = census[k].percentile!;
      expect(Math.round(p * 10) / 10).toBe(p);
    }
    // Symmetric population around the median viewer: half of it lies under them.
    const sym = censusOf(spread(31, 40, 80), viewerOf(typist(60)))!;
    expect(sym.averageSpeed.percentile).toBeCloseTo(50, 0);
  });

  it(`a viewer under ${3} counted races gets null value, position and percentile`, () => {
    for (const viewer of [viewerOf(median, 2), viewerOf(median, 0), null]) {
      const census = censusOf(typists, viewer)!;
      for (const k of KINDS) {
        expect(census[k].value).toBeNull();
        expect(census[k].position).toBeNull();
        expect(census[k].percentile).toBeNull();
      }
    }
    const three = censusOf(typists, viewerOf(median, 3))!;
    expect(three.averageSpeed.percentile).not.toBeNull();
  });

  it("the viewer's figures do not change the shapes", () => {
    const a = censusOf(typists, viewerOf(slowest))!;
    const b = censusOf(typists, viewerOf(fastest))!;
    for (const k of KINDS) {
      expect(a[k].bars).toEqual(b[k].bars);
      expect(a[k].cumulative).toEqual(b[k].cumulative);
    }
  });
});
