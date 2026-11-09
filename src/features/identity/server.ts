// Server-only identity API (ADR 0021): what routes and server code may import beside `index.ts`.
import "server-only";
import { isClean } from "@/features/texts";
import type { OAuthSignInHooks } from "@/server/auth";
import { mergeGuestCookieInto } from "./merge/merge-on-sign-in";

/**
 * What Auth.js's OAuth sign-in needs from identity (#49): the name screen of sign-up for a provider
 * login, and the guest upgrade of the request's signed `fc_guest` cookie (merge, stamp, cookie cleared).
 */
export const oauthSignInHooks: OAuthSignInHooks = {
  isCleanName: isClean,
  mergeGuest: mergeGuestCookieInto,
};
