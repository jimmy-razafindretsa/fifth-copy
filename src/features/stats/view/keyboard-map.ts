import type { CharCount } from "./key-file";

/**
 * "Carte du clavier" (#324, bible 14.3, reference `Profil.dc.html` `PLAN DE LA MACHINE`): the key file's
 * `byChar` (#961) mapped onto one keyboard layout's four rows. Pure, no import of identity: the caller
 * hands in the layout's rows (identity's `numberRows` and `layouts`, the single layout module), so a new
 * layout is data there and nothing here.
 */

/** The four rows, back to front. */
export const KEYBOARD_ROWS = ["number", "top", "home", "bottom"] as const;
export type KeyboardRowId = (typeof KEYBOARD_ROWS)[number];

/** The pad that starts each row, in key units (the reference's `TAB`, `VERR.`, `MAJ`; none on the number row). */
export const ROW_PADS: Record<KeyboardRowId, number> = {
  number: 0,
  top: 1.5,
  home: 1.8,
  bottom: 1.3,
};

/** The board is this many key units wide (the reference's one fourteenth), or its widest row when wider. */
export const BOARD_UNITS = 14;

/** A circle spans `sqrt(share)` times this percent of its key (the most struck key: 140 %). */
export const CIRCLE_MAX = 140;

/** An error rate of this much or more fills the circle with its red core. */
export const CORE_FULL_RATE = 0.12;

/** One layout as the map reads it: the number row, then the three letter rows, unshifted, lower case. */
export type KeyboardLayoutKeys = {
  number: readonly string[];
  letters: readonly (readonly string[])[];
};

export type KeyboardMapKey = {
  /** The stored character (lower case, as `byChar` keys it). */
  char: string;
  /** The cap as printed: upper case. */
  cap: string;
  /** False when the key has no stroke in the file: newsprint ground, no circle. */
  typed: boolean;
  /** The key's hits over the most struck key's on this layout, 0..1. */
  share: number;
  /** The key's hits over all strokes made on this layout's keys, 0..1. */
  ofStrokes: number;
  /** `errors / hits`; `null` when untyped. */
  errorRate: number | null;
};

export type KeyboardMapRow = {
  id: KeyboardRowId;
  /** The row's pad in key units (0: none). */
  pad: number;
  keys: KeyboardMapKey[];
  /** The row's strokes over all strokes on this layout's keys, 0..1 (the four add up to 1, or are all 0). */
  share: number;
};

export type KeyboardMap = {
  rows: KeyboardMapRow[];
  /** One key unit as a percent of the board's width. */
  unit: number;
};

/** The cap of a stored character: upper case (`é` -> `É`, `²` stays). */
export const capOf = (char: string) => char.toLocaleUpperCase("fr");

/** The map of `byChar` on a layout (#324 C2). A character the layout has no key for counts nowhere. */
export function keyboardMapOf(
  byChar: Readonly<Record<string, CharCount>>,
  layout: KeyboardLayoutKeys,
): KeyboardMap {
  const lines = [layout.number, ...layout.letters].slice(0, KEYBOARD_ROWS.length);
  const hitsOf = (char: string) => Math.max(0, byChar[char]?.hits ?? 0);
  const all = lines.flat();
  const total = all.reduce((sum, char) => sum + hitsOf(char), 0);
  const most = all.reduce((max, char) => Math.max(max, hitsOf(char)), 0);

  const rows = KEYBOARD_ROWS.map((id, r): KeyboardMapRow => {
    const line = lines[r] ?? [];
    const keys = line.map((char): KeyboardMapKey => {
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
    const hits = line.reduce((sum, char) => sum + hitsOf(char), 0);
    return { id, pad: ROW_PADS[id], keys, share: total > 0 ? hits / total : 0 };
  });

  const widest = Math.max(BOARD_UNITS, ...rows.map((row) => row.pad + row.keys.length));
  return { rows, unit: 100 / widest };
}

/** The circle's diameter, in percent of its key: `sqrt(share) * 140`, whole (the reference's rounding). */
export const circleSize = (share: number) => Math.round(Math.sqrt(share) * CIRCLE_MAX);

/** The red core's diameter, in percent of its circle: `min(100, sqrt(errorRate / 0.12) * 100)`, whole. */
export const coreSize = (errorRate: number | null) =>
  errorRate === null ? 0 : Math.round(Math.min(100, Math.sqrt(errorRate / CORE_FULL_RATE) * 100));

/** A row's share as the reference prints it: rounded to a whole percent. */
export const rowPercent = (share: number) => Math.round(share * 100);
