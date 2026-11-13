import { addDays, type DayKey, dayKey } from "@/lib/time";

/**
 * The Personnel file read model (#931, spec 13.2, ADR 0008, 0016). Pure: it takes the viewer's counted
 * results (the query selects them, see `queries/get-profile.ts`) and an injected `now`, and follows the
 * definitions fixed on the card. Every speed is `cleanWpm`. `Profile` is a record of sections, so later
 * cards add sections (bests per text type and length #321, heatmap #324, callouts #314).
 */

export const LANGUAGES = ["FR", "EN"] as const;
export type Language = (typeof LANGUAGES)[number];

/** At most this many points in the series: the latest counted results. */
export const SERIES_LIMIT = 200;
/** The gain compares the mean of this many latest results with the mean of as many earliest ones. */
export const GAIN_SAMPLE = 5;
/** No gain under this many counted results. */
export const GAIN_MIN_RESULTS = 10;
/** Days in the moving-average window and in the activity strip, the day itself included. */
export const WINDOW_DAYS = 7;

/** One counted result of the viewer: what the view reads, nothing more. */
export type ResultRow = {
  createdAt: Date;
  cleanWpm: number;
  /** 0..1. */
  accuracy: number;
  language: Language;
  /** The race's duration in ms (`RaceResult.durationMs`). */
  durationMs: number;
  /** 1 = won (`RaceResult.place`). */
  place: number;
};

/**
 * The service record (#932, spec 13.2): whole-file figures over every counted result. Every field is
 * `null` with no race (`races` is 0 then). Speeds are clean WPM (ADR 0016); accuracies are 0..1.
 */
export type ProfileService = {
  /** Sum of `durationMs`. */
  totalMs: number | null;
  races: number;
  bestWpm: number | null;
  meanWpm: number | null;
  bestAccuracy: number | null;
  meanAccuracy: number | null;
  /** Results at place 1. */
  wins: number | null;
  /** Results at places 1 to 3. */
  podiums: number | null;
};

export type SeriesPoint = {
  /** ISO instant of the result. */
  at: string;
  /** Its `America/Toronto` day. */
  day: DayKey;
  cleanWpm: number;
  accuracy: number;
  /** Mean `cleanWpm` of the series results of the 7 days ending on `day`. */
  avg7: number;
};

export type LanguageStats = {
  races: number;
  /** `null` with no race in that language. */
  bestWpm: number | null;
  meanWpm: number | null;
};

export type ProfileProgress = {
  /** Oldest first, at most `SERIES_LIMIT` points. */
  series: SeriesPoint[];
  /** Rounded WPM, latest five minus earliest five; `null` under `GAIN_MIN_RESULTS` results. */
  gain: number | null;
  /** The 7 days ending today; both `null` when they hold no race. */
  current7: { wpm: number | null; accuracy: number | null };
};

export type ProfileActivity = {
  /** Consecutive days with a counted result, ending today or yesterday; else 0. */
  streak: number;
  /** The 7 days ending today, oldest first. */
  last7Days: { day: DayKey; races: number }[];
};

export type Profile = {
  /** Every counted result of the viewer. */
  total: number;
  progress: ProfileProgress;
  languages: Record<Language, LanguageStats>;
  activity: ProfileActivity;
  service: ProfileService;
};

/**
 * Whole-file figures the query reads beside the latest results, so a long file keeps exact totals,
 * bests and gain while only `SERIES_LIMIT` rows are loaded. Without them they come from `rows`.
 */
export type ProfileTotals = {
  /** The earliest counted results (at least `GAIN_SAMPLE` when the file has that many). */
  earliest: ResultRow[];
  languages: Record<Language, LanguageStats>;
  /** The whole file's service record (one aggregate and one count by place, #932). */
  service: ProfileService;
};

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

const byTime = (a: ResultRow, b: ResultRow) => a.createdAt.getTime() - b.createdAt.getTime();

/** No race on file: every figure `null`, `races` 0. */
export const EMPTY_SERVICE: ProfileService = {
  totalMs: null,
  races: 0,
  bestWpm: null,
  meanWpm: null,
  bestAccuracy: null,
  meanAccuracy: null,
  wins: null,
  podiums: null,
};

