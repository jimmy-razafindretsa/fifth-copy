/**
 * The personal card's one tip (#867, epic #298 "one concrete thing to improve", spec 11.3, bible 14.4
 * "Order of the day"): a pure choice over a small input record, from a closed list of tip ids. Extension
 * point: a larger tip library (#381) adds ids here and their sentences to the catalogs, the card does
 * not change.
 */
import { isSpecialKey, MAX_LISTED_KEYS, type MissedKey } from "./keys";

/** The closed list, in priority order (the first that applies wins). */
export const TIP_IDS = ["clean", "special", "key", "accuracy", "steady"] as const;
export type TipId = (typeof TIP_IDS)[number];

/** A key missed this many times names the tip (`special` or `key`). */
export const KEY_TIP_MIN_MISSES = 3;
/** Under this accuracy (0..1) the tip is `accuracy`. */
export const ACCURACY_TIP_BELOW = 0.9;

export type Tip =
  { id: "clean" | "accuracy" | "steady" } | { id: "special" | "key"; char: string; count: number };

export type TipInput = {
  /** The stored accuracy, 0..1 (`RaceResult.accuracy`). */
  accuracy: number;
  /** Every missed key, most missed first (`missedKeys`); `null` with no trace on file. */
  missed: readonly MissedKey[] | null;
};

/**
 * One tip, always the same for the same input: `clean` when the trace has no error (with no trace, a
 * perfect accuracy), `special` when the most-missed key is a special key (`isSpecialKey`) missed at
 * least 3 times, `key` when it is any other key missed at least 3 times (carrying the character),
 * `accuracy` under 90 %, else `steady`. With no trace the keys are unknown: the tip comes from the
 * accuracy alone (`clean`, `accuracy` or `steady`).
 */
export function pickTip({ accuracy, missed }: TipInput): Tip {
  if (missed === null ? accuracy >= 1 : missed.length === 0) return { id: "clean" };
  const top = missed?.[0];
  if (top && top.count >= KEY_TIP_MIN_MISSES) {
    return { id: isSpecialKey(top.char) ? "special" : "key", char: top.char, count: top.count };
  }
  return accuracy < ACCURACY_TIP_BELOW ? { id: "accuracy" } : { id: "steady" };
}

/** The card's keys and tip sections: the listed keys (at most five; `null` = no trace) and the tip. */
export type Coaching = { keys: MissedKey[] | null; tip: Tip };

export function coachingFrom(input: TipInput): Coaching {
  return {
    keys: input.missed === null ? null : input.missed.slice(0, MAX_LISTED_KEYS),
    tip: pickTip(input),
  };
}

/**
 * Where the `special` tip sends the typist: the guide `HOW TO TYPE É Ç « »` (the site header's link,
 * `LINKS.guide` of the landing feature), which anchors to the landing's "How a race runs" until the
 * special-characters guide (#388) ships its route.
 */
export const GUIDE_HREF = "/#how";
