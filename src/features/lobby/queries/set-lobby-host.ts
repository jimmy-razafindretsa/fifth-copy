import "server-only";
import { db } from "@/server/db";

export type SetLobbyHostResult = { ok: true; changed: boolean } | { ok: false; error: "not-found" };

/**
 * The durable copy of a host transfer (#137, race server -> web after the room promoted a new host;
 * ADR 0008: the room hash is the live truth, `Lobby.hostUserId` its durable copy read by the host-only
 * actions). Idempotent: the same host answers `changed: false` without a write. `not-found` for an
 * unknown lobby or a `hostUserId` that is not a `User` row.
 */
export async function setLobbyHost(id: string, hostUserId: string): Promise<SetLobbyHostResult> {
  const [lobby, user] = await Promise.all([
    db.lobby.findUnique({ where: { id }, select: { hostUserId: true } }),
    db.user.findUnique({ where: { id: hostUserId }, select: { id: true } }),
  ]);
  if (!lobby || !user) return { ok: false, error: "not-found" };
  if (lobby.hostUserId === hostUserId) return { ok: true, changed: false };
  const { count } = await db.lobby.updateMany({
    where: { id, hostUserId: { not: hostUserId } },
    data: { hostUserId },
  });
  return { ok: true, changed: count > 0 };
}
