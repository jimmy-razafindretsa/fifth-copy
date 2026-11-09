import "server-only";
import { fill, getT } from "@/i18n";
import { normalizeUsername } from "@/lib/username";
import { limit, type LimitVerdict, requestIpSubject } from "@/server/limiter";

// Throttles of the account entry points (#87 C5, ADR 0009 "Hardening", ADR 0020): every budget is
// spent before any lookup or Argon2id comparison. "Per client" is the client IP
// (`requestIpSubject()`), never the guest cookie: a fresh guest cookie must not reset a budget.

/**
 * One sign-in attempt for `username`: the client budget (`sign-in`, 30 per 15 min) first, then, only
 * when the client was admitted, the account budget (`sign-in-account`, 10 per 15 min per normalized
 * username), so one client cannot spend another student's budget beyond its own.
 */
export async function throttleSignIn(username: string): Promise<LimitVerdict> {
  const client = await limit("sign-in", await requestIpSubject());
  if (!client.ok) return client;
  return limit("sign-in-account", `signin:${normalizeUsername(username)}`);
}

/** One sign-up attempt of this client (`sign-up`, 10 per hour). */
export async function throttleSignUp(): Promise<LimitVerdict> {
  return limit("sign-up", await requestIpSubject());
}

/** One avatar upload of this viewer (`avatar-upload`, 5 per minute). */
export function throttleAvatarUpload(viewerId: string): Promise<LimitVerdict> {
  return limit("avatar-upload", `user:${viewerId}`);
}

/** Whole minutes until the budget frees up, at least 1. */
export const retryMinutes = (retryAfterMs: number) => Math.max(1, Math.ceil(retryAfterMs / 60_000));

/**
 * The one generic "try again later" of every throttled account action, in the viewer's locale, with
 * the delay ("Too many tries. Try again in {m} min."; the /reset and /recover line, never the input).
 */
export async function throttledMessage(retryAfterMs: number): Promise<string> {
  return fill((await getT()).auth.reset.errors["rate-limited"], { m: retryMinutes(retryAfterMs) });
}

/** The Auth.js credentials callback, the HTTP twin of the sign-in action. */
const CREDENTIALS_CALLBACK = /\/api\/auth\/callback\/credentials\/?$/;

/**
 * Wraps the Auth.js POST handler so `/api/auth/callback/credentials` spends the same sign-in budgets
 * as the sign-in action (no unthrottled way to guess a password). A refused attempt never reaches
 * Auth.js: it is sent back to `/sign-in?error=RateLimited` with `Retry-After`.
 */
export function withCredentialsThrottle<R extends Request>(
  post: (request: R) => Promise<Response>,
): (request: R) => Promise<Response> {
  return async (request) => {
    if (!CREDENTIALS_CALLBACK.test(new URL(request.url).pathname)) return post(request);
    let username = "";
    try {
      const value = (await request.clone().formData()).get("username");
      if (typeof value === "string") username = value;
    } catch {
      // not a form: Auth.js refuses it; the attempt still counts against the client budget
    }
    const verdict = await throttleSignIn(username);
    if (verdict.ok) return post(request);
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/sign-in?error=RateLimited",
        "Retry-After": String(Math.max(1, Math.ceil(verdict.retryAfterMs / 1000))),
      },
    });
  };
}
