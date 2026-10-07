import { describe, expect, it } from "vitest";
import { mulberry32, pick, pickInt } from "../testing/rng";
import type { PlayerStatus } from "../types";
import { compareResults, placeOf, rank, type Rankable } from "./compare";

function r(
  desk: number,
  status: PlayerStatus,
  progress: number,
  accuracy = 1,
  finishedAt: number | null = null,
): Rankable {
  return { desk, status, progress, accuracy, finishedAt };
}

function fin(desk: number, finishedAt: number, accuracy = 1): Rankable {
  return r(desk, "finished", 1, accuracy, finishedAt);
}

/** C3: each case lists the expected desk order after `rank`. */
const CASES: { name: string; input: Rankable[]; expected: number[] }[] = [
  {
    name: "two finishers: earlier finish first",
    input: [fin(1, 50_000), fin(2, 40_000)],
    expected: [2, 1],
  },
  {
    name: "a finisher precedes any unfinished player, even a nearly done one",
    input: [r(1, "typing", 0.99), fin(2, 90_000, 0.5)],
    expected: [2, 1],
  },
  {
    name: "finish time beats accuracy among finishers",
    input: [fin(1, 30_000, 0.7), fin(2, 31_000, 1)],
    expected: [1, 2],
  },
  {
    name: "unfinished ordered by progress",
    input: [r(1, "typing", 0.4), r(2, "typing", 0.7), r(3, "typing", 0.1)],
    expected: [2, 1, 3],
  },
  {
    name: "equal progress: higher accuracy first",
    input: [r(1, "typing", 0.5, 0.9), r(2, "typing", 0.5, 0.95)],
    expected: [2, 1],
  },
  {
    name: "line-cut ranked by frozen progress among the unfinished",
    input: [r(1, "typing", 0.3), r(2, "line-cut", 0.6), r(3, "typing", 0.8)],
    expected: [3, 2, 1],
  },
  {
    name: "expired ranked by progress at disconnect among the unfinished",
    input: [r(1, "expired", 0.8), r(2, "typing", 0.5), r(3, "expired", 0.2)],
    expected: [1, 2, 3],
  },
  {
    name: "asleep with higher progress precedes typing with lower progress (ADR 0007)",
    input: [r(1, "typing", 0.4), r(2, "asleep", 0.7)],
    expected: [2, 1],
  },
  {
    name: "asleep with lower progress follows typing",
    input: [r(1, "asleep", 0.2), r(2, "typing", 0.5)],
    expected: [2, 1],
  },
  {
    name: "asleep and line-cut tied on progress: accuracy decides",
    input: [r(1, "asleep", 0.5, 0.8), r(2, "line-cut", 0.5, 0.9)],
    expected: [2, 1],
  },
  {
    name: "abandoned (Reassigned) last, whatever their progress",
    input: [r(1, "abandoned", 0.9), r(2, "typing", 0.1), r(3, "asleep", 0.05)],
    expected: [2, 3, 1],
  },
  {
    name: "abandoned among themselves: progress, then accuracy, then desk",
    input: [
      r(5, "abandoned", 0.3, 0.9),
      r(2, "abandoned", 0.3, 0.9),
      r(1, "abandoned", 0.5, 0.5),
      r(3, "abandoned", 0.3, 0.95),
    ],
    expected: [1, 3, 2, 5],
  },
  {
    name: "full tie among unfinished: lower desk first",
    input: [r(3, "typing", 0.5, 0.9), r(1, "expired", 0.5, 0.9)],
    expected: [1, 3],
  },
  {
    name: "same finish time: lower desk first",
    input: [fin(4, 30_000), fin(2, 30_000)],
    expected: [2, 4],
  },
  {
    name: "a whole race with every status",
    input: [
      r(1, "abandoned", 0.95),
      r(2, "asleep", 0.6),
      fin(3, 70_000),
      r(4, "line-cut", 0.6, 0.97),
      r(5, "typing", 0.3),
      fin(6, 65_000),
      r(7, "expired", 0.8),
    ],
    expected: [6, 3, 7, 2, 4, 5, 1],
  },
];

