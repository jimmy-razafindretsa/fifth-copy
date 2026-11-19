import { guideAnchor, guideHref } from "@/features/guide/client";

/**
 * The in-race stuck hint (#999 C30, C31; spec 14, bible 7.4 notice row): when the viewer keeps missing a
 * special character, one row points at the guide's entry for it, once per character per race. Pure: the
 * prediction counts the wrong presses (`errorsByChar`), this picks the character; `StuckHint` shows it.
 */

/** Wrong presses on one character that make the hint (C30). */
export const STUCK_HINT_ERRORS = 3;
/** How long the hint stays (C31): it leaves after this, or on a click on its link. */
export const STUCK_HINT_MS = 8_000;

/** The guide entry a character is hinted under: `ç` and `Ç` are one (the guide's anchor). */
export const stuckHintKey = (char: string): string | null => guideAnchor(char);

/**
 * The first special character (one the guide files) with `STUCK_HINT_ERRORS` or more wrong presses, in
 * the order the characters first went wrong, whose guide entry was not hinted yet in this race
 * (`hinted`: characters already shown); else `null`. A plain letter, a digit or a space never hints.
 */
export function selectStuckChar(
  errorsByChar: ReadonlyMap<string, number>,
  hinted: ReadonlySet<string>,
): string | null {
  const done = new Set([...hinted].map(stuckHintKey));
  for (const [char, presses] of errorsByChar) {
    if (presses < STUCK_HINT_ERRORS) continue;
    const key = stuckHintKey(char);
    if (key !== null && !done.has(key)) return char;
  }
  return null;
}

/** `/guide#c-cedilla`: the guide's entry for a hinted character (the guide's own link helper). */
export function stuckHintHref(char: string): string | null {
  return guideHref(char);
}
