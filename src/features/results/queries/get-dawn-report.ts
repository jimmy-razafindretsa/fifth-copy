import "server-only";
import { z } from "zod";
import type { db as appDb } from "@/server/db";
import type { DawnReport, ReportEntry } from "../view/dawn-report";

/** Who is looking: only the id matters (ADR 0009: the viewer's desk is the row whose `userId` is theirs). */
type ReportViewer = { id: string } | null;

type Db = Pick<typeof appDb, "race">;

const raceIdSchema = z.uuid();

/**
 * The Dawn report of one race (#300 C1, ADR 0008, ARCHITECTURE 8.2): `null` for an id that is not a uuid
 * or names no race, `filing` while the race has no `RaceResult` row yet (the race server posts them after
 * `ended`, ARCHITECTURE 9.3), else the race and every desk in place order with the viewer's desk. One
 * query; the WPM is `cleanWpm` (ADR 0016), `adjustedWpm` is never read. Suspicious rows are kept and
 * flagged: the podium shows them under review (ARCHITECTURE 7.7).
 */
export async function getDawnReport(
  raceId: string,
  viewer: ReportViewer,
  { db }: { db?: Db } = {},
): Promise<DawnReport | null> {
  const parsed = raceIdSchema.safeParse(raceId);
  if (!parsed.success) return null;
  const client = db ?? (await import("@/server/db")).db;
  const race = await client.race.findUnique({
    where: { id: parsed.data },
    select: {
      id: true,
      textLanguage: true,
      endedAt: true,
      endReason: true,
      lobby: { select: { code: true } },
      results: {
        orderBy: [{ place: "asc" }, { desk: "asc" }],
        select: {
          desk: true,
          userId: true,
          name: true,
          isBot: true,
          place: true,
          status: true,
          cleanWpm: true,
          accuracy: true,
          progress: true,
          finishedAtMs: true,
          suspicious: true,
        },
      },
    },
  });
  if (!race) return null;
  const lobbyCode = race.lobby?.code ?? null;
  if (race.results.length === 0) return { kind: "filing", raceId: race.id, lobbyCode };

  const entries: ReportEntry[] = race.results.map((r) => ({
    desk: r.desk,
    name: r.name,
    isBot: r.isBot,
    place: r.place,
    status: r.status,
    wpm: r.cleanWpm,
    accuracy: r.accuracy,
    progress: r.progress,
    finishedAtMs: r.finishedAtMs,
    suspicious: r.suspicious,
  }));
  const mine = viewer ? race.results.find((r) => r.userId === viewer.id) : undefined;
  return {
    kind: "report",
    race: {
      id: race.id,
      language: race.textLanguage === "FR" ? "fr" : "en",
      endedAt: race.endedAt,
      endReason: race.endReason,
      lobbyCode,
    },
    entries,
    viewerDesk: mine?.desk ?? null,
  };
}
