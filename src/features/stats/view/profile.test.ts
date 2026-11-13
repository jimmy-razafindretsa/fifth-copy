import { describe, expect, it } from "vitest";
import {
  buildProfile,
  EMPTY_SERVICE,
  emptyProfile,
  type ResultRow,
  SERIES_LIMIT,
  serviceOf,
} from "./profile";

// #931 C2: the Personnel file view model, from the viewer's counted results and an injected now.
const NOW = new Date("2026-11-13T17:00:00Z"); // 12:00 in Toronto, Friday 2026-11-13.
/** A counted result on a Toronto day (17:00 UTC is midday there in EST and EDT). */
const row = (
  day: string,
  cleanWpm: number,
  language: "FR" | "EN" = "FR",
  accuracy = 0.9,
  time = "17:00:00",
  place = 2,
  durationMs = 60_000,
): ResultRow => ({
  createdAt: new Date(`${day}T${time}Z`),
  cleanWpm,
  accuracy,
  language,
  durationMs,
  place,
});
const LAST_7 = [
  "2026-11-07",
  "2026-11-08",
  "2026-11-09",
  "2026-11-10",
  "2026-11-11",
  "2026-11-12",
  "2026-11-13",
];

describe("buildProfile", () => {
  it("zero results: the empty profile, every figure empty or zero, seven empty days", () => {
    const p = buildProfile([], NOW);
    expect(p).toEqual(emptyProfile(NOW));
    expect(p.total).toBe(0);
    expect(p.progress).toEqual({ series: [], gain: null, current7: { wpm: null, accuracy: null } });
    expect(p.languages).toEqual({
      FR: { races: 0, bestWpm: null, meanWpm: null },
      EN: { races: 0, bestWpm: null, meanWpm: null },
    });
    expect(p.activity.streak).toBe(0);
    expect(p.activity.last7Days).toEqual(LAST_7.map((day) => ({ day, races: 0 })));
  });

  it("3 results: series oldest first with its 7-day average, no gain yet, per-language figures", () => {
    const rows = [
      row("2026-11-13", 50, "FR", 1, "18:00:00"),
      row("2026-11-11", 30, "EN", 0.8),
      row("2026-11-13", 40, "FR", 0.9),
    ];
    const p = buildProfile(rows, NOW);
    expect(p.total).toBe(3);
    expect(p.progress.series).toEqual([
      { at: "2026-11-11T17:00:00.000Z", day: "2026-11-11", cleanWpm: 30, accuracy: 0.8, avg7: 30 },
      { at: "2026-11-13T17:00:00.000Z", day: "2026-11-13", cleanWpm: 40, accuracy: 0.9, avg7: 40 },
      { at: "2026-11-13T18:00:00.000Z", day: "2026-11-13", cleanWpm: 50, accuracy: 1, avg7: 40 },
    ]);
    expect(p.progress.gain).toBeNull();
    expect(p.progress.current7.wpm).toBe(40);
    expect(p.progress.current7.accuracy).toBeCloseTo(0.9);
    expect(p.languages).toEqual({
      FR: { races: 2, bestWpm: 50, meanWpm: 45 },
      EN: { races: 1, bestWpm: 30, meanWpm: 30 },
    });
    // Today, then nothing on the 12th: the streak is today alone.
    expect(p.activity.streak).toBe(1);
    expect(p.activity.last7Days.map((d) => d.races)).toEqual([0, 0, 0, 0, 1, 0, 2]);
  });

  it("a two-week file in both languages: gain, current 7-day average, 14-day streak", () => {
    // One race a day from 2026-10-31 (EDT) to 2026-11-13 (EST), 30 WPM rising by 2 a day.
    const rows = Array.from({ length: 14 }, (_, i) => {
      const day = new Date(Date.UTC(2026, 9, 31 + i)).toISOString().slice(0, 10);
      return row(day, 30 + 2 * i, i % 2 === 0 ? "FR" : "EN", 0.9 + i / 1000);
    });
    const p = buildProfile(rows, NOW);
    expect(p.total).toBe(14);
    expect(p.progress.series).toHaveLength(14);
    expect(p.progress.series[0]?.day).toBe("2026-10-31");
    expect(p.progress.series[13]?.day).toBe("2026-11-13");
    // Moving average at the 8th race (2026-11-07): races of 11-01..11-07, i = 1..7.
    expect(p.progress.series[7]?.avg7).toBe(38);
    // Latest five (i 9..13, mean 52) minus earliest five (i 0..4, mean 34).
    expect(p.progress.gain).toBe(18);
    // The 7 days ending today: i 7..13, mean 50.
    expect(p.progress.current7.wpm).toBe(50);
    expect(p.progress.current7.accuracy).toBeCloseTo(0.91);
    expect(p.languages.FR).toEqual({ races: 7, bestWpm: 54, meanWpm: 42 });
    expect(p.languages.EN).toEqual({ races: 7, bestWpm: 56, meanWpm: 44 });
    expect(p.activity.streak).toBe(14);
    expect(p.activity.last7Days.every((d) => d.races === 1)).toBe(true);
  });

  it("a broken streak counts only the days since the gap", () => {
    const rows = [
      row("2026-11-13", 40),
      row("2026-11-12", 40),
      row("2026-11-10", 40),
      row("2026-11-09", 40),
    ];
    expect(buildProfile(rows, NOW).activity.streak).toBe(2);
    // Last race two days ago: the streak is over.
    expect(buildProfile([row("2026-11-11", 40)], NOW).activity.streak).toBe(0);
  });

  it("a streak is kept alive by yesterday until today ends", () => {
    const rows = [row("2026-11-12", 40), row("2026-11-11", 40), row("2026-11-10", 40)];
    const p = buildProfile(rows, NOW);
    expect(p.activity.streak).toBe(3);
    // No race today: the current 7-day average still holds the last days.
    expect(p.progress.current7.wpm).toBe(40);
  });

  it("days are Toronto days: 23:30 Toronto counts for that day, not the UTC one", () => {
    // 2026-11-12 23:30 EST = 2026-11-13 04:30 UTC: yesterday in Toronto, so the streak is 1 and today is empty.
    const p = buildProfile([row("2026-11-13", 40, "FR", 0.9, "04:30:00")], NOW);
    expect(p.activity.streak).toBe(1);
    expect(p.progress.series[0]?.day).toBe("2026-11-12");
    expect(p.activity.last7Days.at(-1)).toEqual({ day: "2026-11-13", races: 0 });
    expect(p.activity.last7Days.at(-2)).toEqual({ day: "2026-11-12", races: 1 });
  });

  it("a negative gain when the typist slowed down", () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => row(`2026-11-0${i + 1}`, 60)),
      ...Array.from({ length: 5 }, (_, i) => row(`2026-11-1${i}`, 50.4)),
    ];
    expect(buildProfile(rows, NOW).progress.gain).toBe(-10);
  });

  it("the gain is null under 10 results and rounded from 10", () => {
    const nine = Array.from({ length: 9 }, (_, i) => row(`2026-11-0${i + 1}`, 40 + i));
    expect(buildProfile(nine, NOW).progress.gain).toBeNull();
    const ten = [...nine, row("2026-11-10", 49.4)];
    // Latest five 45..48 + 49.4 (mean 47.08) minus earliest five 40..44 (mean 42) = 5.08.
    expect(buildProfile(ten, NOW).progress.gain).toBe(5);
  });

  it("the 7-day window drops the 8th day back", () => {
    const rows = [row("2026-11-06", 100), row("2026-11-07", 40), row("2026-11-13", 60)];
    const p = buildProfile(rows, NOW);
    expect(p.progress.current7.wpm).toBe(50);
    expect(p.progress.series.map((s) => s.avg7)).toEqual([100, 70, 50]);
  });

  it(`the series keeps the latest ${SERIES_LIMIT} results, oldest first`, () => {
    const rows = Array.from({ length: 250 }, (_, i) =>
      row(
        "2026-11-13",
        i,
        "FR",
        0.9,
        `10:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`,
      ),
    );
    const p = buildProfile(rows, NOW);
    expect(SERIES_LIMIT).toBe(200);
    expect(p.progress.series).toHaveLength(200);
    expect(p.progress.series[0]?.cleanWpm).toBe(50);
    expect(p.progress.series[199]?.cleanWpm).toBe(249);
    expect(p.total).toBe(250);
  });

  it("whole-file totals and earliest results from the query win over the loaded rows", () => {
    const latest = Array.from({ length: 10 }, (_, i) => row(`2026-11-0${(i % 9) + 1}`, 50));
    const p = buildProfile(latest, NOW, {
      earliest: Array.from({ length: 5 }, () => row("2025-01-01", 20)),
      languages: {
        FR: { races: 400, bestWpm: 90, meanWpm: 45 },
        EN: { races: 12, bestWpm: 60, meanWpm: 41 },
      },
      service: { ...EMPTY_SERVICE, races: 412, wins: 7, podiums: 20 },
    });
    expect(p.service.wins).toBe(7);
    expect(p.total).toBe(412);
    expect(p.progress.gain).toBe(30);
    expect(p.languages.FR.bestWpm).toBe(90);
  });
});

// #932 C3: the service record (whole file: time on duty, races, best/mean speed and accuracy, wins, podiums).
describe("serviceOf", () => {
  it("no rows: every figure blank, zero races", () => {
    expect(serviceOf([])).toEqual(EMPTY_SERVICE);
    expect(emptyProfile(NOW).service).toEqual(EMPTY_SERVICE);
  });

  it("sums durations, counts first places as wins and places 1 to 3 as podiums", () => {
    const s = serviceOf([
      row("2026-11-10", 40, "FR", 0.9, "17:00:00", 1, 30_000),
      row("2026-11-11", 50, "EN", 0.95, "17:00:00", 3, 45_000),
      row("2026-11-12", 30, "FR", 0.8, "17:00:00", 4, 60_000),
    ]);
    expect(s.totalMs).toBe(135_000);
    expect(s.races).toBe(3);
    expect(s.bestWpm).toBe(50);
    expect(s.meanWpm).toBe(40);
    expect(s.bestAccuracy).toBe(0.95);
    expect(s.meanAccuracy).toBeCloseTo(0.8833, 4);
    expect(s.wins).toBe(1);
    expect(s.podiums).toBe(2);
  });
});
