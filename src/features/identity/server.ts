// Server-only identity API (ADR 0021): what routes and server code may import beside `index.ts`.
import "server-only";
import { isClean } from "@/features/texts";
import type { OAuthSignInHooks } from "@/server/auth";
import { mergeGuestCookieInto } from "./merge/merge-on-sign-in";
import { refreshPreferenceCookies } from "./preferences/cookies";

// After sign-in the account's stored theme and locale replace the browser's cookies (#66 C3).
export { refreshPreferenceCookies };
// The Auth.js credentials callback spends the sign-in action's budgets (#87 C5).
export { withCredentialsThrottle } from "./auth/throttle";

/**
 * What Auth.js's OAuth sign-in needs from identity (#49): the name screen of sign-up for a provider
 * login, and the guest upgrade of the request's signed `fc_guest` cookie (merge, stamp, cookie cleared),
 * then the preference cookies refreshed from the account's row (#66).
 */
export const oauthSignInHooks: OAuthSignInHooks = {
  isCleanName: isClean,
  // the merge first (a guest's preferences fill the account's gaps), then the cookies follow the row
  mergeGuest: async (accountId) => {
    await mergeGuestCookieInto(accountId);
    await refreshPreferenceCookies(accountId);
  },
};
