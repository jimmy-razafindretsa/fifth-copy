import type { Locale } from "@/i18n/locale";
import { NBSP, oneDecimal } from "./profile-figures";

/**
 * The output curve of the Personnel file (#933, bible 14.3, reference `Profil.dc.html` section
 * `COURBE DE RENDEMENT`): pure display geometry over the latest counted races. It ports the reference's
 * own helpers (`ma`, `slope`, `line`, `dots`, `X`) and adds the two scales. No arithmetic on the stored
 * figures beyond averaging them for show (ADR 0016: speeds are clean WPM as `Profile.progress` holds them).
 *
 * Extension point: every function takes a `number | null` series, so a key's graph (#324) reuses the
 * moving average, the trend and the paths with its own scale.
 */

/** The curve draws at most this many of the latest counted races. */
export const CURVE_RACES = 40;
/** The curve is shown from this many counted races (under it the blank block of #932 stands in). */
export const CURVE_MIN_RACES = 3;
/** No trend line under this many points (the reference's `slope`). */
export const TREND_MIN_POINTS = 6;
/** The `LISSAGE` slider: width `k` of the centred moving average. */
export const SMOOTHING = { min: 0, max: 8, initial: 3 } as const;

/** The plot's viewBox and inner box: x from 20 to 980, values from y 280 (lowest tick) to y 20 (highest). */
export const PLOT = { width: 1000, height: 300, left: 20, right: 980, top: 20, bottom: 280 } as const;
/** The four dashed grid lines. */
export const GRID_LINES = [20, 85, 150, 215] as const;

/** Accuracy scales: the highest of these floors at or under the lowest accuracy shown, up to 100. */
const ACCURACY_FLOORS = [90, 80, 60, 0] as const;
/** Speed tick steps tried first, so the scale reads in round numbers (`24 30 36 42 48`). */
const NICE_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 75, 100] as const;

type Series = readonly (number | null)[];

/** Five evenly spaced values, highest first (the order the tick columns read, top to bottom). */
export type Scale = { ticks: number[]; low: number; high: number };

/**
 * Centred moving average of width `k`: each point becomes the mean of the points from `i − k` to
 * `i + k` that exist; `k = 0` returns the points. A missing point stays missing.
 */
export function movingAverage(values: Series, k: number): (number | null)[] {
  return values.map((v, i) => {
    if (v === null) return null;
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(values.length - 1, i + k); j += 1) {
      const w = values[j];
      if (w !== null && w !== undefined) {
        sum += w;
        n += 1;
      }
    }
    return sum / n;
  });
}

/** Least-squares line `value = intercept + slope · i` over the present points; none under 6 points. */
export function trendLine(values: Series): { slope: number; intercept: number } | null {
  const points = values.flatMap((v, i) => (v === null ? [] : [[i, v] as const]));
  const n = points.length;
  if (n < TREND_MIN_POINTS) return null;
  const mx = points.reduce((s, [x]) => s + x, 0) / n;
  const my = points.reduce((s, [, y]) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of points) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  const slope = num / den;
  return { slope, intercept: my - slope * mx };
}

const present = (values: Series) => values.filter((v): v is number => v !== null);

const five = (low: number, step: number): Scale => ({
  ticks: [4, 3, 2, 1, 0].map((j) => low + j * step),
  low,
  high: low + 4 * step,
});

/**
 * Speed scale: five whole-number ticks, evenly spaced, the lowest at or under the slowest race and the
 * highest at or above the fastest; the smallest round step that fits, else the smallest whole step.
 */
export function speedScale(values: Series): Scale {
  const shown = present(values);
  const min = Math.max(0, Math.min(...shown));
  const max = Math.max(...shown);
  const fits = (step: number) => Math.floor(min / step) * step + 4 * step >= max;
  let step: number = NICE_STEPS.find(fits) ?? 0;
  if (!step) {
    step = NICE_STEPS[NICE_STEPS.length - 1];
    while (!fits(step)) step += 1;
  }
  return five(Math.floor(min / step) * step, step);
}

/** Accuracy scale (percent): five ticks ending at 100, from the highest of 90, 80, 60 or 0 at or under the lowest. */
export function accuracyScale(values: Series): Scale {
  const min = Math.min(...present(values));
  const low = ACCURACY_FLOORS.find((floor) => floor <= min) ?? 0;
  return five(low, (100 - low) / 4);
}

/** x of point `i` of `n`: from 20 to 980 (a single point sits in the middle). */
export function xAt(i: number, n: number): number {
  return n <= 1 ? PLOT.width / 2 : PLOT.left + (i * (PLOT.right - PLOT.left)) / (n - 1);
}

