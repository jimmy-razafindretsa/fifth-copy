import type { StoredAvatarStatus } from "./store-avatar";

/** The User row as this import sees it (#52; default: Prisma, ../actions/oauth-avatar-users.ts). */
export interface OauthAvatarUsers {
  hasAvatar(userId: string): Promise<boolean>;
  /** Sets the key only while the row still has none; false when someone else got there first. */
  setAvatarIfNone(
    userId: string,
    avatar: { key: string; status: StoredAvatarStatus },
  ): Promise<boolean>;
}
