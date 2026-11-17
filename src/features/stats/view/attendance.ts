import type { Locale } from "@/i18n/locale";
import { addDays, type DayKey, dayKey } from "@/lib/time";

/**
 * "Registre de présence" (#330, bible 14.3, reference `Profil.dc.html` `FEUILLE DE POINTAGE`; spec 13.2,
 * ADR 0008, 0009): three calendar months of the viewer's days in the stats time zone, each day shaded by
 * how much of the daily goal it typed (the sum of its counted results' `durationMs`), with the current
 * streak, the best streak and the active days. Pure: the query (`queries/get-profile.ts`) reads one
 * narrow scan (date and duration only) of the viewer's counted results, capped at
 * `ATTENDANCE_SCAN_LIMIT` latest rows; computed on read, never stored. The goal is an argument, so the
 * goal setting (#968) passes the viewer's own; until then `DEFAULT_DAILY_GOAL_MIN`.
 */

/** The daily goal in minutes while the viewer has none of their own (#968 adds the setting). */
export const DEFAULT_DAILY_GOAL_MIN = 15;
/** The register shows the current calendar month and the ones before it, this many in all. */
export const ATTENDANCE_MONTHS = 3;
/** The attendance scan reads at most this many latest counted results (date and duration). */
export const ATTENDANCE_SCAN_LIMIT = 10_000;

/** 0: no counted race; 1: above 0; 2: from 50 % of the goal; 3: from 75 %; 4: from 100 %. */
export type AttendanceLevel = 0 | 1 | 2 | 3 | 4;
export const ATTENDANCE_LEVELS = [0, 1, 2, 3, 4] as const satisfies readonly AttendanceLevel[];

/** What the register needs of a result, nothing more. */
export type AttendanceRow = { createdAt: Date; durationMs: number };

export type AttendanceDay = {
  /** `YYYY-MM-DD` in the stats time zone. */
  day: DayKey;
  /** Day of the month, 1..31. */
  date: number;
  /** Minutes typed that day: the sum of its counted results' `durationMs`, in minutes. */
  minutes: number;
  /** `null` after today (no level yet). */
  level: AttendanceLevel | null;
  today: boolean;
  future: boolean;
};

export type AttendanceMonth = {
  /** `YYYY-MM`; `monthName` gives its name in a locale. */
  key: string;
  /** Empty cells before day 1, so day 1 sits under its weekday (weeks start on Monday): 0..6. */
  blanks: number;
  days: AttendanceDay[];
};

export type ProfileAttendance = {
  goalMin: number;
  /** Oldest first; the last one is the current month. */
  months: AttendanceMonth[];
  /** `ProfileActivity.streak`: consecutive days with a counted race, ending today or yesterday. */
  currentStreak: number;
  /** The longest run of consecutive days with a counted race over the scan. */
  bestStreak: number;
  /** Days of level 1 or more among the `windowDays`. */
  activeDays: number;
  /** Days from the first day shown to today, both included. */
  windowDays: number;
};

const MINUTE_MS = 60_000;

/** The level of a day that typed `ms` against a goal of `goalMin` minutes (integer comparisons). */
export function levelOf(ms: number, goalMin: number): AttendanceLevel {
  if (ms <= 0) return 0;
  const goalMs = goalMin * MINUTE_MS;
  if (ms >= goalMs) return 4;
  if (ms * 4 >= goalMs * 3) return 3;
  if (ms * 2 >= goalMs) return 2;
  return 1;
}

/**
 * The current streak (#931, `ProfileActivity.streak`; one definition): consecutive days with a counted
 * result ending today, or yesterday while today has none yet; else 0.
 */
export function currentStreakOf(days: ReadonlySet<DayKey>, today: DayKey): number {
  let day = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(day)) {
    streak += 1;
    day = addDays(day, -1);
  }
  return streak;
}

/** The longest run of consecutive calendar days in `days`. */
export function bestStreakOf(days: ReadonlySet<DayKey>): number {
  let best = 0;
  for (const day of days) {
    // count only from the first day of each run
    if (days.has(addDays(day, -1))) continue;
    let run = 1;
    while (days.has(addDays(day, run))) run += 1;
    best = Math.max(best, run);
  }
  return best;
}

const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

/** Year and month (1..12) `offset` months from `day`'s month. */
function shiftMonth(day: DayKey, offset: number): { year: number; month: number } {
  const [y, m] = day.split("-").map(Number);
  const at = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1 + offset, 1));
  return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1 };
}

/**
 * The register of the viewer's counted `rows` (any order) at `now` against a goal of `goalMin` minutes.
 * Results dated after today are left out (a clock ahead of the server's).
 */
export function attendanceOf(
  rows: readonly AttendanceRow[],
  now: Date,
  goalMin: number = DEFAULT_DAILY_GOAL_MIN,
): ProfileAttendance {
  const today = dayKey(now);
  const msByDay = new Map<DayKey, number>();
  for (const row of rows) {
    const day = dayKey(row.createdAt);
    if (day > today) continue;
    msByDay.set(day, (msByDay.get(day) ?? 0) + Math.max(0, row.durationMs));
  }
  const raced = new Set(msByDay.keys());

  const months: AttendanceMonth[] = [];
  for (let offset = 1 - ATTENDANCE_MONTHS; offset <= 0; offset += 1) {
    const { year, month } = shiftMonth(today, offset);
    const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const blanks = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
    const days = Array.from({ length }, (_, i): AttendanceDay => {
      const day = `${monthKey(year, month)}-${String(i + 1).padStart(2, "0")}`;
      const future = day > today;
      const ms = future ? 0 : (msByDay.get(day) ?? 0);
      return {
        day,
        date: i + 1,
        minutes: ms / MINUTE_MS,
        level: future ? null : levelOf(ms, goalMin),
        today: day === today,
        future,
      };
    });
    months.push({ key: monthKey(year, month), blanks, days });
  }

  const shown = months.flatMap((m) => m.days).filter((d) => !d.future);
  return {
    goalMin,
    months,
    currentStreak: currentStreakOf(raced, today),
    bestStreak: bestStreakOf(raced),
    activeDays: shown.filter((d) => (d.level ?? 0) >= 1).length,
    windowDays: shown.length,
  };
}

/** A day's share of the goal in whole percent, rounded down (so 74.9 % reads 74, under level 3). */
export function goalPercent(minutes: number, goalMin: number): number {
  return Math.floor((minutes * 100) / goalMin + 1e-9);
}

const utcDay = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
};

/** `NOVEMBRE 2026` / `NOVEMBER 2026`. */
export function monthName(key: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" })
    .format(utcDay(`${key}-01`))
    .toLocaleUpperCase(locale);
}

/** `12 novembre` / `November 12`. */
export function dayName(day: DayKey, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(
    utcDay(day),
  );
}

/** The week's heads, Monday first: `narrow` (`L M M J V S D` / `M T W T F S S`) and `long` names. */
export function weekHeads(locale: Locale): { narrow: string; long: string }[] {
  // 2026-06-01 is a Monday
  return Array.from({ length: 7 }, (_, i) => {
    const at = new Date(Date.UTC(2026, 5, 1 + i));
    const name = (weekday: "narrow" | "long") =>
      new Intl.DateTimeFormat(locale, { weekday, timeZone: "UTC" }).format(at);
    return { narrow: name("narrow").toLocaleUpperCase(locale), long: name("long") };
  });
}