/** y of a value on a scale: the lowest tick at 280, the highest at 20. */
export function yAt(value: number, scale: Scale): number {
  return PLOT.bottom - ((value - scale.low) / (scale.high - scale.low)) * (PLOT.bottom - PLOT.top);
}

const fixed = (n: number) => n.toFixed(1);

/** One path of round dots: a zero-length segment per present point (drawn with round caps). */
export function dotsPath(values: Series, scale: Scale): string {
  return values
    .map((v, i) => (v === null ? "" : `M${fixed(xAt(i, values.length))} ${fixed(yAt(v, scale))}h0`))
    .join("");
}

/** One polyline through the present points; a missing point lifts the pen. */
export function linePath(values: Series, scale: Scale): string {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${fixed(xAt(i, values.length))} ${fixed(yAt(v, scale))}`;
    pen = true;
  });
  return d;
}

export type TrendDirection = "up" | "down" | "flat";

export type CurveSeries = {
  scale: Scale;
  dots: string;
  line: string;
  /** First and latest smoothed values (the accessible name). */
  first: number;
  last: number;
  /** The latest point of the smoothed line, in viewBox units, for its unit label. */
  end: { x: number; y: number };
};

export type Curve = {
  /** Races drawn. */
  count: number;
  speed: CurveSeries;
  /** In percent (0..100). */
  accuracy: CurveSeries;
  /** The speed trend as a 2-point path, null under 6 races. */
  trend: { path: string; direction: TrendDirection } | null;
};

/** A point of the curve: what `Profile.progress.series` carries (accuracy 0..1). */
export type CurvePoint = { cleanWpm: number; accuracy: number };

function series(values: number[], k: number, scale: Scale): CurveSeries {
  const smooth = movingAverage(values, k) as number[];
  const lastIndex = values.length - 1;
  return {
    scale,
    dots: dotsPath(values, scale),
    line: linePath(smooth, scale),
    first: smooth[0],
    last: smooth[lastIndex],
    end: { x: xAt(lastIndex, values.length), y: yAt(smooth[lastIndex], scale) },
  };
}

/**
 * The curve of the latest `CURVE_RACES` points (oldest first, as the series holds them) at smoothing
 * width `k`. Null under `CURVE_MIN_RACES` points. The scales follow the raw points, so the slider never
 * moves them; the trend is the least-squares line of the raw speeds, so the slider never moves it either.
 */
export function performanceCurve(points: readonly CurvePoint[], k: number): Curve | null {
  const latest = points.slice(-CURVE_RACES);
  const n = latest.length;
  if (n < CURVE_MIN_RACES) return null;
  const width = Math.min(SMOOTHING.max, Math.max(SMOOTHING.min, Math.round(k)));
  const wpm = latest.map((p) => p.cleanWpm);
  const accuracy = latest.map((p) => p.accuracy * 100);
  const speedAxis = speedScale(wpm);
  const line = trendLine(wpm);
  let trend: Curve["trend"] = null;
  if (line) {
    const from = line.intercept;
    const to = line.intercept + line.slope * (n - 1);
    const change = to - from;
    trend = {
      path: `M${fixed(xAt(0, n))} ${fixed(yAt(from, speedAxis))}L${fixed(xAt(n - 1, n))} ${fixed(yAt(to, speedAxis))}`,
      direction: Math.abs(change) < 0.05 ? "flat" : change > 0 ? "up" : "down",
    };
  }
  return {
    count: n,
    speed: series(wpm, width, speedAxis),
    accuracy: series(accuracy, width, accuracyScale(accuracy)),
    trend,
  };
}

/** Speed tick labels: whole numbers. */
export function speedTickLabels(scale: Scale): string[] {
  return scale.ticks.map((t) => String(t));
}

/**
 * Accuracy tick labels in the locale (`97,5` / `97.5`), the top and bottom ones with the unit
 * (`100 %` / `100%`, a no-break space in French).
 */
export function accuracyTickLabels(scale: Scale, locale: Locale): string[] {
  const unit = locale === "fr" ? `${NBSP}%` : "%";
  const show = new Intl.NumberFormat(`${locale}-CA`, { maximumFractionDigits: 1 });
  return scale.ticks.map((t, i) =>
    i === 0 || i === scale.ticks.length - 1 ? `${show.format(t)}${unit}` : show.format(t),
  );
}

/** The figures of the accessible name, one decimal in the locale. */
export function curveSummary(curve: Curve, locale: Locale) {
  return {
    count: curve.count,
    speedFrom: oneDecimal(curve.speed.first, locale),
    speedTo: oneDecimal(curve.speed.last, locale),
    accuracyFrom: oneDecimal(curve.accuracy.first, locale),
    accuracyTo: oneDecimal(curve.accuracy.last, locale),
  };
}
