import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rankFor, rankIndex } from "./rank";

// #945 C1: the rank scale, a boundary table; thresholds come from the engine.
describe("rankFor (#945 C1)", () => {
  it.each([
    [null, "recruit", "clerk", 35, 0],
    [0, "recruit", "clerk", 35, 0],
    [34.9, "recruit", "clerk", 35, 34.9 / 35],
    [35, "clerk", "officer", 50, 0],
    [50, "officer", "commissar", 70, 0],
    [51.4, "officer", "commissar", 70, 1.4 / 20],
    [70, "commissar", "major", 90, 0],
    [90, "major", null, null, 1],
    [140, "major", null, null, 1],
  ])("%s wpm -> %s", (wpm, rank, nextRank, nextAt, progress) => {
    const step = rankFor(wpm);
    expect(step).toMatchObject({ rank, nextRank, nextAt });
    expect(step.progress).toBeCloseTo(progress, 6);
  });

  it("rank names follow BOT_LEVELS order", () => {
    expect(rankIndex("recruit")).toBe(0);
    expect(rankIndex("major")).toBe(4);
  });

  it("no literal 35 / 50 / 70 / 90 threshold in the rank sources", () => {
    const src = readFileSync(path.join(__dirname, "rank.ts"), "utf8");
    expect(src).not.toMatch(/\b(35|50|70|90)\b/);
    // and no landing source restates them
    const landing = path.resolve(__dirname, "../../landing/components");
    for (const f of readdirSync(landing).filter(
      (n) => /docket.*\.tsx$/.test(n) && !n.includes(".test."),
    )) {
      expect(readFileSync(path.join(landing, f), "utf8"), f).not.toMatch(/\b(35|50|70|90)\b/);
    }
  });
});
