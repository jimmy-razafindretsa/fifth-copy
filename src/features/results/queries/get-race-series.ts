import "server-only";
import { z } from "zod";
import {
  baseLengthOf,
  EMPTY_OVERLAY,
  keyErrors,
  normalizeTypeable,
  wpmSeries,
} from "@fifth-copy/engine";
import { textOverlaySchema } from "@fifth-copy/protocol";
import type { db as appDb } from "@/server/db";
import { storedEffectiveText } from "../replay-text";
import { decodeKeystrokes } from "../trace-codec";
import { missedKeys, type MissedKey } from "../view/keys";
import { parseBonusLog } from "../view/personal";
import { receivedMarks, type RaceSeries } from "../view/series";

/** Who is looking: only the id matters (ADR 0009). */
type SeriesViewer = { id: string } | null;

type Db = Pick<typeof appDb, "race">;

const raceIdSchema = z.uuid();

/** The engine's subset of the stored `Race.settings` (the wire's `engineSettingsOf`). */
const engineSettingsSchema = z.object({
  errorMode: z.enum(["continue", "block"]),
  backspace: z.boolean(),
});

/** What the personal card reads from the viewer's own trace (#865 graph, #867 keys and tip). */
export type PersonalReplay = {
  /** The WPM graph's data; `null` when the trace has no time (the graph reads NO TRACE ON FILE). */
  series: RaceSeries | null;
  /** Every key the viewer missed, most missed first (`missedKeys`); only counts leave the query. */
  missed: MissedKey[];
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
  const settings = engineSettingsSchema.safeParse(race.settings);
  const overlay = textOverlaySchema.nullable().safeParse(mine.overlay ?? null);
  const keystrokes = decodeKeystrokes(trace.data, trace.count);
  // an empty trace is no trace: the card reads NO TRACE ON FILE
  if (!settings.success || !overlay.success || !keystrokes || keystrokes.length === 0) return null;
  const text = storedEffectiveText({ textContent: race.textContent, overlay: overlay.data });
  const baseLength = baseLengthOf(
    normalizeTypeable(race.textContent),
    overlay.data ?? EMPTY_OVERLAY,
  );
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
    missed: missedKeys(keyErrors({ keystrokes, text, settings: settings.data })),
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
