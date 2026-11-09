import type { Account, User } from "next-auth";

/**
 * What OAuth sign-in needs from the identity feature (#49), injected because src/server never imports
 * features (ADR 0001): the name screen (`isClean`) and the guest upgrade (`mergeGuestCookieInto`, which
 * runs `mergeGuestInto` for the request's signed guest cookie and never throws). The Auth.js route
 * registers them (`src/app/api/auth/[...nextauth]/route.ts`).
 */
export type OAuthSignInHooks = {
  isCleanName: (name: string) => boolean;
  mergeGuest: (accountId: string) => Promise<void>;
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

/**
 * Auth.js `events.signIn` for OAuth (#49 C3). It runs after the adapter found or created the account
 * (`getUserByAccount` / `createUser` + `linkAccount`), so `user.id` is the account's row id: the
 * `signIn` callback runs before that and only sees the provider's profile. The current guest (if any)
 * is merged into that account. Credentials sign-in merges in its own action (#36) and is skipped here.
 */
export function createOAuthSignInEvent(hooks: () => OAuthSignInHooks | null) {
  return async ({ user, account }: { user: User; account?: Account | null }): Promise<void> => {
    if (!account || !OAUTH_TYPES.has(account.type) || !user.id) return;
    await hooks()?.mergeGuest(user.id);
  };
}
