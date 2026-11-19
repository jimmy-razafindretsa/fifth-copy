/**
 * The personal card's one tip (#867, epic #298 "one concrete thing to improve", spec 11.3, bible 14.4
 * "Order of the day"): a pure choice over a small input record, from a closed list of tip ids. Extension
 * point: a larger tip library (#381) adds ids here and their sentences to the catalogs, the card does
 * not change. The library of #999 C40 keys more tips to the error pattern of the most-missed key (the
 * space bar, a capital, punctuation, a digit) and to errors spread thin over many keys.
 */
import { isSpecialKey, MAX_LISTED_KEYS, type MissedKey } from "./keys";
import { REPORT_LINKS } from "./links";

/** The closed list, in priority order (the first that applies wins). */
export const TIP_IDS = [
  "clean",
  "special",
  "space",
  "capital",
  "punctuation",
  "digit",
  "key",
  "spread",
  "accuracy",
  "steady",
] as const;
export type TipId = (typeof TIP_IDS)[number];

/** A key missed this many times names the tip (`special` or `key`). */
export const KEY_TIP_MIN_MISSES = 3;
/** Under this accuracy (0..1) the tip is `accuracy`. */
export const ACCURACY_TIP_BELOW = 0.9;

/** The tips that name the most-missed key. */
export type KeyTipId = "special" | "space" | "capital" | "punctuation" | "digit" | "key";

/** With no key missed 3 times, this many different missed keys make the tip `spread`. */
export const SPREAD_TIP_MIN_KEYS = 5;

export type Tip =
  | { id: "clean" | "accuracy" | "steady" }
  | { id: KeyTipId; char: string; count: number }
  | { id: "spread"; count: number };

const PUNCTUATION = new Set(Array.from(".,;:!?'\"-()…’"));

/** The error pattern a most-missed key belongs to (the first that applies, in `TIP_IDS` order). */
export function keyPattern(char: string): KeyTipId {
  if (isSpecialKey(char) && char !== "’" && char !== "…") return "special";
  if (char === " ") return "space";
  if (/^[A-Z]$/.test(char)) return "capital";
  if (PUNCTUATION.has(char)) return "punctuation";
  if (/^[0-9]$/.test(char)) return "digit";
  return "key";
}

export type TipInput = {
  /** The stored accuracy, 0..1 (`RaceResult.accuracy`). */
  accuracy: number;
  /** Every missed key, most missed first (`missedKeys`); `null` with no trace on file. */
  missed: readonly MissedKey[] | null;
};

/**
 * One tip, always the same for the same input: `clean` when the trace has no error (with no trace, a
 * perfect accuracy); when the most-missed key was missed at least 3 times, the tip of its pattern
 * (`keyPattern`: `special` for a special key, `space`, `capital` for A-Z, `punctuation`, `digit`, else
 * `key`), carrying the character; else `spread` when at least 5 different keys were missed (carrying
 * that count); `accuracy` under 90 %, else `steady`. With no trace the keys are unknown: the tip comes
 * from the accuracy alone (`clean`, `accuracy` or `steady`).
 */
export function pickTip({ accuracy, missed }: TipInput): Tip {
  if (missed === null ? accuracy >= 1 : missed.length === 0) return { id: "clean" };
  const top = missed?.[0];
  if (top && top.count >= KEY_TIP_MIN_MISSES) {
    return { id: keyPattern(top.char), char: top.char, count: top.count };
  }
  if (missed && missed.length >= SPREAD_TIP_MIN_KEYS) return { id: "spread", count: missed.length };
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
 * Where the `special` tip sends the typist: the guide `HOW TO TYPE É Ç « »`, the site header's own link
 * (`LINKS.guide` of the landing feature through `REPORT_LINKS`, #899): `/guide` (#999 C28).
 */
export const GUIDE_HREF = REPORT_LINKS.guide;
