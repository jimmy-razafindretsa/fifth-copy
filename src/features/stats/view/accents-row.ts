import type { CharCount } from "./key-file";
import { capOf, type KeyboardMapKey } from "./keyboard-map";

/**
 * The accents row of the Personnel file (#999 C55, spec 13.2 "Accents & special characters: dedicated
 * FR heatmap row (é è ê à ç ù œ « » …)"): the key file's `byChar` (#961) on one row of the characters
 * the caller hands in (the guide's list, so every key has a guide entry, C29). Pure, the keyboard map's
 * key shape, so the same circle and core draw it.
 *
 * The circle's share is a key's strokes over the row's most struck key (not the whole board's): accents
 * are rare next to `e` or the space, and the row is there to compare them with each other. Its
 * accessible name keeps the map's sentence: strokes over every stroke on file, and errors.
 */
export function accentsRowOf(
  byChar: Readonly<Record<string, CharCount>>,
  chars: readonly string[],
): KeyboardMapKey[] {
  const hitsOf = (char: string) => Math.max(0, byChar[char]?.hits ?? 0);
  const total = Object.values(byChar).reduce((sum, c) => sum + Math.max(0, c.hits), 0);
  const most = chars.reduce((max, char) => Math.max(max, hitsOf(char)), 0);
  return chars.map((char) => {
    const hits = hitsOf(char);
    const typed = hits > 0;
    return {
      char,
      cap: capOf(char),
      typed,
      share: typed ? hits / most : 0,
      ofStrokes: typed ? hits / total : 0,
      errorRate: typed ? Math.min(1, Math.max(0, byChar[char]!.errors) / hits) : null,
    };
  });
}
