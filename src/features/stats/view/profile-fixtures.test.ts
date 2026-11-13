import { describe, expect, it } from "vitest";
import { profileFixtures } from "./profile-fixtures";

// #931 C5: the three fixtures the page and its component tests start from.
describe("profileFixtures", () => {
  it("brand-new: nothing on file", () => {
    const p = profileFixtures["brand-new"];
    expect(p.total).toBe(0);
    expect(p.progress.series).toEqual([]);
    expect(p.progress.gain).toBeNull();
    expect(p.activity.streak).toBe(0);
  });

  it("early: three races, bests per language, no gain yet", () => {
    const p = profileFixtures.early;
    expect(p.total).toBe(3);
    expect(p.progress.series).toHaveLength(3);
    expect(p.progress.gain).toBeNull();
    expect(p.languages.FR.bestWpm).toBe(33.1);
    expect(p.languages.EN.races).toBe(1);
    expect(p.activity.streak).toBe(3);
  });

  it("two-weeks: both languages, a positive gain, a streak since the missed day", () => {
    const p = profileFixtures["two-weeks"];
    expect(p.total).toBeGreaterThanOrEqual(10);
    expect(p.languages.FR.races).toBeGreaterThan(0);
    expect(p.languages.EN.races).toBeGreaterThan(0);
    expect(p.progress.gain).toBeGreaterThan(0);
    expect(p.progress.current7.wpm).not.toBeNull();
    expect(p.activity.streak).toBe(9);
    expect(p.activity.last7Days.every((d) => d.races > 0)).toBe(true);
  });
});
