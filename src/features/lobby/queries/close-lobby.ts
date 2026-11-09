import "server-only";
import { db } from "@/server/db";
import { closeLobbies } from "./close-lobbies";

export type CloseLobbyResult = { ok: true; changed: boolean } | { ok: false; error: "not-found" };

/**
 * One lobby's close (#734, race server -> web when its last human left the room): CLOSED at
 * `closedAt`, once. `changed: false` for a lobby already closed; `not-found` for an unknown id.
 */
export async function closeLobby(id: string, closedAt: Date): Promise<CloseLobbyResult> {
  if ((await closeLobbies(db, [id], closedAt)) > 0) return { ok: true, changed: true };
  const row = await db.lobby.findUnique({ where: { id }, select: { id: true } });
  return row ? { ok: true, changed: false } : { ok: false, error: "not-found" };
}
