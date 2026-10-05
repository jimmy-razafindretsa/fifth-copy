import "server-only";
import type { RoomCode } from "@fifth-copy/protocol";
import { db } from "@/server/db";

// The lobby fields the lobby actions need, by normalised room code.
export function findLobbyByCode(code: RoomCode) {
  return db.lobby.findUnique({
    where: { code },
    select: { id: true, code: true, status: true, hostUserId: true },
  });
}