describe("compareResults ranking table (C3)", () => {
  it("has at least 12 cases", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(12);
  });

  it.each(CASES)("$name", ({ input, expected }) => {
    expect(rank(input).map((p) => p.desk)).toEqual(expected);
  });

  it("rank returns a new array and leaves its input untouched", () => {
    const input = [r(1, "typing", 0.1), r(2, "typing", 0.9)];
    const copy = [...input];
    const out = rank(input);
    expect(out).not.toBe(input);
    expect(input).toEqual(copy);
  });

  it("returns exactly -1, 0 or 1 (never -0)", () => {
    const a = r(1, "typing", 0.5);
    expect(Object.is(compareResults(a, a), 0)).toBe(true);
    expect(compareResults(a, r(2, "typing", 0.5))).toBe(-1);
    expect(compareResults(r(2, "typing", 0.5), a)).toBe(1);
  });
});

describe("placeOf", () => {
  const race = [r(1, "typing", 0.2), fin(2, 40_000), r(3, "abandoned", 0.9), r(4, "asleep", 0.5)];

  it.each([
    { desk: 2, place: 1 },
    { desk: 4, place: 2 },
    { desk: 1, place: 3 },
    { desk: 3, place: 4 },
  ])("desk $desk is place $place", ({ desk, place }) => {
    expect(placeOf(race, desk)).toBe(place);
  });

  it("is 0 for a desk not in the race", () => {
    expect(placeOf(race, 9)).toBe(0);
  });
});

const STATUSES: PlayerStatus[] = [
  "typing",
  "finished",
  "abandoned",
  "asleep",
  "line-cut",
  "expired",
];
const PROGRESS = [0, 0.25, 0.5, 0.75, 1];
const ACCURACY = [0.8, 0.9, 1];
const FINISHED_AT = [10_000, 20_000, 30_000];

/** A random race: unique desks, values from small grids so ties are frequent. */
function randomRace(seed: number): Rankable[] {
  const rng = mulberry32(seed);
  const desks = Array.from({ length: 20 }, (_, i) => i + 1);
  const size = 1 + pickInt(rng, 12);
  const out: Rankable[] = [];
  for (let i = 0; i < size; i++) {
    const desk = desks.splice(pickInt(rng, desks.length), 1)[0] as number;
    const status = pick(rng, STATUSES);
    const finished = status === "finished";
    out.push({
      desk,
      status,
      progress: finished ? 1 : pick(rng, PROGRESS),
      accuracy: pick(rng, ACCURACY),
      finishedAt: finished ? pick(rng, FINISHED_AT) : null,
    });
  }
  return out;
}

const desksOf = (list: Rankable[]) => list.map((p) => p.desk);

describe("compareResults is a strict total order (C4)", () => {
  it("over 500 seeded random races", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const race = randomRace(seed);
      const ctx = `seed ${seed}`;
      for (const a of race) {
        expect(Object.is(compareResults(a, a), 0), ctx).toBe(true);
        for (const b of race) {
          const ab = compareResults(a, b);
          expect([-1, 0, 1], ctx).toContain(ab);
          expect(ab === -compareResults(b, a), ctx).toBe(true);
          // total: with unique desks only a player equals itself
          expect(ab === 0, ctx).toBe(a.desk === b.desk);
          for (const c of race) {
            if (ab <= 0 && compareResults(b, c) <= 0) {
              expect(compareResults(a, c) <= 0, ctx).toBe(true);
            }
          }
        }
      }
      const once = rank(race);
      expect(desksOf(rank(once)), ctx).toEqual(desksOf(once));
      expect(desksOf(rank([...race].reverse())), ctx).toEqual(desksOf(once));
    }
  });
});
