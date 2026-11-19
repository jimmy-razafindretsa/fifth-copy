import { addDays, type DayKey } from "@/lib/time";
import type { CharStatRow } from "../view/key-file";

/**
 * Improvement callouts (#331, #999 C48, spec 13.2 "Your 'ç' is 30% faster than last week"): week over
 * week, per key, from the daily character stats `CharStatDaily` only (ADR 0024: never a trace). Pure:
 * `query.ts` reads the rows, `calloutsOf` turns them into at most `CALLOUT_LIMIT` callouts, each one
 * sentence of the C40 templates (`profile.callouts`).
 *
 * Weeks are stats days (`STATS_TIME_ZONE`): this week is the 7 days ending today, last week the 7
 * before. Layouts are summed. Only letters are called out (a space or a comma is not a "key" a student
 * practises).
 *
 * **Minimum sample (noise floor):** a key is compared only when it has at least
 * `CALLOUT_MIN_TIMED_HITS` timed presses in EACH of the two weeks; an error callout also needs
 * `CALLOUT_MIN_ERRORS` misses in one of the two weeks and a miss last week (a percentage of zero is
 * not a change). A change under `CALLOUT_MIN_CHANGE` percent is not news.
 *
 * **Flagged results:** none reach the input. The rollup (`jobs/rollup-char-stats.ts`) adds a trace to
 * `CharStatDaily` only when its result is counted (`countedPopulationWhere`: human, not flagged,
 * finished or timed out, race not voided), and results are flagged at filing, before any rollup.
 */

/** Days in a week of the comparison. */
export const CALLOUT_WEEK_DAYS = 7;
/** Timed presses a key needs in each of the two weeks to be compared at all. */
export const CALLOUT_MIN_TIMED_HITS = 20;
/** Misses one of the two weeks needs before an error callout is made. */
export const CALLOUT_MIN_ERRORS = 3;
/** Smallest change, in whole percent, that makes a callout (under it the key is steady). */
export const CALLOUT_MIN_CHANGE = 10;
/** At most this many callouts are shown. */
export const CALLOUT_LIMIT = 3;

export type CalloutKind = "faster" | "slower" | "cleaner" | "messier" | "steady";

export type Callout = {
  kind: CalloutKind;
  /** The key, as stored (lower case, NFC). */
  char: string;
  /** The change in whole percent, unsigned; 0 for `steady`. */
  pct: number;
};

type Week = { hits: number; errors: number; timedHits: number; totalMs: number };

const zero = (): Week => ({ hits: 0, errors: 0, timedHits: 0, totalMs: 0 });

const isLetter = (char: string) => /^\p{L}$/u.test(char);

/** The first day of this week and of last week, for the stats day `today`. */
export function calloutWeeks(today: DayKey): { thisWeek: DayKey; lastWeek: DayKey } {
  return {
    thisWeek: addDays(today, -(CALLOUT_WEEK_DAYS - 1)),
    lastWeek: addDays(today, -(2 * CALLOUT_WEEK_DAYS - 1)),
  };
}

/** `12000 * timedHits / totalMs` (the key file's speed), or null. */
const wpmOf = (w: Week) =>
  w.timedHits > 0 && w.totalMs > 0 ? (12000 * w.timedHits) / w.totalMs : null;

/** The one callout of a key with enough sample in both weeks: its largest change, else steady. */
function calloutOf(char: string, last: Week, now: Week): Callout | null {
  if (last.timedHits < CALLOUT_MIN_TIMED_HITS || now.timedHits < CALLOUT_MIN_TIMED_HITS)
    return null;
  const before = wpmOf(last);
  const after = wpmOf(now);
  if (before === null || after === null) return null;
  const speed = Math.round(((after - before) / before) * 100);
  const candidates: Callout[] = [];
  if (Math.abs(speed) >= CALLOUT_MIN_CHANGE)
    candidates.push({ kind: speed > 0 ? "faster" : "slower", char, pct: Math.abs(speed) });

  const rateBefore = last.hits > 0 ? last.errors / last.hits : 0;
  const rateAfter = now.hits > 0 ? now.errors / now.hits : 0;
  if (rateBefore > 0 && Math.max(last.errors, now.errors) >= CALLOUT_MIN_ERRORS) {
    const errors = Math.round(((rateAfter - rateBefore) / rateBefore) * 100);
    if (Math.abs(errors) >= CALLOUT_MIN_CHANGE)
      candidates.push({ kind: errors < 0 ? "cleaner" : "messier", char, pct: Math.abs(errors) });
  }
  // the largest change wins; on a tie the speed (pushed first) stays
  const best = candidates.reduce<Callout | null>((a, c) => (a && a.pct >= c.pct ? a : c), null);
  return best ?? { kind: "steady", char, pct: 0 };
}

/**
 * The callouts of a typist's character rows for the stats day `today`: one per compared key (its
 * largest change), the largest changes first (then by character), at most `CALLOUT_LIMIT`. Steady keys
 * are told only when no key changed: then the one most pressed this week. Rows outside the two weeks
 * are ignored.
 */
export function calloutsOf(rows: readonly CharStatRow[], today: DayKey): Callout[] {
  const { thisWeek, lastWeek } = calloutWeeks(today);
  const weeks = new Map<string, { last: Week; now: Week }>();
  for (const row of rows) {
    if (row.day < lastWeek || row.day > today || !isLetter(row.char)) continue;
    const entry = weeks.get(row.char) ?? { last: zero(), now: zero() };
    const into = row.day >= thisWeek ? entry.now : entry.last;
    into.hits += row.hits;
    into.errors += row.errors;
    into.timedHits += row.timedHits;
    into.totalMs += row.totalMs;
    weeks.set(row.char, entry);
  }

  const all = [...weeks.entries()].flatMap(([char, { last, now }]) => {
    const c = calloutOf(char, last, now);
    return c ? [{ callout: c, pressed: now.hits }] : [];
  });
  const changed = all
    .filter(({ callout }) => callout.kind !== "steady")
    .map(({ callout }) => callout)
    .sort((a, b) => b.pct - a.pct || (a.char < b.char ? -1 : a.char > b.char ? 1 : 0));
  if (changed.length > 0) return changed.slice(0, CALLOUT_LIMIT);
  const steady = all.sort(
    (a, b) =>
      b.pressed - a.pressed ||
      (a.callout.char < b.callout.char ? -1 : a.callout.char > b.callout.char ? 1 : 0),
  )[0];
  return steady ? [steady.callout] : [];
}
