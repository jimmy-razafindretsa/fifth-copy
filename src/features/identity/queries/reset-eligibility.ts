import "server-only";
import { db } from "@/server/db";

/**
 * The one membership rule of the teacher reset (#788): `studentId` has a `RaceResult` in a race of a
 * lobby hosted by `hostId` (any of the host's lobbies). Durable, not live: the student who lost a
 * password cannot be in the room as their account. A host is never eligible for their own account.
 * A live-room check through the race server could replace this without touching the action.
 */
export async function isEligibleForReset(hostId: string, studentId: string): Promise<boolean> {
  if (hostId === studentId) return false;
  const hit = await db.raceResult.findFirst({
    where: { userId: studentId, race: { lobby: { hostUserId: hostId } } },
    select: { id: true },
  });
  return hit !== null;
}
