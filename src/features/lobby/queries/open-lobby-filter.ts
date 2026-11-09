import type { Prisma } from "@/generated/prisma/client";
import { ROOM_TTL_MS } from "../room-ttl";

/** How far back a `Lobby` row may still have a room: the race server's room TTL (#806). */
export const OPEN_LOBBY_MAX_AGE_MS = ROOM_TTL_MS;

/**
 * The Postgres half of "joinable" (#806): a PUBLIC lobby that is not CLOSED (#734: the race server's
 * close call and the `lobby.expire` job write CLOSED) and young enough to still have a room. The
 * race server's room status is the other half (`listOpenLobbies`).
 */
export function openLobbyWhere(nowMs: number): Prisma.LobbyWhereInput {
  return {
    type: "PUBLIC",
    status: "WAITING",
    createdAt: { gte: new Date(nowMs - OPEN_LOBBY_MAX_AGE_MS) },
  };
}
