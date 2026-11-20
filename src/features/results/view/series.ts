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
 * Another desk's line on the graph (#999 C51, C52, ADR 0027): read from its stored `RaceResult.wpmSeries`
 * (clean WPM, at most `MAX_SERIES_POINTS`), never from its trace; a bot's is flat at its clean WPM from
 * GO to its race time (`isBot`: labelled simulated). Only the race's participants and host get any.
 */
export type RaceLine = {
  desk: number;
  name: string;
  place: number;
  isBot: boolean;
  /** The ranking's clean WPM (`RaceResult.cleanWpm`). */
  wpm: number;
  /** The race time the line spans (`RaceResult.durationMs`). */
  endMs: number;
  points: WpmPoint[];
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
const round3 = (n: number) => Math.round(n * 1000) / 1000;

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

/** The id of the viewer's own line on a graph with other lines. */
export const YOU_LINE = "you";

/** One line of the graph with other lines: its polyline and where its end marker sits (0..1 of the plot). */
export type PlotLine = {
  /** `YOU_LINE`, or the desk number as a string. */
  id: string;
  line: string;
  end: { x: number; y: number };
};

export type RacePlot = {
  yMax: number;
  /** The time axis' end: the longest line's race time. */
  endMs: number;
  /** The viewer's received bonuses, on the shared time axis (none without a line of their own). */
  marks: GraphMark[];
  /** The viewer's line first (when they have one), then `others` in their order. */
  lines: PlotLine[];
};

/**
 * Where every line sits on one graph (#999 C52): one WPM scale (the highest point of any line rounded up
 * to a ten, at least 10) and one time axis (the longest race time), so lines compare. A typist's line
 * starts at GO with 0 WPM, as the viewer's does; a bot's is drawn as stored (flat from GO). Pure.
 */
export function plotOf(series: RaceSeries | null, others: readonly RaceLine[]): RacePlot {
  const wpms = [...(series?.points ?? []), ...others.flatMap((l) => l.points)].map((p) => p.wpm);
  const yMax = Math.max(10, Math.ceil(Math.max(0, ...wpms) / 10) * 10);
  const ends = [
    ...(series ? [series.endMs > 0 ? series.endMs : (series.points.at(-1)?.t ?? 0)] : []),
    ...others.map((l) => (l.endMs > 0 ? l.endMs : (l.points.at(-1)?.t ?? 0))),
  ];
  const endMs = Math.max(1, ...ends);
  const xOf = (t: number) => Math.min(1, Math.max(0, t / endMs));
  const yOf = (wpm: number) => Math.min(1, Math.max(0, 1 - wpm / yMax));
  const draw = (id: string, points: readonly WpmPoint[], fromGo: boolean): PlotLine => {
    const all = fromGo ? [{ t: 0, wpm: 0 }, ...points] : [...points];
    const last = all.at(-1) ?? { t: 0, wpm: 0 };
    return {
      id,
      line: all.map((p) => `${round(xOf(p.t) * PLOT_W)},${round(yOf(p.wpm) * PLOT_H)}`).join(" "),
      end: { x: round3(xOf(last.t)), y: round3(yOf(last.wpm)) },
    };
  };
  const lines = [
    ...(series ? [draw(YOU_LINE, series.points, true)] : []),
    ...others.map((l) => draw(String(l.desk), l.points, !l.isBot)),
  ];
  const marks = (series?.marks ?? []).map((m, lane) => ({ ...m, x: xOf(m.t), lane }));
  return { yMax, endMs, marks, lines };
}

/**
 * The lines drawn first (#999 C52): the viewer's own, the winner's and the last place's (`lastPlace`, the
 * ranking's), when they have one; with none of these, the first line. Ids as `PlotLine.id`.
 */
export function defaultLines(
  hasOwn: boolean,
  others: readonly RaceLine[],
  lastPlace: number,
): string[] {
  const ids = [
    ...(hasOwn ? [YOU_LINE] : []),
    ...others.filter((l) => l.place === 1 || l.place === lastPlace).map((l) => String(l.desk)),
  ];
  if (ids.length > 0) return ids;
  return others[0] ? [String(others[0].desk)] : [];
}

/** The toggle's next set: `id` added (checked) or removed, in the lines' order (`order`). */
export function toggleLine(
  shown: readonly string[],
  id: string,
  checked: boolean,
  order: readonly string[],
): string[] {
  const next = new Set(shown);
  if (checked) next.add(id);
  else next.delete(id);
  return order.filter((o) => next.has(o));
}

/** Whether other lines are worth a graph: at least one typist's (bots alone compare with nothing). */
export function hasTypistLine(others: readonly RaceLine[]): boolean {
  return others.some((l) => !l.isBot);
}
