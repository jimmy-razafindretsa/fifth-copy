import type { Rng } from "../types";

/**
 * Hesitation (#361, R125): a typist pauses before punctuation and accented letters. Punctuation is
 * any character that is not a letter, a digit or a space (`« » €` included); an accented letter is
 * a non-ASCII letter (`é`, `ç`, `œ`...).
 */
const LETTER = /\p{L}/u;
const DIGIT = /\p{Nd}/u;

export function hesitatesBefore(ch: string | undefined): boolean {
  if (ch === undefined || ch === " " || DIGIT.test(ch)) return false;
  if (!LETTER.test(ch)) return true;
  return ch.charCodeAt(0) > 0x7f;
}

/** Shortest and longest extra pause, in mean delays: always well above the 1.5x of C5. */
export const PAUSE_MIN = 1.6;
export const PAUSE_SPAN = 1.2;
/** Mean extra pause, in mean delays (the pace normalisation counts it, so WPM stays on target). */
export const PAUSE_MEAN = PAUSE_MIN + PAUSE_SPAN / 2;

/** The extra pause before position `i`, in mean delays: 0, or a pause with chance `hesitation`. */
export function pauseUnits(ch: string | undefined, hesitation: number, rng: Rng): number {
  if (!hesitatesBefore(ch) || hesitation <= 0) return 0;
  if (rng() >= hesitation) return 0;
  return PAUSE_MIN + PAUSE_SPAN * rng();
}
