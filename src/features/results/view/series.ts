/**
 * The personal card's WPM graph (#865, spec 11.3, R141): the viewer's clean WPM through the race
 * (`wpmSeries` of @fifth-copy/engine, ADR 0007) and a mark at each bonus that hit them. Plain data,
 * no Prisma type: the query builds it, the graph and the /design specimens read it.
 */
import type { WpmPoint } from "@fifth-copy/engine";
import type { BonusKind, StoredBonusEntry } from "./personal";

/** A received bonus on the time axis (`t` ms since GO). */
export type BonusMark = { t: number; kind: BonusKind };

export type RaceSeries = {
  /** At most `MAX_SERIES_POINTS`, in time order; the last is the scored clean WPM. */
  points: WpmPoint[];
  marks: BonusMark[];
  /** The race time the graph spans (`RaceResult.durationMs`). */
  endMs: number;
};

/**
 * The hits `desk` received, in time order: entries whose `to` is the desk from another desk (the
 * card's `RECEIVED` row counts the same ones, `tallyBonuses`; an exemption on oneself is sent).
 */
export function receivedMarks(desk: number, log: readonly StoredBonusEntry[]): BonusMark[] {
  return log
    .filter((e) => e.to === desk && e.from !== desk)
    .map(({ t, kind }) => ({ t, kind }))
    .sort((a, b) => a.t - b.t);
}

/** The figures the graph's accessible name states: peak and final WPM, bonuses received. */
export function seriesSummary(series: RaceSeries): {
  peak: number;
  final: number;
  bonuses: number;
} {
  const wpms = series.points.map((p) => p.wpm);
  return {
    peak: wpms.length ? Math.max(...wpms) : 0,
    final: wpms.at(-1) ?? 0,
    bonuses: series.marks.length,
  };
}

/** The graph's drawing box (SVG user units; the plot stretches it to the card's width). */
export const PLOT_W = 1000;
export const PLOT_H = 100;
/** A mark on the plot: `x` 0..1 along the race; its name prints on lane `lane` (one per mark). */
export type GraphMark = BonusMark & { x: number; lane: number };

export type GraphGeometry = {
  /** The WPM scale's top: the peak rounded up to a ten (at least 10). */
  yMax: number;
  /** The SVG `points` of the ink polyline, from GO at 0 WPM through every point. */
  line: string;
  marks: GraphMark[];
};

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Where everything sits (#865): x is time over `endMs`, y the WPM over the scale's top (0 at the
 * bottom). The line starts at GO with 0 WPM. Each bonus name has its own lane above the plot, in time
 * order, so two close hits never print over each other (a long French name spans half a phone card).
 */
export function graphGeometry(series: RaceSeries): GraphGeometry {
  const { peak } = seriesSummary(series);
  const yMax = Math.max(10, Math.ceil(peak / 10) * 10);
  const end = series.endMs > 0 ? series.endMs : (series.points.at(-1)?.t ?? 1);
  const xOf = (t: number) => Math.min(1, Math.max(0, t / end));
  const line = [{ t: 0, wpm: 0 }, ...series.points]
    .map((p) => `${round(xOf(p.t) * PLOT_W)},${round(PLOT_H - (p.wpm / yMax) * PLOT_H)}`)
    .join(" ");
  const marks = series.marks.map((m, lane) => ({ ...m, x: xOf(m.t), lane }));
  return { yMax, line, marks };
}

/** A race time as `m:ss` (the graph's time axis). */
export function formatRaceTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
