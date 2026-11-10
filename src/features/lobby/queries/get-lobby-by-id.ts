import "server-only";
import { db } from "@/server/db";

// The lobby an invite token points at (#808): its code and status, by id.
export function findLobbyById(id: string) {
  return db.lobby.findUnique({ where: { id }, select: { code: true, status: true } });
}
