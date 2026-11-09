import "server-only";
import type { Viewer } from "@/server/auth";
import { db } from "@/server/db";
import type { AvatarUser } from "../avatars/avatar";
import { versionOf } from "./avatar-version";

/**
 * What `Avatar` needs for the viewer (#60): the viewer plus the stored version. Reads the row only when
 * an approved picture is on file; everyone else shows the portrait.
 */
export async function getAvatarUser(viewer: Viewer): Promise<AvatarUser> {
  const base = { id: viewer.id, name: viewer.name, hasAvatar: viewer.hasAvatar };
  if (!viewer.hasAvatar) return { ...base, avatarVersion: null };
  const row = await db.user.findUnique({ where: { id: viewer.id }, select: { avatarKey: true } });
  return { ...base, avatarVersion: versionOf(row?.avatarKey) };
}
