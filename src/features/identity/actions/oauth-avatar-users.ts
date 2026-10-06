import "server-only";
import { db } from "@/server/db";
import type { OauthAvatarUsers } from "../avatars/oauth-avatar-users";

// Default User-row port of importOauthAvatar (#52). Not a Server Action (no "use server"): it is
// called only from server code and must never be reachable from the client.
export const oauthAvatarUsers: OauthAvatarUsers = {
  async hasAvatar(userId) {
    const user = await db.user.findUnique({ where: { id: userId }, select: { avatarKey: true } });
    return user?.avatarKey != null;
  },
  async setAvatarIfNone(userId, { key, status }) {
    // Conditional write: a picture the user chose meanwhile is never overwritten (C3).
    const { count } = await db.user.updateMany({
      where: { id: userId, avatarKey: null },
      data: { avatarKey: key, avatarStatus: status },
    });
    return count === 1;
  },
};
