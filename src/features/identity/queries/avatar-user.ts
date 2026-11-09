import "server-only";
import type { Viewer } from "@/server/auth";
import { db } from "@/server/db";
import type { AvatarUser } from "../avatars/avatar";

/** The version part of `avatarKey` (`<userId>/<version>`, ADR 0014), or null. */
export function versionOf(key: string | null | undefined): number | null {
  const version = Number(key?.slice(key.lastIndexOf("/") + 1));
  return key && Number.isSafeInteger(version) && version > 0 ? version : null;
}

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
