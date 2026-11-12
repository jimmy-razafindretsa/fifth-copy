import type { Account, Profile, User } from "next-auth";
import { discordProfile, githubProfile, googleProfile, type OAuthUser } from "./providers";

/**
 * What OAuth sign-in needs from the identity feature (#49), injected because src/server never imports
 * features (ADR 0001): the name screen (`isClean`), the guest upgrade (`mergeGuestCookieInto`, which
 * runs `mergeGuestInto` for the request's signed guest cookie and never throws) and the first-sign-in
 * picture import (`importOauthAvatar`, #52/#539, ADR 0014). The Auth.js route registers them
 * (`src/app/api/auth/[...nextauth]/route.ts`).
 */
export type OAuthSignInHooks = {
  isCleanName: (name: string) => boolean;
  mergeGuest: (accountId: string) => Promise<void>;
  importAvatar: (accountId: string, imageUrl: string) => Promise<unknown>;
};

let registered: OAuthSignInHooks | null = null;

export function registerOAuthSignInHooks(hooks: OAuthSignInHooks): void {
  registered = hooks;
}

/** The registered hooks, or null before the Auth.js route registered them (names then fail closed). */
export function oauthSignInHooks(): OAuthSignInHooks | null {
  return registered;
}

const OAUTH_TYPES = new Set(["oauth", "oidc"]);

/** Each provider's profile() (./providers): the event gets the raw userinfo, not the mapped user. */
const PROFILE_MAPPERS = new Map<string, (raw: never) => OAuthUser>([
  ["github", githubProfile],
  ["discord", discordProfile],
  ["google", googleProfile],
]);

/** The picture URL the provider's profile() maps from the raw profile; null when there is none. */
function providerImage(provider: string, profile: Profile | undefined): string | null {
  const map = PROFILE_MAPPERS.get(provider);
  if (!map || !profile) return null;
  try {
    const { image } = map(profile as never);
    return typeof image === "string" && image !== "" ? image : null;
  } catch {
    return null;
  }
}

/** Starts the import and returns at once: sign-in never waits on, nor fails with, a provider CDN. */
function startImport(hooks: OAuthSignInHooks, accountId: string, imageUrl: string): void {
  try {
    void hooks.importAvatar(accountId, imageUrl).catch(() => undefined);
  } catch {
    // a hook that throws before returning its promise must not fail the sign-in either
  }
}

type SignInMessage = {
  user: User;
  account?: Account | null;
  profile?: Profile;
  isNewUser?: boolean;
};

/**
 * Auth.js `events.signIn` for OAuth (#49 C3). It runs after the adapter found or created the account
 * (`getUserByAccount` / `createUser` + `linkAccount`), so `user.id` is the account's row id: the
 * `signIn` callback runs before that and only sees the provider's profile. The current guest (if any)
 * is merged into that account. Credentials sign-in merges in its own action (#36) and is skipped here.
 * A new account's provider picture (#539) is mapped again from the raw `profile` by the provider's
 * profile() (the adapter never stores the image, so `user` carries none) and handed to the import
 * without being awaited; the URL is passed in memory only, never written to a row or the JWT.
 */
export function createOAuthSignInEvent(hooks: () => OAuthSignInHooks | null) {
  return async ({ user, account, profile, isNewUser }: SignInMessage): Promise<void> => {
    if (!account || !OAUTH_TYPES.has(account.type) || !user.id) return;
    const registered = hooks();
    if (!registered) return;
    await registered.mergeGuest(user.id);
    if (!isNewUser) return;
    const image = providerImage(account.provider, profile);
    if (image) startImport(registered, user.id, image);
  };
}
