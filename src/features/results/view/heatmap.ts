/**
 * The Dawn report's compact keyboard heatmap (#999 C54, spec 11.3, bible 14.3 "keyboard heatmap paper
 * -> gold -> red", 14.4 "Keyboard heatmap"): the viewer's own key tallies of this race (the engine's
 * `keyErrors`, ADR 0007) laid on one keyboard layout. Pure, no identity import: the caller hands in the
 * layout's rows (identity's `numberRows` and `layouts`, the single layout module). A key the race never
 * asked for is untyped (newsprint); a key typed without an error is paper; a missed key's heat runs from
 * gold (one error) to red (the most missed key of the race), `heat` = its errors over the most errors.
 */

/** The four rows, back to front (the Personnel file's keyboard map, #324). */
export const HEATMAP_ROWS = ["number", "top", "home", "bottom"] as const;
export type HeatmapRowId = (typeof HEATMAP_ROWS)[number];

/** The pad that starts each row, in key units (the keyboard map's `TAB`, `CAPS`, `SHIFT`). */
export const HEATMAP_PADS: Record<HeatmapRowId, number> = {
  number: 0,
  top: 1.5,
  home: 1.8,
  bottom: 1.3,
};

/** The board is this many key units wide, or its widest row when wider (as the keyboard map). */
export const HEATMAP_UNITS = 14;

/** One key's tally: the presses made while it was asked for and the errors still counted. */
export type KeyCount = { char: string; attempts: number; errors: number };

export type HeatState = "untyped" | "clean" | "missed";

export type HeatKey = {
  /** The key as the layout stores it (lower case; `" "` for the space bar). */
  char: string;
  /** The cap as printed: upper case. */
  cap: string;
  attempts: number;
  errors: number;
  state: HeatState;
  /** `errors` over the race's most missed key on this board, 0..1 (0 unless missed). */
  heat: number;
};

export type HeatRow = { id: HeatmapRowId; pad: number; keys: HeatKey[] };

export type Heatmap = {
  rows: HeatRow[];
  space: HeatKey;
  /** One key unit as a percent of the board's width. */
  unit: number;
  /** The missed keys on this board, most missed first (ties by character): the board's sentence. */
  missed: HeatKey[];
};

/** One layout as the heatmap reads it: the number row, then the three letter rows, lower case. */
export type HeatmapLayout = {
  number: readonly string[];
  letters: readonly (readonly string[])[];
};

const lower = (c: string) => c.toLocaleLowerCase("fr");

/**
 * `tallies` folded onto the layout: a capital counts on its key (`E` on `e`), the space on the bar; a
 * character the layout has no key for (a shifted symbol, another layout's accent) is left to the errors
 * list. Pure.
 */
export function heatmapOf(tallies: readonly KeyCount[], layout: HeatmapLayout): Heatmap {
  const counts = new Map<string, { attempts: number; errors: number }>();
  for (const t of tallies) {
    const key = lower(t.char);
    const c = counts.get(key) ?? { attempts: 0, errors: 0 };
    c.attempts += t.attempts;
    c.errors += Math.max(0, t.errors);
    counts.set(key, c);
  }
  const chars = [...layout.number, ...layout.letters.flat(), " "];
  const most = Math.max(0, ...chars.map((c) => counts.get(c)?.errors ?? 0));
  const keyOf = (char: string): HeatKey => {
    const { attempts, errors } = counts.get(char) ?? { attempts: 0, errors: 0 };
    const state: HeatState = errors > 0 ? "missed" : attempts > 0 ? "clean" : "untyped";
    return {
      char,
      cap: char.toLocaleUpperCase("fr"),
      attempts,
      errors,
      state,
      heat: state === "missed" && most > 0 ? errors / most : 0,
    };
  };
  const ids = HEATMAP_ROWS;
  const rowKeys = [layout.number, ...layout.letters];
  const rows: HeatRow[] = ids.map((id, i) => ({
    id,
    pad: HEATMAP_PADS[id],
    keys: (rowKeys[i] ?? []).map(keyOf),
  }));
  const widest = Math.max(HEATMAP_UNITS, ...rows.map((r) => r.pad + r.keys.length));
  const all = [...rows.flatMap((r) => r.keys), keyOf(" ")];
  const missed = all
    .filter((k) => k.state === "missed")
    .sort((a, b) => b.errors - a.errors || (a.char < b.char ? -1 : a.char > b.char ? 1 : 0));
  return { rows, space: all.at(-1)!, unit: 100 / widest, missed };
}
