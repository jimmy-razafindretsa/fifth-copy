"use server";

import { redirect } from "next/navigation";
import { getT } from "@/i18n";
import { signIn as authSignIn, verifyCredentials } from "@/server/auth";
import { logger } from "@/server/logger";
import { safeCallbackUrl } from "../auth/callback-url";
import { throttledMessage, throttleSignIn } from "../auth/throttle";
import { mergeGuestCookieInto } from "../merge/merge-on-sign-in";
import { refreshPreferenceCookies } from "../preferences/cookies";
import { parseSignIn } from "../schema";
import type { AuthFormState } from "./auth-form-state";

const failed = (name: string) => logger.warn(name, {});

/**
 * Username sign-in (#36 C5-C7, ADR 0009, R148). Empty fields get their field errors; any other miss
 * (unknown username, wrong password, guest row, malformed input) gets the one generic
 * `auth.errors.credentials` message, after the same single Argon2id comparison (`verifyCredentials`,
 * #38), so nothing tells whether a username exists. On success Auth.js sets the 30-day JWT cookie, the
 * guest cookie's history is merged into the account and the cookie cleared, then the viewer lands on
 * `callbackUrl` when it is a same-origin path (theme and locale cookies refreshed from the account, #66), else on `/`.
 * Throttled (#87 C5) before any lookup: 30 per 15 min per client, then 10 per 15 min per username; a
 * refused attempt answers the generic "try again in {m} min" and compares nothing.
 */
export async function signIn(form: FormData): Promise<AuthFormState> {
  const { username, password, callbackUrl } = parseSignIn(form);
  const errors = (await getT()).auth.errors;
  if (username.trim() === "" || password === "") {
    return {
      fieldErrors: {
        ...(username.trim() === "" ? { username: errors.usernameRequired } : {}),
        ...(password === "" ? { password: errors.passwordRequired } : {}),
      },
      formError: null,
    };
  }

  const verdict = await throttleSignIn(username);
  if (!verdict.ok)
    return { fieldErrors: {}, formError: await throttledMessage(verdict.retryAfterMs) };

  let account: Awaited<ReturnType<typeof verifyCredentials>>;
  try {
    account = await verifyCredentials({ username, password });
  } catch {
    failed("credentials lookup failed");
    return { fieldErrors: {}, formError: errors.generic };
  }
  if (!account) return { fieldErrors: {}, formError: errors.credentials };

  try {
    await authSignIn("credentials", { username, password, redirect: false });
  } catch {
    // the password changed between the two checks, or Auth.js refused: the same generic answer
    failed("credentials sign-in refused after verification");
    return { fieldErrors: {}, formError: errors.credentials };
  }
  await mergeGuestCookieInto(account.id);
  // the account's stored theme and locale win over this browser's cookies (#66 C3)
  await refreshPreferenceCookies(account.id);
  redirect(safeCallbackUrl(callbackUrl));
}

/** `useActionState` form of `signIn`. */
export async function signInAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  return signIn(form);
}