/** The service record of `rows` (the whole file when they are all of it). */
export function serviceOf(rows: ResultRow[]): ProfileService {
  if (rows.length === 0) return EMPTY_SERVICE;
  const wpm = rows.map((r) => r.cleanWpm);
  const accuracy = rows.map((r) => r.accuracy);
  return {
    totalMs: rows.reduce((sum, r) => sum + r.durationMs, 0),
    races: rows.length,
    bestWpm: Math.max(...wpm),
    meanWpm: mean(wpm),
    bestAccuracy: Math.max(...accuracy),
    meanAccuracy: mean(accuracy),
    wins: rows.filter((r) => r.place === 1).length,
    podiums: rows.filter((r) => r.place >= 1 && r.place <= 3).length,
  };
}

function languageStats(rows: ResultRow[]): Record<Language, LanguageStats> {
  const stats = {} as Record<Language, LanguageStats>;
  for (const language of LANGUAGES) {
    const wpm = rows.filter((r) => r.language === language).map((r) => r.cleanWpm);
    stats[language] = {
      races: wpm.length,
      bestWpm: wpm.length === 0 ? null : Math.max(...wpm),
      meanWpm: mean(wpm),
    };
  }
  return stats;
}

/** Results whose day falls in the `WINDOW_DAYS` days ending on `day`. */
function inWindow<T extends { day: DayKey }>(items: T[], day: DayKey): T[] {
  const first = addDays(day, -(WINDOW_DAYS - 1));
  return items.filter((i) => i.day >= first && i.day <= day);
}

function streakOf(days: Set<DayKey>, today: DayKey): number {
  let day = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(day)) {
    streak += 1;
    day = addDays(day, -1);
  }
  return streak;
}

/**
 * The `Profile` of a viewer from their counted results (any order) at `now`. The series, the 7-day
 * figures and the streak read the latest `SERIES_LIMIT` results; totals, per-language figures, the
 * service record and the gain's earliest five read `totals` when given (the whole file), else the same
 * rows.
 */
export function buildProfile(rows: ResultRow[], now: Date, totals?: ProfileTotals): Profile {
  const sorted = [...rows].sort(byTime);
  const latest = sorted.slice(-SERIES_LIMIT).map((r) => ({ ...r, day: dayKey(r.createdAt) }));
  const today = dayKey(now);
  const languages = totals?.languages ?? languageStats(sorted);
  const total = LANGUAGES.reduce((sum, l) => sum + languages[l].races, 0);

  const series: SeriesPoint[] = latest.map((r) => ({
    at: r.createdAt.toISOString(),
    day: r.day,
    cleanWpm: r.cleanWpm,
    accuracy: r.accuracy,
    avg7: mean(inWindow(latest, r.day).map((w) => w.cleanWpm)) ?? r.cleanWpm,
  }));

  const earliest = (totals?.earliest ?? sorted).slice().sort(byTime).slice(0, GAIN_SAMPLE);
  const earliestMean = mean(earliest.map((r) => r.cleanWpm));
  const latestMean = mean(latest.slice(-GAIN_SAMPLE).map((r) => r.cleanWpm));
  const gain =
    total < GAIN_MIN_RESULTS || earliestMean === null || latestMean === null
      ? null
      : Math.round(latestMean - earliestMean) || 0;

  const week = inWindow(latest, today);
  const days = new Set(latest.map((r) => r.day));
  const last7Days = Array.from({ length: WINDOW_DAYS }, (_, i) => {
    const day = addDays(today, i - (WINDOW_DAYS - 1));
    return { day, races: latest.filter((r) => r.day === day).length };
  });

  return {
    total,
    progress: {
      series,
      gain,
      current7: {
        wpm: mean(week.map((r) => r.cleanWpm)),
        accuracy: mean(week.map((r) => r.accuracy)),
      },
    },
    languages,
    activity: { streak: streakOf(days, today), last7Days },
    service: totals?.service ?? serviceOf(sorted),
  };
}

/** The profile of a viewer with no counted result (a visitor, a brand-new typist). */
export function emptyProfile(now: Date): Profile {
  return buildProfile([], now);
}
