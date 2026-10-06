import "server-only";
import type { Viewer } from "@/server/auth";
import { db } from "@/server/db";
import { avatarStore } from "../avatars/default-store";
import { avatarKey, type AvatarSize } from "../avatars/store";

// Same shape as the ids the store accepts; anything else cannot have an avatar.
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Who may see a user's avatar. The owner only, until #65 adds lobby members (R163). */
function maySee(viewer: Viewer | null, userId: string): boolean {
  return viewer !== null && viewer.id === userId;
}

/**
 * The avatar bytes `viewer` may see for `userId` at `version` and `size`, or null for every other
 * case (not allowed, no avatar, not APPROVED, stale version, missing file): callers answer 404 for
 * all of them alike, so the route is no oracle.
 */
export async function readAvatarFile(
  viewer: Viewer | null,
  userId: string,
  version: number,
  size: AvatarSize,
): Promise<Buffer | null> {
  if (!USER_ID.test(userId) || !maySee(viewer, userId)) return null;
  const row = await db.user.findUnique({
    where: { id: userId },
    select: { avatarKey: true, avatarStatus: true },
  });
  if (!row || row.avatarStatus !== "APPROVED" || row.avatarKey !== avatarKey(userId, version)) {
    return null;
  }
  return avatarStore.get(userId, version, size);
}
