import type { KeyFile, KeyFileEntry } from "./key-file";
import { dotsPath, linePath, movingAverage, type Scale, yAt } from "./performance-curve";

/**
 * The key sheet of the Personnel file (#963, bible 14.3, reference `Profil.dc.html` section
 * `INTERROGATOIRE INDIVIDUEL`, its `keyChips`, `keyStats` and `keyChart`): pure display geometry over one
 * `KeyFileEntry` of #961. The paths come from `performance-curve` (the output curve's own helpers, #933);
 * only the fixed scale is the sheet's.
 *
 * Extension point: `keySheetPlot` takes an entry and a smoothing width, so sharing the output curve's
 * `LISSAGE` slider later is one more argument from the caller.
 */

/** The plot's fixed scale: `60 45 30 15 0` WPM, top to bottom (the reference's `yK`). */
export const KEY_SCALE: Scale = { ticks: [60, 45, 30, 15, 0], low: 0, high: 60 };
/** Width of the centred moving average: the output curve slider's start value, fixed here. */
export const KEY_SMOOTHING = 3;

export type KeySheetPlot = {
  /** Round dots, one per day with a value. */
  dots: string;
  /** The smoothed line; empty under two consecutive values. */
  line: string;
  /** The dashed goal line across the plot. */
  goal: string;
};

/** A speed on the plot: over the top tick it sits on the top edge. */
const onScale = (v: number | null) => (v === null ? null : Math.min(KEY_SCALE.high, v));

/** The plot of one key: its days as dots under the smoothed line (gaps lift the pen), and the goal. */
export function keySheetPlot(
  entry: Pick<KeyFileEntry, "series">,
  goal: number,
  k = KEY_SMOOTHING,
): KeySheetPlot {
  const smooth = movingAverage(entry.series, k);
  const line = linePath(smooth.map(onScale), KEY_SCALE);
  return {
    dots: dotsPath(entry.series.map(onScale), KEY_SCALE),
    line: line.includes("L") ? line : "",
    goal: `M0 ${yAt(goal, KEY_SCALE).toFixed(1)}H1000`,
  };
}

/** First and latest day values and the number of days with one (the plot's sentence). */
export function keySpan(entry: Pick<KeyFileEntry, "series">): {
  from: number | null;
  to: number | null;
  count: number;
} {
  const present = entry.series.filter((v): v is number => v !== null);
  return { from: present[0] ?? null, to: present.at(-1) ?? null, count: present.length };
}

/**
 * The key the server render selects: `KeyFile.mostTyped` when it has a speed, else the first key that
 * has one; `null` when no key does (the section is then absent).
 */
export function initialKey(keyFile: Pick<KeyFile, "keys" | "mostTyped">): string | null {
  const most = keyFile.keys.find((k) => k.char === keyFile.mostTyped);
  if (most && most.state !== "none") return most.char;
  return keyFile.keys.find((k) => k.state !== "none")?.char ?? null;
}
