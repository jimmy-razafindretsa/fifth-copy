import "server-only";
import type { Viewer } from "@/server/auth";
import { db } from "@/server/db";
import { limit } from "@/server/limiter";
import { avatarStore } from "../avatars/default-store";
import { avatarKey, type AvatarSize } from "../avatars/store";

// Same shape as the ids the store accepts; anything else cannot have an avatar.
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Whether `viewerId` shares a lobby with `ownerId` (R163, ADR 0022). Passed in by the route:
 * `shareLobby` from `@/features/lobby/server` (identity never imports lobby, which imports identity).
 * Expected never to throw; a throw counts as no.
 */
export type SharesLobby = (viewerId: string, ownerId: string) => Promise<boolean>;

/**
 * Who may see a user's avatar (ADR 0009, 0022): the owner, always, uncounted and without asking
 * anyone; another signed-in viewer only within the `avatar-view` budget (spent first, per viewer) and
 * when `sharesLobby` says yes. Anonymous viewers are refused without a lookup.
 */
async function maySee(viewer: Viewer | null, userId: string, sharesLobby: SharesLobby) {
  if (viewer === null) return false;
  if (viewer.id === userId) return true;
  const verdict = await limit("avatar-view", `user:${viewer.id}`);
  if (!verdict.ok) return false;
  return sharesLobby(viewer.id, userId).catch(() => false);
}

/**
 * The avatar bytes `viewer` may see for `userId` at `version` and `size`, or null for every other
 * case (not allowed, over the limit, no such user, no avatar, not APPROVED, stale version, missing
 * file): callers answer 404 for all of them alike, so the route is no oracle. The access rule runs
 * before the `User` row or the store is read, so a refusal does not depend on what exists.
 */
export async function readAvatarFile(
  viewer: Viewer | null,
  userId: string,
  version: number,
  size: AvatarSize,
  sharesLobby: SharesLobby,
): Promise<Buffer | null> {
  if (!USER_ID.test(userId) || !(await maySee(viewer, userId, sharesLobby))) return null;
  const row = await db.user.findUnique({
    where: { id: userId },
    select: { avatarKey: true, avatarStatus: true },
  });
  if (!row || row.avatarStatus !== "APPROVED" || row.avatarKey !== avatarKey(userId, version)) {
    return null;
  }
  return avatarStore.get(userId, version, size);
}
