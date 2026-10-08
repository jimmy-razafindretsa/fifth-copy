import type { TextOverlay } from "../types";

/**
 * Per-desk text overlays (ADR 0007 "base + overlay"): bonuses never edit the base text, they add
 * words at the end (`extra`) or drop base words by index (`removed`). Every function is pure and
 * works on the normalised text (`normalizeTypeable`), where words are separated by single spaces.
 */

export const EMPTY_OVERLAY: TextOverlay = { extra: [], removed: [] };

/** The space-separated words of a text: `wordsOf(t).join(" ") === t`; `[]` for an empty text. */
export function wordsOf(text: string): string[] {
  return text === "" ? [] : text.split(" ");
}

function keptBaseWords(base: string, overlay: TextOverlay): { word: string; index: number }[] {
  const removed = new Set(overlay.removed);
  return wordsOf(base)
    .map((word, index) => ({ word, index }))
    .filter(({ index }) => !removed.has(index));
}

/** The text a desk types: base words minus the `removed` indexes, then the `extra` words. */
export function effectiveText(base: string, overlay: TextOverlay): string {
  if (overlay.extra.length === 0 && overlay.removed.length === 0) return base;
  return [...keptBaseWords(base, overlay).map(({ word }) => word), ...overlay.extra].join(" ");
}

/**
 * Characters of the effective text that belong to the base text: the kept base words and their
 * separators, without the space before the first extra word nor the extras (clean WPM, ADR 0016).
 */
export function baseLengthOf(base: string, overlay: TextOverlay): number {
  return keptBaseWords(base, overlay)
    .map(({ word }) => word)
    .join(" ").length;
}

/**
 * Base word indexes still ahead of a desk, in text order: every kept base word after the word at
 * `reach`, the furthest cursor the desk ever had in its effective text (its high-water mark; a
 * backspace does not lower it). The word at `reach` is the first word ending strictly after it: the
 * word being typed, or the next one when `reach` sits on a separator, so the result never touches a
 * character at or before `reach` and the effective text stays longer than `reach`. Removing these
 * words therefore never finishes a desk, and the reducer replayed over the desk's whole trace on
 * the new effective text lands on the same state (the trace is reproducible, ADR 0016).
 * A `reach` already among the extra words gets `[]`.
 */
export function untypedBaseWords(base: string, overlay: TextOverlay, reach: number): number[] {
  const kept = keptBaseWords(base, overlay);
  let start = 0;
  for (let k = 0; k < kept.length; k++) {
    const end = start + kept[k]!.word.length;
    if (end > reach) return kept.slice(k + 1).map(({ index }) => index);
    start = end + 1;
  }
  return [];
}
