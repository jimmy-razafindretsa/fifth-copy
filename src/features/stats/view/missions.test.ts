import { describe, expect, it } from "vitest";
import { dayKey } from "@/lib/time";
import {
  buildMissions,
  dayNumber,
  MISSION_TEMPLATES,
  missionFor,
  missionProgress,
  type MissionResult,
  starTotal,
} from "./missions";

// #943 C15, C16: the mission of the day and the stars, pure.

/** Noon Toronto time (17:00Z in winter) on the Toronto day `key`. */
const noon = (key: string) => new Date(`${key}T17:00:00Z`);
const at = (key: string, accuracy: number): MissionResult => ({ createdAt: noon(key), accuracy });

/** A Toronto day key whose day number is a multiple of 3, near 2026-11-13. */
function multipleOfThree(): string {
  for (let d = 10; d < 20; d++) {
    const key = `2026-11-${String(d).padStart(2, "0")}`;
    if (dayNumber(key) % 3 === 0) return key;
  }
  throw new Error("unreachable");
}
const next = (key: string, n: number) =>
  new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10) + n))
    .toISOString()
    .slice(0, 10);

describe("missionFor (C15)", () => {
  it("day 0 is 1970-01-01 and the list holds the three v1 templates in order", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
    expect(MISSION_TEMPLATES.map((m) => [m.id, m.target])).toEqual([
      ["accuracy-95", 3],
      ["finish-3", 3],
      ["accuracy-98", 1],
    ]);
  });

  it("two instants of the same Toronto day give the same template", () => {
    expect(missionFor(new Date("2026-11-13T05:01:00Z")).id).toBe(
      missionFor(new Date("2026-11-14T04:58:00Z")).id,
    );
  });

  it("23:59 and 00:00 Toronto time on consecutive days give consecutive templates", () => {
    // 2026-11-13 23:59 EST = 2026-11-14T04:59Z; 2026-11-14 00:00 EST = 05:00Z
    const before = new Date("2026-11-14T04:59:00Z");
    const after = new Date("2026-11-14T05:00:00Z");
    expect(dayKey(before)).toBe("2026-11-13");
    expect(dayKey(after)).toBe("2026-11-14");
    const ids = MISSION_TEMPLATES.map((m) => m.id);
    const i = ids.indexOf(missionFor(before).id);
    expect(missionFor(after).id).toBe(ids[(i + 1) % ids.length]);
  });

  it("three consecutive days from a multiple of 3 give accuracy-95, finish-3, accuracy-98", () => {
    const first = multipleOfThree();
    expect([0, 1, 2].map((n) => missionFor(noon(next(first, n))).id)).toEqual([
      "accuracy-95",
      "finish-3",
      "accuracy-98",
    ]);
  });
});

describe("missionProgress and starTotal (C16)", () => {
  const a95 = multipleOfThree();
  const f3 = next(a95, 1);
  const a98 = next(a95, 2);

  it("accuracy-95 counts 0.95 and not 0.949; results of other days are ignored", () => {
    const results = [at(a95, 0.95), at(a95, 0.949), at(f3, 1), at(next(a95, -1), 1)];
    expect(missionProgress(results, noon(a95))).toEqual({
      id: "accuracy-95",
      target: 3,
      progress: 1,
      complete: false,
    });
  });

  it("finish-3 counts every counted result and never exceeds the target", () => {
    const results = [0.1, 0.5, 0.9, 0.99, 0.2].map((acc) => at(f3, acc));
    expect(missionProgress(results, noon(f3))).toEqual({
      id: "finish-3",
      target: 3,
      progress: 3,
      complete: true,
    });
  });

  it("accuracy-98 has target 1", () => {
    expect(missionProgress([at(a98, 0.97)], noon(a98))).toMatchObject({
      target: 1,
      progress: 0,
      complete: false,
    });
    expect(missionProgress([at(a98, 0.98)], noon(a98))).toMatchObject({
      progress: 1,
      complete: true,
    });
  });

  it("an empty file reads 0 / target and no star", () => {
    expect(missionProgress([], noon(f3))).toMatchObject({ progress: 0, complete: false });
    expect(starTotal([])).toBe(0);
  });

  it.each([
    ["2 of 3 gives none", [at(f3, 1), at(f3, 1)], 0],
    ["5 qualifying results on one day give one", [1, 1, 1, 1, 1].map((x) => at(f3, x)), 1],
    [
      "three completed days give 3",
      [
        at(a95, 0.96),
        at(a95, 0.97),
        at(a95, 0.99),
        at(f3, 0.1),
        at(f3, 0.2),
        at(f3, 0.3),
        at(a98, 1),
      ],
      3,
    ],
    ["a day of 0.949 results gives none", [0.949, 0.949, 0.949].map((x) => at(a95, x)), 0],
  ])("stars: %s", (_name, results, stars) => {
    expect(starTotal(results)).toBe(stars);
  });

  it("buildMissions returns today and the stars", () => {
    const results = [at(f3, 1), at(f3, 1), at(f3, 1)];
    expect(buildMissions(results, noon(a98))).toEqual({
      today: { id: "accuracy-98", target: 1, progress: 0, complete: false },
      stars: 1,
    });
  });
});
