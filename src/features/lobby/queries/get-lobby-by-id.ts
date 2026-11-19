import "server-only";
import { db } from "@/server/db";

// The lobby an invite token points at (#808): its code and status, by id.
export function findLobbyById(id: string) {
  return db.lobby.findUnique({ where: { id }, select: { code: true, status: true } });
}

/**
 * The lobby a spectator link points at (#999 C12): its status and host, by id. Never its code: a
 * link holder is not told the room code (C13), so the code is not even read on that path.
 */
export function findLobbyForWatch(id: string) {
  return db.lobby.findUnique({
    where: { id },
    select: { id: true, status: true, hostUserId: true },
  });
}
