import type { DayKey } from "@/lib/time";
import { trendLine } from "./performance-curve";

/**
 * The per-key read model of the Personnel file (#961, ADR 0008, ADR 0024): how a typist does on each
 * key and letter pair, from the daily aggregates `CharStatDaily` and `BigramStatDaily` only (never a
 * keystroke). Pure: `getKeyFile` reads the rows, `keyFileOf` turns them into the `KeyFile` the five
 * per-key sections draw (#962, #963, #964, #324, #965).
 *
 * Speed of a key: `12000 * timedHits / totalMs` WPM (five characters a word, mean ms = totalMs /
 * timedHits), the unit of every other speed on the file. Layouts are summed.
 *
 * Extension point: `keyFileOf` takes rows, so a later filter (language, mode, period) passes it a
 * narrower set.
 */

/** The speed a key should reach: under it the key is `weak`. */
export const KEY_GOAL_WPM = 35;
/** The latest stats days (with character rows) the file covers. */
export const KEY_FILE_DAYS = 40;
/** A day's point needs this many timed hits; fewer is a gap in the series. */
export const KEY_MIN_TIMED_HITS = 3;
/** The learning rate is the slope over this many latest present values... */
export const LEARNING_WINDOW = 15;
/** ...and needs at least this many (the trend line's own floor). */
export const LEARNING_MIN_VALUES = 6;
/** A letter pair is listed from this many hits. */
export const PAIR_MIN_HITS = 20;
/** At most this many letter pairs are listed. */
export const PAIR_LIMIT = 6;

/** The 30 reference keys, in the reference's order: A to Z, then É È À Ç (stored lower case). */
export const REFERENCE_KEYS: readonly string[] = [..."abcdefghijklmnopqrstuvwxyzéèàç"];

/** One `CharStatDaily` row as the view reads it; `day` is the stats day key (`YYYY-MM-DD`). */
export type CharStatRow = {
  day: DayKey;
  char: string;
  /** Ignored: layouts are summed. */
  layout?: string;
  hits: number;
  errors: number;
  timedHits: number;
  totalMs: number;
};

/** One `BigramStatDaily` row (or a sum of several) as the view reads it. */
export type PairStatRow = {
  pair: string;
  hits: number;
  errors: number;
  timedHits: number;
  totalMs: number;
};

export type KeyState = "none" | "weak" | "good";

export type KeyFileEntry = {
  char: string;
  /** `none`: no speed yet; `weak`: average under the goal; `good`: at or over it. */
  state: KeyState;
  /** The key's speed on each of `KeyFile.days`; `null` on a day under `KEY_MIN_TIMED_HITS`. */
  series: (number | null)[];
  hits: number;
  errors: number;
  /** `errors / hits`; `null` without a hit. */
  errorRate: number | null;
  /** From the window's sums; `null` without a timed hit. */
  averageWpm: number | null;
  /** The last present value of `series`. */
  latestWpm: number | null;
  /** The highest value of `series`. */
  bestWpm: number | null;
  /** WPM gained per file day: least-squares slope of the last 15 present values; `null` under 6. */
  learningRate: number | null;
};

export type KeyFilePair = { pair: string; errorRate: number; wpm: number | null };

export type CharCount = { hits: number; errors: number };

export type KeyFile = {
  /** The latest `KEY_FILE_DAYS` stats days with character rows, oldest first. */
  days: DayKey[];
  goal: number;
  /** One entry per reference key, in `REFERENCE_KEYS` order. */
  keys: KeyFileEntry[];
  /** The reference key with the most hits (the first in order when tied); `null` when none was hit. */
  mostTyped: string | null;
  /** The weakest letter pairs (at most `PAIR_LIMIT`, each with `PAIR_MIN_HITS` hits or more). */
  pairs: KeyFilePair[];
  /** Hits and errors of every stored character of the window, keyed by character. */
  byChar: Record<string, CharCount>;
};

type Sums = { hits: number; errors: number; timedHits: number; totalMs: number };

const zero = (): Sums => ({ hits: 0, errors: 0, timedHits: 0, totalMs: 0 });

