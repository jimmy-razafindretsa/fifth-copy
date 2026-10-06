import { AvatarError } from "./errors";
import {
  ProviderImageError,
  fetchProviderImage,
  type ProviderImageFailure,
} from "./fetch-provider-image";
import type { AvatarStore } from "./store";
import type { OauthAvatarUsers } from "./oauth-avatar-users";
import { storeAvatar } from "./store-avatar";

// First-sign-in import of the OAuth provider's picture (#52, ADR 0014): provider URL in, stored
// avatar out, through the same storeAvatar pipeline as uploads. Never rejects: sign-in must not
// depend on a third-party CDN. Only the storage key is persisted, never the provider URL.

export type ImportSkipReason =
  "no-url" | "has-avatar" | ProviderImageFailure | "image" | "raced" | "error";

export type { OauthAvatarUsers };

export type ImportOauthAvatarResult =
  { imported: true; key: string } | { imported: false; reason: ImportSkipReason };

export const OAUTH_AVATAR_WARNING = "oauth_avatar_import_failed";
/** Fixed event name and reason code only: no URL, user id, profile field or error message. */
export type OauthAvatarWarn = (
  event: typeof OAUTH_AVATAR_WARNING,
  payload: { reason: ImportSkipReason },
) => void;

export type ImportOauthAvatarDeps = {
  fetch?: typeof fetch;
  store?: AvatarStore;
  users?: OauthAvatarUsers;
  warn?: OauthAvatarWarn;
  now?: () => number;
};

const defaultWarn: OauthAvatarWarn = (event, payload) => console.warn(event, payload);

class RaceLost extends Error {}

export async function importOauthAvatar(
  userId: string,
  imageUrl: string | null | undefined,
  deps: ImportOauthAvatarDeps = {},
): Promise<ImportOauthAvatarResult> {
  const skip = (reason: ImportSkipReason): ImportOauthAvatarResult => ({ imported: false, reason });
  if (!imageUrl) return skip("no-url");
  const warn = deps.warn ?? defaultWarn;

  try {
    const users = deps.users ?? (await import("../actions/oauth-avatar-users")).oauthAvatarUsers;
    if (await users.hasAvatar(userId)) return skip("has-avatar");

    const bytes = await fetchProviderImage(imageUrl, { fetch: deps.fetch });
    const { key } = await storeAvatar(userId, bytes, "center", {
      store: deps.store,
      now: deps.now,
      // Default moderator: #64 swaps it for uploads and imports at once.
      commit: async ({ key, status }) => {
        if (!(await users.setAvatarIfNone(userId, { key, status }))) throw new RaceLost();
      },
    });
    return { imported: true, key };
  } catch (error) {
    // storeAvatar has already deleted this import's files when the commit failed.
    if (error instanceof RaceLost) return skip("raced");
    const reason: ImportSkipReason =
      error instanceof ProviderImageError
        ? error.reason
        : error instanceof AvatarError
          ? error.code === "TooLarge"
            ? "too-large"
            : "image"
          : "error";
    try {
      warn(OAUTH_AVATAR_WARNING, { reason });
    } catch {
      // A broken logger must not break sign-in either.
    }
    return skip(reason);
  }
}
