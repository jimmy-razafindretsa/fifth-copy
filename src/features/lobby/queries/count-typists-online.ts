import "server-only";
import { MAX_ROOM_STATUS_IDS, PROTOCOL_VERSION } from "@fifth-copy/protocol";
import { env } from "@/env";
import { db } from "@/server/db";
import { createInternalApiClient, type InternalApiClient } from "@/server/internal-api/client";
import { liveLobbyWhere } from "./open-lobby-filter";

export type CountTypistsOnlineResult = { ok: true; online: number } | { ok: false };

type Options = {
  /** Injected in tests; defaults to the signed client of the app env. */
  client?: InternalApiClient;
  /** Ms epoch, injected in tests. */
  now?: () => number;
};

/**
 * Players online (#943 C21): the human typists seated in live rooms now, any phase, public and private,
 * asked of the race server through the signed room-status call (counts only, ADR 0008) for the newest
 * `MAX_ROOM_STATUS_IDS` lobbies that can still have a room. Bots are not counted. It counts players at
 * a desk, not menu readers, and undercounts beyond 50 lobbies. Never throws: an unanswered call (or a
 * failed read) is `{ ok: false }` and the menu shows no figure.
 */
export async function countTypistsOnline({
  client,
  now = Date.now,
}: Options = {}): Promise<CountTypistsOnlineResult> {
  try {
    const rows = await db.lobby.findMany({
      where: liveLobbyWhere(now()),
      orderBy: { createdAt: "desc" },
      take: MAX_ROOM_STATUS_IDS,
      select: { id: true },
    });
    if (rows.length === 0) return { ok: true, online: 0 };
    const raceServer =
      client ??
      createInternalApiClient({
        baseUrl: env.RACE_SERVER_INTERNAL_URL,
        secret: env.RACE_TOKEN_SECRET,
      });
    const answer = await raceServer.roomStatus({
      v: PROTOCOL_VERSION,
      lobbyIds: rows.map((row) => row.id),
    });
    if (!answer.ok) return { ok: false };
    return { ok: true, online: answer.data.rooms.reduce((sum, room) => sum + room.typists, 0) };
  } catch {
    return { ok: false };
  }
}