const add = (into: Sums, row: Sums) => {
  into.hits += row.hits;
  into.errors += row.errors;
  into.timedHits += row.timedHits;
  into.totalMs += row.totalMs;
};

/** `12000 * timedHits / totalMs`, or `null` without a usable timing. */
const wpmOf = ({ timedHits, totalMs }: Sums): number | null =>
  timedHits > 0 && totalMs > 0 ? (12000 * timedHits) / totalMs : null;

/** Slope of the last `LEARNING_WINDOW` present values, x = position in the file's days. */
function learningRateOf(series: readonly (number | null)[]): number | null {
  let start = series.length;
  for (let seen = 0; start > 0 && seen < LEARNING_WINDOW; ) {
    start -= 1;
    if (series[start] !== null) seen += 1;
  }
  return trendLine(series.slice(start))?.slope ?? null;
}

function entryOf(char: string, days: readonly DayKey[], perDay: Map<DayKey, Sums>): KeyFileEntry {
  const total = zero();
  const series = days.map((day) => {
    const sums = perDay.get(day);
    if (!sums) return null;
    add(total, sums);
    return sums.timedHits >= KEY_MIN_TIMED_HITS ? wpmOf(sums) : null;
  });
  const present = series.filter((v): v is number => v !== null);
  const averageWpm = wpmOf(total);
  return {
    char,
    state: averageWpm === null ? "none" : averageWpm < KEY_GOAL_WPM ? "weak" : "good",
    series,
    hits: total.hits,
    errors: total.errors,
    errorRate: total.hits > 0 ? total.errors / total.hits : null,
    averageWpm,
    latestWpm: present.at(-1) ?? null,
    bestWpm: present.length > 0 ? Math.max(...present) : null,
    learningRate: learningRateOf(series),
  };
}

function pairsOf(rows: readonly PairStatRow[]): KeyFilePair[] {
  const sums = new Map<string, Sums>();
  for (const row of rows) {
    const into = sums.get(row.pair) ?? zero();
    add(into, row);
    sums.set(row.pair, into);
  }
  return [...sums]
    .filter(([, s]) => s.hits >= PAIR_MIN_HITS)
    .map(([pair, s]) => ({ pair, errorRate: s.errors / s.hits, wpm: wpmOf(s) }))
    .sort(
      (a, b) =>
        b.errorRate - a.errorRate ||
        (a.wpm ?? Infinity) - (b.wpm ?? Infinity) ||
        a.pair.localeCompare(b.pair, "fr"),
    )
    .slice(0, PAIR_LIMIT);
}

/** The `KeyFile` of these rows (#961 C1-C4). Character rows outside the 40 latest days are ignored. */
export function keyFileOf(
  charRows: readonly CharStatRow[],
  pairRows: readonly PairStatRow[],
): KeyFile {
  const days = [...new Set(charRows.map((r) => r.day))].sort().slice(-KEY_FILE_DAYS);
  const inWindow = new Set(days);

  const byKeyDay = new Map<string, Map<DayKey, Sums>>();
  const byChar: Record<string, CharCount> = {};
  for (const row of charRows) {
    if (!inWindow.has(row.day)) continue;
    const perDay = byKeyDay.get(row.char) ?? new Map<DayKey, Sums>();
    byKeyDay.set(row.char, perDay);
    const sums = perDay.get(row.day) ?? zero();
    perDay.set(row.day, sums);
    add(sums, row);
    const count = byChar[row.char] ?? { hits: 0, errors: 0 };
    count.hits += row.hits;
    count.errors += row.errors;
    byChar[row.char] = count;
  }

  const keys = REFERENCE_KEYS.map((char) => entryOf(char, days, byKeyDay.get(char) ?? new Map()));
  const most = keys.reduce<KeyFileEntry | null>(
    (best, k) => (k.hits > (best?.hits ?? 0) ? k : best),
    null,
  );

  return {
    days,
    goal: KEY_GOAL_WPM,
    keys,
    mostTyped: most?.char ?? null,
    pairs: pairsOf(pairRows),
    byChar,
  };
}

/** The file of a typist with no row. */
export const emptyKeyFile = (): KeyFile => keyFileOf([], []);
