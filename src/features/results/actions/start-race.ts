// Called only by the HMAC-verified route `POST /api/internal/races`. `server-only`, and never a
// `"use server"` module: a server action would be callable from any browser without the HMAC.
import "server-only";
import { ENGINE_VERSION } from "@fifth-copy/engine";
import {
  PROTOCOL_VERSION,
  raceSettingsSchema,
  type RaceLanguage,
  type StartRaceRequest,
  type StartRaceResponse,
} from "@fifth-copy/protocol";
import { generateRaceText } from "@/features/texts";
import { Prisma, type RaceLanguage as DbRaceLanguage } from "@/generated/prisma/client";
import { db as appDb } from "@/server/db";

export type StartRaceResult =
  { ok: true; response: StartRaceResponse } | { ok: false; error: "not-found" | "conflict" };

type Db = Pick<typeof appDb, "race" | "lobby">;
type StoredRace = Awaited<ReturnType<typeof appDb.race.findUnique>> & {};

const TO_DB: Record<RaceLanguage, DbRaceLanguage> = { fr: "FR", en: "EN" };
const FROM_DB: Record<DbRaceLanguage, RaceLanguage> = { FR: "fr", EN: "en" };

function responseOf(race: StoredRace): StartRaceResponse {
  return {
    v: PROTOCOL_VERSION,
    raceId: race.id,
    text: {
      content: race.textContent,
      language: FROM_DB[race.textLanguage],
      wordCount: race.textWordCount,
      sourceRef: race.textSourceRef,
    },
    settings: raceSettingsSchema.parse(race.settings),
    startedAt: race.startedAt.getTime(),
  };
}

/** The stored race of `raceId` as a result: its own lobby's replay, or a conflict. */
function replay(race: StoredRace, lobbyId: string): StartRaceResult {
  return race.lobbyId === lobbyId
    ? { ok: true, response: responseOf(race) }
    : { ok: false, error: "conflict" };
}

/**
 * Starts a race durably (ADR 0006 point 6, ADR 0008): the only writer of `Race` at start. Checks the
 * lobby (missing or closed: `not-found`; another host: `conflict`), generates the text from the
 * validated settings and stores it with the settings, desk count and versions. Idempotent on
 * `raceId`: a repeated id answers the stored text unchanged, also under concurrent calls (P2002).
 */
export async function startRace(
  request: StartRaceRequest,
  { db = appDb, now = () => new Date() }: { db?: Db; now?: () => Date } = {},
): Promise<StartRaceResult> {
  const existing = await db.race.findUnique({ where: { id: request.raceId } });
  if (existing) return replay(existing, request.lobbyId);

  const lobby = await db.lobby.findUnique({
    where: { id: request.lobbyId },
    select: { status: true, hostUserId: true },
  });
  if (!lobby || lobby.status === "CLOSED") return { ok: false, error: "not-found" };
  if (lobby.hostUserId !== request.hostUserId) return { ok: false, error: "conflict" };

  const text = generateRaceText(request.settings);
  try {
    const race = await db.race.create({
      data: {
        id: request.raceId,
        lobbyId: request.lobbyId,
        textContent: text.content,
        textLanguage: TO_DB[text.language],
        textWordCount: text.wordCount,
        textSourceRef: text.sourceRef,
        settings: request.settings,
        startedAt: now(),
        lobbySize: request.desks.length,
        engineVersion: ENGINE_VERSION,
        protocolVersion: PROTOCOL_VERSION,
      },
    });
    return { ok: true, response: responseOf(race) };
  } catch (err) {
    // A concurrent call with the same raceId won the insert: answer what it stored.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const stored = await db.race.findUnique({ where: { id: request.raceId } });
      if (stored) return replay(stored, request.lobbyId);
    }
    throw err;
  }
}
