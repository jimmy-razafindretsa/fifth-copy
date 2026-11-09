import type { PrismaClient } from "@/generated/prisma/client";

/**
 * The one write of `Lobby.status = CLOSED` (#734): the race server's close call
 * (`POST /api/internal/lobbies/:id/close`) and the `lobby.expire` job both go through it. Only a
 * WAITING row changes, so a repeat (or a close racing the sweep) never moves an earlier `closedAt`.
 * Returns how many rows it closed. No Redis, no race server: the room is already gone.
 */
export async function closeLobbies(
  db: Pick<PrismaClient, "lobby">,
  ids: readonly string[],
  closedAt: Date,
): Promise<number> {
  if (ids.length === 0) return 0;
  const { count } = await db.lobby.updateMany({
    where: { id: { in: [...ids] }, status: "WAITING" },
    data: { status: "CLOSED", closedAt },
  });
  return count;
}
