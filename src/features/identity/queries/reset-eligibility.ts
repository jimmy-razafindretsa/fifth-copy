import "server-only";
import { db } from "@/server/db";

/**
 * The account a host may issue a teacher reset code for (#788), in ONE query: an account (not a
 * guest) named `usernameNormalized`, with a password, other than the host, holding a `RaceResult`
 * in a race of any lobby hosted by `hostId`. Every refusal cause is the same `null` from the same
 * round trip. Membership is durable, not live: the student who lost a password cannot be in the
 * room as their account. A live-room check could replace this without touching the action.
 */
export async function findResetTarget(
  hostId: string,
  usernameNormalized: string,
): Promise<{ id: string } | null> {
  return db.user.findFirst({
    where: {
      usernameNormalized,
      isGuest: false,
      passwordHash: { not: null },
      id: { not: hostId },
      raceResults: { some: { race: { lobby: { hostUserId: hostId } } } },
    },
    select: { id: true },
  });
}

/**
 * The lobby named `code` when `viewerId` is its host and that host is a teacher account (#788 C3,
 * C8): `isTeacher`, and never a guest row, whatever the flag says.
 */
export async function findTeacherLobby(
  code: string,
  viewerId: string,
): Promise<{ code: string } | null> {
  return db.lobby.findFirst({
    where: { code, hostUserId: viewerId, host: { isGuest: false, isTeacher: true } },
    select: { code: true },
  });
}

/**
 * Whether `viewerId` may issue reset codes in the lobby `code` (#790): the waiting room renders the
 * host's `PASSWORD RESET` docket only then. A convenience, never the check: `issuePasswordReset`
 * re-checks the host, the teacher flag and the limiter itself (ADR 0009). A failed lookup is `false`.
 */
export function canIssueResetIn(code: string, viewerId: string): Promise<boolean> {
  return findTeacherLobby(code, viewerId).then(Boolean, () => false);
}
