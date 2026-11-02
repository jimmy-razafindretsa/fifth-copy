import { describe, expect, it } from "vitest";
import { BOT_LEVEL_WPM, botProfile } from "./profile";
import { BOT_LEVELS } from "./types";

describe("bot profiles (#729, #361)", () => {
  it("lists the five levels in rank order", () => {
    expect(BOT_LEVELS).toEqual(["recruit", "clerk", "officer", "commissar", "major"]);
  });

  it("targets 20, 35, 50, 70 and 90 WPM", () => {
    expect(BOT_LEVEL_WPM).toEqual({
      recruit: 20,
      clerk: 35,
      officer: 50,
      commissar: 70,
      major: 90,
    });
  });

  it.each(BOT_LEVELS)("%s: a profile with the level's target and numeric fields", (level) => {
    const p = botProfile(level);
    expect(p.level).toBe(level);
    expect(p.targetWpm).toBe(BOT_LEVEL_WPM[level]);
    for (const k of ["errorRate", "hesitation", "burst"] as const) {
      expect(Number.isFinite(p[k])).toBe(true);
      expect(p[k]).toBeGreaterThanOrEqual(0);
      expect(p[k]).toBeLessThanOrEqual(1);
    }
  });
});
