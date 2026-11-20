"use server";

import { raceSeatIdSchema } from "../schema";

/**
 * The room behind a seat view: the lobby the race server keys the room by, its join code when the
 * viewer may know it (#999 C13), else `null`, and whether the viewer is the lobby's host (#999 C14: a
 * host on a phone watches with its own player token, the watching host of #876).
 */
export type RaceSeatInfo = { lobbyId: string; code: string | null; host: boolean };

/**
 * Resolves the `[raceId]` of `/race/[raceId]` (#561 C1) to its lobby: a `Race.id` through
 * `Race.lobbyId`, or a lobby id as is (the room's identity, for a page opened before any start).
 * Anything else, a race whose lobby is gone included, is `null` and the page answers `notFound()`.
 * The id is parsed before any query.
 *
 * #999 C13: an id is not the code. A spectator link reveals its room's lobby id and race id, so the
 * code is served only to the room's host (`Lobby.hostUserId`, read from the row) or to a viewer
 * holding the room code proof (`web:code-proof:<viewer>:<lobby>`, written when that viewer presented
 * the code to `mintRaceToken` or the page's code entry). Everyone else gets `code: null` and the page
 * asks for the code. The viewer comes from the request's cookies, never from an argument; the proof
 * store fails closed (Redis away: no code).
 *
 * A `"use server"` module on purpose: the race feature's index is imported by client modules (the
 * lobby's lazy socket import, `/design`), and only a server function reaches a client graph as a mere
 * reference, so Prisma never lands in a client chunk. Being callable as an action is why the rule
 * above lives here and not in the page. The db client loads on the first call, so importing the index
 * (unit tests, the server graph) needs no database environment.
 */
export async function getRaceSeat(id: string): Promise<RaceSeatInfo | null> {
  const parsed = raceSeatIdSchema.safeParse(id);
  if (!parsed.success) return null;
  const { db } = await import("@/server/db");
  const { table, id: key } = parsed.data;
  const select = { id: true, code: true, hostUserId: true } as const;
  const lobby =
    table === "lobby"
      ? await db.lobby.findUnique({ where: { id: key }, select })
      : ((await db.race.findUnique({ where: { id: key }, select: { lobby: { select } } }))?.lobby ??
        null);
  if (!lobby) return null;
  const { known, host } = await viewerOf(lobby);
  return { lobbyId: lobby.id, code: known ? lobby.code : null, host };
}

async function viewerOf(lobby: {
  id: string;
  hostUserId: string;
}): Promise<{ known: boolean; host: boolean }> {
  const [{ getViewer }, { codeProofStore }] = await Promise.all([
    import("@/server/auth"),
    import("@/server/room-code-proof"),
  ]);
  const viewer = await getViewer();
  if (!viewer) return { known: false, host: false };
  if (viewer.id === lobby.hostUserId) return { known: true, host: true };
  return { known: await codeProofStore().holds(viewer.id, lobby.id), host: false };
}
