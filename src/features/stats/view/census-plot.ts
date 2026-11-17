import type { Locale } from "@/i18n/locale";
import type { Census, CensusDistribution } from "./census";
import { NBSP, oneDecimal } from "./profile-figures";

/**
 * The census section's drawing (#967, bible 14.3 "Personnel file", `Profil.dc.html` `rel`): which of the
 * four distributions the two choices pick and the geometry the reference draws from it. Pure; reads only
 * what `censusOf` returned (ADR 0023: shapes, the viewer's own value, position and percentile), so the
 * page never shows a head count.
 *
 * Extension point: a fifth distribution is one more entry in `CENSUS_MODES` or `CENSUS_METRICS` (and its
 * `Census` key in `CENSUS_KEYS`).
 */

/** The tabs: the measure. `ticks` says where the unit goes (`150 MPM` on the last only, `%` on each). */
export const CENSUS_MODES = [
  { id: "speed", ticks: "last" },
  { id: "accuracy", ticks: "each" },
] as const;
/** The toggle: the viewer's figure the census compares. */
export const CENSUS_METRICS = [{ id: "average" }, { id: "best" }] as const;

export type CensusMode = (typeof CENSUS_MODES)[number]["id"];
export type CensusMetric = (typeof CENSUS_METRICS)[number]["id"];
export type CensusChoice = { mode: CensusMode; metric: CensusMetric };

/** The server render's choice (C1): speed, average. */
export const CENSUS_INITIAL: CensusChoice = { mode: "speed", metric: "average" };

/** The `Census` distribution each pair of choices draws. */
export const CENSUS_KEYS: Record<CensusMode, Record<CensusMetric, keyof Census>> = {
  speed: { average: "averageSpeed", best: "bestSpeed" },
  accuracy: { average: "averageAccuracy", best: "bestAccuracy" },
};

/** Ticks under the plot: the scale's ends and three steps between (`0 · 37,5 · 75 · 112,5 · 150`). */
const TICK_STEPS = 4;
/** Past this share of the width the `TOI` tag goes to the marker's left (the reference's 70 %). */
export const TAG_FLIP = 0.7;
/** The cumulative curve's box (the reference's `viewBox="0 0 600 100"`, stretched). */
export const CURVE_BOX = { width: 600, height: 100 } as const;

/** Whether the section shows (C6): a census over the floor and a viewer with a place in it. */
export function censusShown(census: Census | null | undefined): census is Census {
  return Boolean(census) && Object.values(census!).every((d) => d.percentile !== null);
}

export type CensusBar = {
  /** The bar's height, `0%` to `100%` of the plot. */
  height: string;
  /** Left of the viewer's position: a comrade beaten (ink); else ahead (muted). */
  beaten: boolean;
};

export type CensusPlot = {
  /** The percentile, one decimal in the locale, with its unit (`87,4 %`). */
  percentile: string;
  /** The viewer's own figure with its unit (`37,4 MPM`, `93,4 %`). */
  value: string;
  bars: CensusBar[];
  /** The cumulative share as one SVG path in `CURVE_BOX`. */
  curve: string;
  /** The marker's left edge, percent of the width (`36.13%`). */
  left: string;
  /** The tag sits left of the marker (past `TAG_FLIP`). */
  flip: boolean;
  ticks: string[];
};

const decimals = (n: number, locale: Locale) =>
  new Intl.NumberFormat(`${locale}-CA`, { maximumFractionDigits: 1 }).format(n);

/** The geometry and words of one distribution (`unit` is the catalog's `MPM` / `WPM` or `%`). */
export function censusPlot(
  distribution: CensusDistribution,
  mode: CensusMode,
  unit: string,
  locale: Locale,
): CensusPlot | null {
  const { min, max, bars, cumulative, value, position, percentile } = distribution;
  if (value === null || position === null || percentile === null) return null;
  const n = bars.length;
  const { width, height } = CURVE_BOX;
  const ticksWithUnit = CENSUS_MODES.find((m) => m.id === mode)!.ticks;
  return {
    percentile: `${oneDecimal(percentile, locale)}${NBSP}%`,
    value: `${oneDecimal(value, locale)}${NBSP}${unit}`,
    bars: bars.map((h, i) => ({
      height: `${(h * 100).toFixed(1)}%`,
      beaten: (i + 0.5) / n < position,
    })),
    curve: cumulative
      .map(
        (c, i) =>
          `${i ? "L" : "M"}${(((i + 1) / n) * width).toFixed(1)} ${(height - c * height).toFixed(1)}`,
      )
      .join(""),
    left: `${(position * 100).toFixed(2)}%`,
    flip: position > TAG_FLIP,
    ticks: Array.from({ length: TICK_STEPS + 1 }, (_, i) => {
      const tick = decimals(min + ((max - min) * i) / TICK_STEPS, locale);
      const last = i === TICK_STEPS;
      return ticksWithUnit === "each" || last ? `${tick}${NBSP}${unit}` : tick;
    }),
  };
}
