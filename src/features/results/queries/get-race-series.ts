import "server-only";
import { z } from "zod";
import { baseLengthOf, EMPTY_OVERLAY, normalizeTypeable, wpmSeries } from "@fifth-copy/engine";
import { textOverlaySchema } from "@fifth-copy/protocol";
import type { db as appDb } from "@/server/db";
import { storedEffectiveText } from "../replay-text";
import { decodeKeystrokes } from "../trace-codec";
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

/**
 * The viewer's WPM through a race (#865 C2, spec 11.3, ADR 0007, 0008, 0016): their own stored trace
 * (`RaceKeystrokes`, both rows filtered on the viewer's id, so no other user's trace is ever read)
 * replayed by the engine's `wpmSeries` on `storedEffectiveText` (the base plus their overlay), counting
 * base characters only (clean WPM), up to their scored `durationMs`; and the bonuses they received
 * from their `bonusLog`. `null` for a visitor, a spectator, a bot desk, a purged or missing trace (the
 * 30-day purge), an empty trace, and a stored row the codec or the schemas reject.
 */
export async function getRaceSeries(
  raceId: string,
  viewer: SeriesViewer,
  { db }: { db?: Db } = {},
): Promise<RaceSeries | null> {
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
  if (!settings.success || !overlay.success || !keystrokes) return null;
  const text = storedEffectiveText({ textContent: race.textContent, overlay: overlay.data });
  const baseLength = baseLengthOf(normalizeTypeable(race.textContent), overlay.data ?? EMPTY_OVERLAY);
  const points = wpmSeries({
    keystrokes,
    text,
    settings: settings.data,
    baseLength,
    endMs: mine.durationMs,
  });
  // an empty trace draws nothing: the card reads NO TRACE ON FILE
  if (points.length === 0) return null;
  return {
    points,
    marks: receivedMarks(mine.desk, parseBonusLog(mine.bonusLog)),
    endMs: mine.durationMs,
  };
}
