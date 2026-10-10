"use server";

import { db } from "@/server/db";
import { raceSeatIdSchema } from "../schema";

/** The room behind a seat view: the lobby the race server keys the room by, and its join code. */
export type RaceSeatInfo = { lobbyId: string; code: string };

/**
 * Resolves the `[raceId]` of `/race/[raceId]` (#561 C1) to its lobby: a `Race.id` through
 * `Race.lobbyId`, or a lobby id as is (the room's identity, for a page opened before any start).
 * Anything else, a race whose lobby is gone included, is `null` and the page answers `notFound()`.
 * The id is parsed before any query.
 *
 * A `"use server"` module on purpose: the race feature's index is imported by client modules (the
 * lobby's lazy socket import, `/design`), and only a server function reaches a client graph as a mere
 * reference, so Prisma never lands in a client chunk. It reads nothing the page itself does not serve:
 * `/race/<id>` renders the same lobby code for anyone holding the id.
 */
export async function getRaceSeat(id: string): Promise<RaceSeatInfo | null> {
  const parsed = raceSeatIdSchema.safeParse(id);
  if (!parsed.success) return null;
  const { table, id: key } = parsed.data;
  if (table === "lobby") {
    const lobby = await db.lobby.findUnique({ where: { id: key }, select: { id: true, code: true } });
    return lobby ? { lobbyId: lobby.id, code: lobby.code } : null;
  }
  const race = await db.race.findUnique({
    where: { id: key },
    select: { lobby: { select: { id: true, code: true } } },
  });
  return race?.lobby ? { lobbyId: race.lobby.id, code: race.lobby.code } : null;
}
