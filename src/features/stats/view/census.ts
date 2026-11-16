/**
 * The typist census (#966, ADR 0023): where a typist stands among all typists, as aggregates only.
 *
 * `censusOf` is the one function whose result may leave the stats module about other typists. It
 * takes every typist reduced to four numbers and returns smoothed shapes (bar heights relative to the
 * tallest bar, cumulative shares of the population) plus the viewer's own figures and percentile. It
 * never returns a head count, an id, a name or another typist's figure:
 * - nothing shows under `CENSUS_MIN_POPULATION` typists (`null`);
 * - each typist is spread by a fixed Gaussian kernel (`CENSUS_KERNEL`), so no bar stands for one
 *   person, and a value outside the scale sits on its end;
 * - shapes are fractions rounded to `SHAPE_DECIMALS`, and the same shape at any population size gives
 *   the same output, so the population size cannot be read back.
 * Pure and deterministic: no clock, no randomness, order of the typists irrelevant (up to rounding).
 */

/** No census under this many typists (owner decision 2026-11-16). */
export const CENSUS_MIN_POPULATION = 30;
/** A typist is a user with at least this many counted results; under it the viewer has no place. */
export const CENSUS_MIN_RACES = 3;
/** Bars (and cumulative values) per distribution. */
export const CENSUS_BARS = 60;
/** The scales: speed in clean WPM (ADR 0016), accuracy in percent. */
export const CENSUS_SCALES = {
  speed: { min: 0, max: 150 },
  accuracy: { min: 80, max: 100 },
} as const;
/** The smoothing kernel's standard deviation, in the scale's unit (WPM, accuracy point). */
export const CENSUS_KERNEL = { speed: 4, accuracy: 0.8 } as const;

/** Decimals kept on bar heights and cumulative shares: enough to draw, too few to deconvolve. */
const SHAPE_DECIMALS = 3;

/** One typist reduced to four numbers: clean WPM, accuracy as stored (a fraction from 0 to 1). */
export type CensusTypist = {
  averageWpm: number;
  bestWpm: number;
  averageAccuracy: number;
  bestAccuracy: number;
};

/** The viewer's own figures and how many counted results they have. */
export type CensusViewer = (CensusTypist & { races: number }) | null;

/** One smoothed distribution. `value`, `position` and `percentile` are the viewer's, or `null`. */
export type CensusDistribution = {
  /** The scale's ends, in WPM or accuracy percent. */
  min: number;
  max: number;
  /** `CENSUS_BARS` heights from 0 to 1, the tallest 1. */
  bars: number[];
  /** `CENSUS_BARS` shares of the population under each bar's right edge, rising, 0 to 1. */
  cumulative: number[];
  /** The viewer's own figure (WPM or percent, one decimal). */
  value: number | null;
  /** The viewer's figure on the scale, 0 to 1. */
  position: number | null;
  /** Share of the smoothed population strictly under the viewer, percent, one decimal, below 100. */
  percentile: number | null;
};

export type Census = {
  averageSpeed: CensusDistribution;
  bestSpeed: CensusDistribution;
  averageAccuracy: CensusDistribution;
  bestAccuracy: CensusDistribution;
};

type Kind = keyof Census;
type Measure = { field: keyof CensusTypist; scale: "speed" | "accuracy"; factor: number };

const MEASURES: Record<Kind, Measure> = {
  averageSpeed: { field: "averageWpm", scale: "speed", factor: 1 },
  bestSpeed: { field: "bestWpm", scale: "speed", factor: 1 },
  averageAccuracy: { field: "averageAccuracy", scale: "accuracy", factor: 100 },
  bestAccuracy: { field: "bestAccuracy", scale: "accuracy", factor: 100 },
};

/** The standard normal CDF (Abramowitz and Stegun 7.1.26, error under 1.5e-7). */
function phi(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round = (v: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};

/** Mean share of the smoothed population under `x` (each typist a Gaussian on its clamped value). */
function shareUnder(points: readonly number[], x: number, sigma: number): number {
  let sum = 0;
  for (const p of points) sum += phi((x - p) / sigma);
  return sum / points.length;
}

function distribution(
  typists: readonly CensusTypist[],
  viewer: CensusViewer,
  { field, scale, factor }: Measure,
): CensusDistribution {
  const { min, max } = CENSUS_SCALES[scale];
  const sigma = CENSUS_KERNEL[scale];
  const width = (max - min) / CENSUS_BARS;
  const points = typists.map((t) => clamp(t[field] * factor, min, max));

  const edges = Array.from({ length: CENSUS_BARS + 1 }, (_, i) => min + i * width);
  const under = edges.map((e) => shareUnder(points, e, sigma));
  const mass = under.slice(1).map((u, i) => u - under[i]!);
  const tallest = Math.max(...mass);
  const bars = mass.map((m) => round(m / tallest, SHAPE_DECIMALS));
  const cumulative = under.slice(1).map((u) => round(u, SHAPE_DECIMALS));

  if (!viewer || viewer.races < CENSUS_MIN_RACES) {
    return { min, max, bars, cumulative, value: null, position: null, percentile: null };
  }
  const own = viewer[field] * factor;
  const onScale = clamp(own, min, max);
  // Floored to one decimal, so a share under 1 never reads 100 (the viewer counts at their own value).
  const percentile = Math.floor(shareUnder(points, onScale, sigma) * 1000 + 1e-9) / 10;
  return {
    min,
    max,
    bars,
    cumulative,
    value: round(own, 1),
    position: (onScale - min) / (max - min),
    percentile: Math.min(percentile, 99.9),
  };
}

/**
 * The census of `typists` (each with at least `CENSUS_MIN_RACES` counted results) seen by `viewer`:
 * `null` under `CENSUS_MIN_POPULATION` typists, otherwise the four distributions.
 */
export function censusOf(typists: readonly CensusTypist[], viewer: CensusViewer): Census | null {
  if (typists.length < CENSUS_MIN_POPULATION) return null;
  return {
    averageSpeed: distribution(typists, viewer, MEASURES.averageSpeed),
    bestSpeed: distribution(typists, viewer, MEASURES.bestSpeed),
    averageAccuracy: distribution(typists, viewer, MEASURES.averageAccuracy),
    bestAccuracy: distribution(typists, viewer, MEASURES.bestAccuracy),
  };
}
