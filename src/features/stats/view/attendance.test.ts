import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_MONTHS,
  type AttendanceRow,
  attendanceOf,
  bestStreakOf,
  DEFAULT_DAILY_GOAL_MIN,
  dayName,
  goalPercent,
  levelOf,
  monthName,
  weekHeads,
} from "./attendance";
import { buildProfile, type ResultRow } from "./profile";

// #330 C1, C2: the attendance register's read model (stats time zone America/Toronto, ADR 0008).
const MIN = 60_000;
/** A result at a Toronto wall-clock time (`offset` hours behind UTC: 5 in winter, 4 in summer). */
const at = (iso: string, durationMs: number, offset = 5): AttendanceRow => ({
  createdAt: new Date(new Date(`${iso}Z`).getTime() + offset * 3_600_000),
  durationMs,
});

describe("attendanceOf: months (C1)", () => {
  it("an empty file: three months, every day up to today at level 0, no streak", () => {
    const now = new Date("2026-11-12T17:00:00Z");
    const a = attendanceOf([], now, 15);
    expect(a.months.map((m) => m.key)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(a.months.map((m) => m.days.length)).toEqual([30, 31, 30]);
    // Sept 1 2026 is a Tuesday, Oct 1 a Thursday, Nov 1 a Sunday
    expect(a.months.map((m) => m.blanks)).toEqual([1, 3, 6]);
    const nov = a.months[2]!.days;
    expect(nov[11]).toMatchObject({ day: "2026-11-12", date: 12, today: true, future: false });
    expect(nov[11]!.level).toBe(0);
    expect(nov[12]).toMatchObject({ day: "2026-11-13", today: false, future: true, level: null });
    expect(nov.filter((d) => d.future)).toHaveLength(18);
    expect(a).toMatchObject({ currentStreak: 0, bestStreak: 0, activeDays: 0, windowDays: 73 });
    expect(a.goalMin).toBe(15);
    expect(a.months).toHaveLength(ATTENDANCE_MONTHS);
  });

  it("a month starting on a Monday has no blank, one starting on a Sunday has six", () => {
    // June 1 2026 is a Monday; Feb 1 2026 is a Sunday
    expect(attendanceOf([], new Date("2026-06-15T16:00:00Z")).months[2]).toMatchObject({
      key: "2026-06",
      blanks: 0,
    });
    const feb = attendanceOf([], new Date("2026-02-10T16:00:00Z")).months;
    expect(feb.map((m) => m.key)).toEqual(["2025-12", "2026-01", "2026-02"]);
    expect(feb[2]).toMatchObject({ blanks: 6 });
    expect(feb[2]!.days).toHaveLength(28);
  });

  it("February of a leap year has 29 days, and the window counts them", () => {
    const a = attendanceOf([], new Date("2028-03-02T16:00:00Z"));
    expect(a.months.map((m) => m.key)).toEqual(["2028-01", "2028-02", "2028-03"]);
    // Feb 1 2028 is a Tuesday
    expect(a.months[1]).toMatchObject({ blanks: 1 });
    expect(a.months[1]!.days).toHaveLength(29);
    expect(a.windowDays).toBe(31 + 29 + 2);
  });

  it("a cell holds the minutes typed that day: the sum of its results' durationMs", () => {
    const now = new Date("2026-11-12T17:00:00Z");
    const a = attendanceOf(
      [at("2026-11-10T09:00:00", 4 * MIN), at("2026-11-10T21:00:00", 3.5 * MIN)],
      now,
    );
    const day = a.months[2]!.days[9]!;
    expect(day).toMatchObject({ day: "2026-11-10", minutes: 7.5, level: 2 });
  });

  it("the spring clock change (March 8 2026): results fall on their Toronto day", () => {
    const now = new Date("2026-03-20T16:00:00Z");
    const a = attendanceOf(
      [
        // 23:30 EST on March 7 is 04:30 UTC on March 8
        at("2026-03-07T23:30:00", 1 * MIN, 5),
        // 00:30 EST and 23:30 EDT on March 8
        at("2026-03-08T00:30:00", 2 * MIN, 5),
        at("2026-03-08T23:30:00", 3 * MIN, 4),
        // 00:30 EDT on March 9
        at("2026-03-09T00:30:00", 4 * MIN, 4),
      ],
      now,
    );
    const march = a.months[2]!.days;
    expect([march[6]!.minutes, march[7]!.minutes, march[8]!.minutes]).toEqual([1, 5, 4]);
    expect(a.bestStreak).toBe(3);
  });

  it("the autumn clock change (November 1 2026): its 25 hours are one day", () => {
    const now = new Date("2026-11-05T16:00:00Z");
    const a = attendanceOf(
      [
        at("2026-10-31T23:59:00", 1 * MIN, 4),
        // 00:10 EDT and 23:50 EST on November 1
        at("2026-11-01T00:10:00", 2 * MIN, 4),
        at("2026-11-01T23:50:00", 6 * MIN, 5),
        at("2026-11-02T00:10:00", 3 * MIN, 5),
      ],
      now,
    );
    const nov = a.months[2]!.days;
    expect(nov[0]!.minutes).toBe(8);
    expect(nov[0]!.level).toBe(2);
    expect(nov[1]!.minutes).toBe(3);
    expect(a.months[1]!.days[30]!.minutes).toBe(1);
  });

  it("results after today are left out", () => {
    const now = new Date("2026-11-12T17:00:00Z");
    const a = attendanceOf([at("2026-11-14T10:00:00", 20 * MIN)], now);
    expect(a.months[2]!.days[13]).toMatchObject({ minutes: 0, level: null });
    expect(a.activeDays).toBe(0);
  });
});

describe("levels, streaks and active days (C2)", () => {
  const goal = 15 * MIN;
  it.each([
    [0, 0],
    [0.001, 1],
    [49.9, 1],
    [50, 2],
    [74.9, 2],
    [75, 3],
    [99.9, 3],
    [100, 4],
    [250, 4],
  ])("%s %% of the goal is level %s", (pct, level) => {
    expect(levelOf((goal * pct) / 100, 15)).toBe(level);
  });

  it("the goal is an argument: 10 minutes is level 4 against 10 and level 3 against 12", () => {
    expect(levelOf(10 * MIN, 10)).toBe(4);
    expect(levelOf(10 * MIN, 12)).toBe(3);
    expect(DEFAULT_DAILY_GOAL_MIN).toBe(15);
  });

  it("goalPercent rounds down, so it never reads a level the day has not reached", () => {
    expect(goalPercent(11.25, 15)).toBe(75);
    expect(goalPercent(11.24, 15)).toBe(74);
    expect(goalPercent(15, 15)).toBe(100);
  });

  it("current streak ends today or yesterday; best streak is the longest run over the file", () => {
    const now = new Date("2026-11-12T17:00:00Z");
    const days = (from: string, n: number) =>
      Array.from({ length: n }, (_, i) => {
        const d = new Date(`${from}T15:00:00Z`);
        d.setUTCDate(d.getUTCDate() + i);
        return { createdAt: d, durationMs: MIN };
      });
    // a 19-day run in June (outside the window), a 6-day run ending yesterday
    const rows = [...days("2026-06-01", 19), ...days("2026-11-06", 6), ...days("2026-10-01", 2)];
    const a = attendanceOf(rows, now);
    expect(a.currentStreak).toBe(6);
    expect(a.bestStreak).toBe(19);
    expect(a.activeDays).toBe(8);
    expect(a.windowDays).toBe(73);
    // a day missed before yesterday breaks it
    expect(attendanceOf(days("2026-11-06", 5), now).currentStreak).toBe(0);
  });

  it("bestStreakOf counts consecutive calendar days across months", () => {
    expect(bestStreakOf(new Set(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-03"]))).toBe(3);
    expect(bestStreakOf(new Set())).toBe(0);
  });

  it("currentStreak is ProfileActivity.streak (one definition)", () => {
    const now = new Date("2026-11-12T17:00:00Z");
    const row = (daysAgo: number): ResultRow => ({
      createdAt: new Date(now.getTime() - daysAgo * 86_400_000),
      cleanWpm: 40,
      accuracy: 0.95,
      language: "FR",
      durationMs: 5 * MIN,
      place: 2,
    });
    const p = buildProfile([row(0), row(1), row(2), row(4)], now);
    expect(p.attendance.currentStreak).toBe(3);
    expect(p.activity.streak).toBe(p.attendance.currentStreak);
    expect(p.attendance.bestStreak).toBe(3);
    expect(p.attendance.activeDays).toBe(4);
    // the goal reaches the register
    expect(
      buildProfile([row(0)], now, undefined, { goalMin: 5 }).attendance.months[2]!.days[11],
    ).toMatchObject({ level: 4 });
  });
});

describe("names in the locale", () => {
  it("month, day and week heads", () => {
    expect(monthName("2026-11", "fr")).toBe("NOVEMBRE 2026");
    expect(monthName("2026-11", "en")).toBe("NOVEMBER 2026");
    expect(monthName("2027-02", "fr")).toBe("FÉVRIER 2027");
    expect(dayName("2026-11-12", "fr")).toBe("12 novembre");
    expect(dayName("2026-11-12", "en")).toBe("November 12");
    expect(
      weekHeads("fr")
        .map((h) => h.narrow)
        .join(" "),
    ).toBe("L M M J V S D");
    expect(
      weekHeads("en")
        .map((h) => h.narrow)
        .join(" "),
    ).toBe("M T W T F S S");
    expect(weekHeads("fr")[0]!.long).toBe("lundi");
    expect(weekHeads("en")[6]!.long).toBe("Sunday");
  });
});
