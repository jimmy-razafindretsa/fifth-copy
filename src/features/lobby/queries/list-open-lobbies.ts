import "server-only";
import { MAX_ROOM_STATUS_IDS, PROTOCOL_VERSION } from "@fifth-copy/protocol";
import { env } from "@/env";
import { db } from "@/server/db";
import { createInternalApiClient, type InternalApiClient } from "@/server/internal-api/client";
import type { ListOpenLobbiesResult, OpenLobby } from "../types";

/**
 * How far back a `Lobby` row may still have a room: the race server's `ROOM_TTL_S` (2 h). An older
 * room is gone from Redis (#806). Mirrored here because `src/` never imports `services/` (ADR 0005).
 */
export const OPEN_LOBBY_MAX_AGE_MS = 2 * 3600 * 1000;

// The shapes live in ../types so the landing's docket (#807) can type its rows from the client-safe index.
export type { ListOpenLobbiesResult, OpenLobby } from "../types";

type Options = {
  /** Injected in tests; defaults to the signed client of the app env. */
  client?: InternalApiClient;
  /** Ms epoch, injected in tests. */
  now?: () => number;
};

/**
 * The one definition of "joinable" (#806): a PUBLIC, WAITING `Lobby` row of the last 2 h whose
 * live room, asked of the race server (ADR 0008: the web never reads the room's Redis keys), is in
 * phase `waiting` with a free desk. Busiest first, then newest. `Lobby.status` never reaches
 * `CLOSED` yet (#734), so the race server's answer is what filters gone, started and full rooms.
 * When the race server does not answer, nothing is listed: a lobby is never shown unchecked.
 */
export async function listOpenLobbies({
  client,
  now = Date.now,
}: Options = {}): Promise<ListOpenLobbiesResult> {
  const rows = await db.lobby.findMany({
    where: {
      type: "PUBLIC",
      status: "WAITING",
      createdAt: { gte: new Date(now() - OPEN_LOBBY_MAX_AGE_MS) },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_ROOM_STATUS_IDS,
    select: { id: true, code: true },
  });
  if (rows.length === 0) return { ok: true, lobbies: [] };

  const raceServer =
    client ??
    createInternalApiClient({
      baseUrl: env.RACE_SERVER_INTERNAL_URL,
      secret: env.RACE_TOKEN_SECRET,
    });
  const answer = await raceServer
    .roomStatus({ v: PROTOCOL_VERSION, lobbyIds: rows.map((row) => row.id) })
    .catch(() => ({ ok: false as const }));
  if (!answer.ok) return { ok: false, error: "race-server-unavailable" };

  const rooms = new Map(answer.data.rooms.map((room) => [room.lobbyId, room]));
  const lobbies: OpenLobby[] = [];
  // Rows are newest first; the stable sort below keeps that order among equal typist counts.
  for (const row of rows) {
    const room = rooms.get(row.id);
    if (!room || room.phase !== "waiting" || room.typists + room.bots >= room.seats) continue;
    lobbies.push({ code: row.code, typists: room.typists, bots: room.bots, seats: room.seats });
  }
  lobbies.sort((a, b) => b.typists - a.typists);
  return { ok: true, lobbies };
}
