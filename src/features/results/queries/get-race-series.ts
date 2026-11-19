import "server-only";
import { z } from "zod";
import {
  baseLengthOf,
  EMPTY_OVERLAY,
  keyErrors,
  normalizeTypeable,
  wpmSeries,
  type KeyTally,
} from "@fifth-copy/engine";
import { textOverlaySchema } from "@fifth-copy/protocol";
import type { db as appDb } from "@/server/db";
import { storedEffectiveText } from "../replay-text";
import { storedEngineSettingsSchema } from "../stored-replay";
import { decodeKeystrokes } from "../trace-codec";
import { missedKeys, type MissedKey } from "../view/keys";
import { parseBonusLog } from "../view/personal";
import { storedSeriesSchema } from "../filed-series";
import { receivedMarks, type RaceLine, type RaceSeries } from "../view/series";

/** Who is looking: only the id matters (ADR 0009). */
type SeriesViewer = { id: string } | null;

type Db = Pick<typeof appDb, "race">;

const raceIdSchema = z.uuid();

/** What the personal card reads from the viewer's own trace (#865 graph, #867 keys and tip). */
export type PersonalReplay = {
  /** The WPM graph's data; `null` when the trace has no time (the graph reads NO TRACE ON FILE). */
  series: RaceSeries | null;
  /** Every key the viewer missed, most missed first (`missedKeys`); only counts leave the query. */
  missed: MissedKey[];
  /**
   * Every key the text asked for, its presses and errors (the engine's `keyErrors`, #999 C54): the
   * report's keyboard heatmap reads it. Counts only, the viewer's own.
   */
  keys: KeyTally[];
};

/**
 * The viewer's own replay of a race (#865 C2, #867 C3, spec 11.3, ADR 0007, 0008, 0016): their stored
 * trace (`RaceKeystrokes`, both rows filtered on the viewer's id, so no other user's trace is ever read)
 * replayed by the engine on `storedEffectiveText` (the base plus their overlay). The WPM series
 * (`wpmSeries`, base characters only: clean WPM, up to their scored `durationMs`) with the bonuses they
 * received from their `bonusLog`, and the keys they missed (`keyErrors`). `null` for a visitor, a
 * spectator, a bot desk, a purged or missing trace (the 30-day purge), an empty trace, and a stored row
 * the codec or the schemas reject.
 */
export async function getPersonalReplay(
  raceId: string,
  viewer: SeriesViewer,
  { db }: { db?: Db } = {},
): Promise<PersonalReplay | null> {
  if (!viewer) return null;
  const parsed = raceIdSchema.safeParse(raceId);
  if (!parsed.success) return null;
  const client = db ?? (await import("@/server/db")).db;
  const race = await client.race.findUnique({
    where: { id: parsed.data },
    select: {
      textContent: true,
      settings: true,
      endReason: true,
      results: {
        where: { userId: viewer.id },
        select: { desk: true, durationMs: true, overlay: true, bonusLog: true },
        take: 1,
      },
      keystrokes: {
        where: { userId: viewer.id },
        select: { desk: true, data: true, count: true },
      },
    },
  });
  if (!race || race.endReason === "VOID") return null;
  const mine = race.results[0];
  const trace = mine && race.keystrokes.find((k) => k.desk === mine.desk);
  if (!mine || !trace) return null;
  const settings = storedEngineSettingsSchema.safeParse(race.settings);
  const overlay = textOverlaySchema.nullable().safeParse(mine.overlay ?? null);
  const keystrokes = decodeKeystrokes(trace.data, trace.count);
  // an empty trace is no trace: the card reads NO TRACE ON FILE
  if (!settings.success || !overlay.success || !keystrokes || keystrokes.length === 0) return null;
  const text = storedEffectiveText({ textContent: race.textContent, overlay: overlay.data });
  const baseLength = baseLengthOf(
    normalizeTypeable(race.textContent),
    overlay.data ?? EMPTY_OVERLAY,
  );
  const keys = keyErrors({ keystrokes, text, settings: settings.data });
  const points = wpmSeries({
    keystrokes,
    text,
    settings: settings.data,
    baseLength,
    endMs: mine.durationMs,
  });
  return {
    series:
      points.length === 0
        ? null
        : {
            points,
            marks: receivedMarks(mine.desk, parseBonusLog(mine.bonusLog)),
            endMs: mine.durationMs,
          },
    missed: missedKeys(keys),
    keys,
  };
}

/** The viewer's WPM through a race (#865 C2): the series of `getPersonalReplay`, `null` without one. */
export async function getRaceSeries(
  raceId: string,
  viewer: SeriesViewer,
  deps: { db?: Db } = {},
): Promise<RaceSeries | null> {
  return (await getPersonalReplay(raceId, viewer, deps))?.series ?? null;
}

/**
 * Every other desk's line of one race (#999 C51, ADR 0027), for the decided audience only: a viewer with
 * a `RaceResult` in the race (a participant) or the race's host (its lobby's host, also when watching).
 * The audience is checked first, by a query that reads no series; a visitor, a spectator, a link holder
 * and anyone else get `[]` and nothing else is read. Then only the stored `RaceResult.wpmSeries` columns
 * of unflagged rows are read (never a `RaceKeystrokes` row of anyone): the viewer's own desk is left out
 * (their card replays their own trace, `getPersonalReplay`), a flagged row is never read, a row with no
 * stored series (purged after 30 days, filed before #999, no trace) or one the schema rejects has no line,
 * and a bot is a flat line at its clean WPM. Place order. Fails closed: no viewer, a bad id, no race, a
 * voided race, a race with no lobby and a viewer outside the audience all get `[]`.
 */
export async function getRaceSeriesForAll(
  raceId: string,
  viewer: SeriesViewer,
  { db }: { db?: Db } = {},
): Promise<RaceLine[]> {
  if (!viewer) return [];
  const parsed = raceIdSchema.safeParse(raceId);
  if (!parsed.success) return [];
  const client = db ?? (await import("@/server/db")).db;
  const gate = await client.race.findUnique({
    where: { id: parsed.data },
    select: {
      endReason: true,
      lobby: { select: { hostUserId: true } },
      results: { where: { userId: viewer.id }, select: { desk: true }, take: 1 },
    },
  });
  if (!gate || gate.endReason === "VOID") return [];
  const mine = gate.results[0]?.desk ?? null;
  const hosts = !!gate.lobby && gate.lobby.hostUserId === viewer.id;
  if (mine === null && !hosts) return [];

  const race = await client.race.findUnique({
    where: { id: parsed.data },
    select: {
      results: {
        where: { suspicious: false, ...(mine === null ? {} : { desk: { not: mine } }) },
        orderBy: [{ place: "asc" }, { desk: "asc" }],
        select: {
          desk: true,
          name: true,
          isBot: true,
          place: true,
          cleanWpm: true,
          durationMs: true,
          wpmSeries: true,
        },
      },
    },
  });
  if (!race) return [];
  return race.results.flatMap((r): RaceLine[] => {
    const base = {
      desk: r.desk,
      name: r.name,
      place: r.place,
      isBot: r.isBot,
      wpm: r.cleanWpm,
      endMs: r.durationMs,
    };
    if (r.isBot) {
      return [
        {
          ...base,
          points: [
            { t: 0, wpm: r.cleanWpm },
            { t: r.durationMs, wpm: r.cleanWpm },
          ],
        },
      ];
    }
    const points = storedSeriesSchema.safeParse(r.wpmSeries);
    if (!points.success) return [];
    return [{ ...base, points: points.data.map(([t, wpm]) => ({ t, wpm })) }];
  });
}
