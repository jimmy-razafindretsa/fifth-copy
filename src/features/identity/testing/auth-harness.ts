import { randomBytes } from "node:crypto";
import { vi } from "vitest";
import type { Viewer } from "@/server/auth";

// Shared fakes of the sign-up and sign-in action tests (#36): a cookie jar standing in for
// `next/headers`, `redirect` as a thrown signal, and Auth.js's `signIn` / `signOut` acting on that jar
// (the real Auth.js runs in the e2e specs). The DB, Argon2id, verifyCredentials and the guest cookie
// signature are the real ones. Tests wire it with `vi.mock(..., () => harnessModules.x())`.

export const AUTH_SECRET = "s".repeat(32);
/** The cookie Auth.js sets over http; the fake signIn writes it, the fake signOut deletes it. */
export const SESSION = "authjs.session-token";

export class Redirect extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}

export type Harness = {
  db: unknown;
  jar: Map<string, string>;
  /** Names deleted through the jar, in order. */
  deleted: string[];
  viewer: Viewer | null;
  locale: "en" | "fr";
  signIns: Array<{ provider: string; username: unknown; redirect: unknown }>;
  /** The account id the fake Auth.js signIn put in the session cookie. */
  sessionUser: string | null;
};

export function newHarness(): Harness {
  return {
    db: null,
    jar: new Map(),
    deleted: [],
    viewer: null,
    locale: "en",
    signIns: [],
    sessionUser: null,
  };
}

export function reset(h: Harness) {
  h.jar.clear();
  h.deleted.length = 0;
  h.viewer = null;
  h.locale = "en";
  h.signIns.length = 0;
  h.sessionUser = null;
}

export const runId = () => randomBytes(3).toString("hex");

export function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  }
  return data;
}

/** Runs an action that should redirect and returns the target; fails the test otherwise. */
export async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    const result = await run();
    throw new Error(`expected a redirect, got ${JSON.stringify(result)}`);
  } catch (error) {
    if (error instanceof Redirect) return error.url;
    throw error;
  }
}

/** The mocked modules, built from the harness (call inside `vi.mock` factories). */
export const harnessModules = {
  headers: (h: Harness) => ({
    cookies: async () => ({
      get: (name: string) => (h.jar.has(name) ? { name, value: h.jar.get(name)! } : undefined),
      set: (name: string, value: string) => void h.jar.set(name, value),
      delete: (name: string) => {
        h.deleted.push(name);
        h.jar.delete(name);
      },
    }),
    headers: async () => new Headers(),
  }),
  navigation: () => ({
    redirect: (url: string) => {
      throw new Redirect(url);
    },
  }),
  db: (h: Harness) => ({
    db: new Proxy({}, { get: (_t, key) => (h.db as Record<PropertyKey, unknown>)[key] }),
  }),
  i18n: async (h: Harness) => {
    const { en } = await import("@/i18n/en");
    const { fr } = await import("@/i18n/fr");
    return { getT: async () => (h.locale === "fr" ? fr : en) };
  },
  auth: async (h: Harness) => {
    const password = await import("@/server/auth/password");
    const credentials = await import("@/server/auth/credentials");
    const guestCookie = await import("@/server/auth/guest-cookie");
    const errors = await import("@/server/auth/errors");
    const viewer = async () => (h.jar.has(SESSION) || h.viewer?.isGuest ? h.viewer : null);
    return {
      ...password,
      ...credentials,
      ...guestCookie,
      ...errors,
      getViewer: viewer,
      requireViewer: async () => {
        const v = await viewer();
        if (!v) throw new errors.UnauthenticatedError();
        return v;
      },
      // Auth.js's Credentials callback: verifyCredentials, then the session cookie, else a throw.
      signIn: vi.fn(
        async (provider: string, opts: { username: unknown; password: unknown; redirect: unknown }) => {
          h.signIns.push({ provider, username: opts.username, redirect: opts.redirect });
          const account = await credentials.verifyCredentials(opts);
          if (!account) throw new Error("CredentialsSignin");
          h.sessionUser = account.id;
          h.jar.set(SESSION, `jwt-for-${account.id}`);
          return "/";
        },
      ),
      signOut: vi.fn(async () => {
        h.deleted.push(SESSION);
        h.jar.delete(SESSION);
        h.sessionUser = null;
      }),
    };
  },
};
