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
export function seriesSummary(series: RaceSeries): { peak: number; final: number; bonuses: number } {
  const wpms = series.points.map((p) => p.wpm);
  return {
    peak: wpms.length ? Math.max(...wpms) : 0,
    final: wpms.at(-1) ?? 0,
    bonuses: series.marks.length,
  };
}
