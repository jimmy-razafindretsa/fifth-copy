import { describe, expect, it } from "vitest";
import { ACHIEVEMENT_IDS, isAchievementId } from "./ids";
import { dayStreak, earnedBy, type AwardFacts } from "./rules";

// #999 C34, C35: stable ids; pure rules on clean WPM (ADR 0016), never from a flagged result.

const facts = (over: {
  result?: Partial<AwardFacts["result"]>;
  race?: Partial<AwardFacts["race"]>;
  streakDays?: number | null;
}): AwardFacts => ({
  result: {
    isBot: false,
    suspicious: false,
    status: "FINISHED",
    place: 3,
    cleanWpm: 30,
    accuracy: 0.9,
    ...over.result,
  },
  race: { lobbySize: 4, accentText: false, ...over.race },
  streakDays: over.streakDays ?? null,
});

describe("achievement ids", () => {
  it("are the five stable ids of spec 13.4, in this order", () => {
    expect(ACHIEVEMENT_IDS).toEqual([
      "first-win",
      "wpm-50-club",
      "accuracy-100",
      "accent-master",
      "streak-7-days",
    ]);
    expect(isAchievementId("first-win")).toBe(true);
    expect(isAchievementId("FIRST-WIN")).toBe(false);
  });
});

describe("earnedBy", () => {
  it("an ordinary counted race earns nothing", () => {
    expect(earnedBy(facts({}))).toEqual([]);
  });

  it("first win: place 1 in a race of at least two desks (a solo race is no win)", () => {
    expect(earnedBy(facts({ result: { place: 1 } }))).toEqual(["first-win"]);
    expect(earnedBy(facts({ result: { place: 1 }, race: { lobbySize: 1 } }))).toEqual([]);
  });

  it("50 WPM club reads clean WPM: 50 earns it, 49.9 does not", () => {
    expect(earnedBy(facts({ result: { cleanWpm: 50 } }))).toEqual(["wpm-50-club"]);
    expect(earnedBy(facts({ result: { cleanWpm: 49.9 } }))).toEqual([]);
    expect(earnedBy(facts({ result: { cleanWpm: 55, status: "TIMED_OUT" } }))).toEqual([
      "wpm-50-club",
    ]);
  });

  it("100% accuracy needs a finished race", () => {
    expect(earnedBy(facts({ result: { accuracy: 1 } }))).toEqual(["accuracy-100"]);
    expect(earnedBy(facts({ result: { accuracy: 0.999 } }))).toEqual([]);
    expect(earnedBy(facts({ result: { accuracy: 1, status: "TIMED_OUT" } }))).toEqual([]);
  });

  it("accent master: a finished accent text at 95% accuracy or more", () => {
    expect(earnedBy(facts({ race: { accentText: true }, result: { accuracy: 0.95 } }))).toEqual([
      "accent-master",
    ]);
    expect(earnedBy(facts({ race: { accentText: true }, result: { accuracy: 0.94 } }))).toEqual([]);
    expect(earnedBy(facts({ race: { accentText: false }, result: { accuracy: 0.99 } }))).toEqual(
      [],
    );
  });

  it("7-day streak at seven days in a row; not computed (null) earns nothing", () => {
    expect(earnedBy(facts({ streakDays: 7 }))).toEqual(["streak-7-days"]);
    expect(earnedBy(facts({ streakDays: 6 }))).toEqual([]);
    expect(earnedBy(facts({ streakDays: null }))).toEqual([]);
  });

  it("never from a flagged result, a bot, or a desk that did not count", () => {
    const all = {
      result: { place: 1, cleanWpm: 120, accuracy: 1 },
      race: { accentText: true },
      streakDays: 30,
    };
    expect(earnedBy(facts(all))).toEqual([...ACHIEVEMENT_IDS]);
    expect(earnedBy(facts({ ...all, result: { ...all.result, suspicious: true } }))).toEqual([]);
    expect(earnedBy(facts({ ...all, result: { ...all.result, isBot: true } }))).toEqual([]);
    for (const status of ["REASSIGNED", "ASLEEP", "EXPIRED", "LINE_CUT"]) {
      expect(earnedBy(facts({ ...all, result: { ...all.result, status } })), status).toEqual([]);
    }
  });
});

describe("dayStreak", () => {
  it("counts consecutive stats days ending today", () => {
    const week = [
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
    ];
    expect(dayStreak(week, "2026-11-19")).toBe(7);
    expect(
      dayStreak(
        week.filter((d) => d !== "2026-11-16"),
        "2026-11-19",
      ),
    ).toBe(3);
    expect(dayStreak(week, "2026-11-20")).toBe(0);
    // across a month end, duplicates ignored
    expect(dayStreak(["2026-10-31", "2026-11-01", "2026-11-01"], "2026-11-01")).toBe(2);
  });
});
