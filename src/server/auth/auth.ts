import "server-only";
import NextAuth, { type NextAuthConfig, type User } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { env } from "@/env";
import { db } from "@/server/db";
import { logger } from "@/server/logger";
import { createAuthAdapter } from "./adapter";
import { createAuthLogger } from "./auth-logger";
import { verifyCredentials } from "./credentials";
import { createTypistNameFor } from "./typist-name";

// What the JWT and session.user carry (ADR 0009): no email, no picture.
declare module "next-auth" {
  interface User {
    tokenVersion?: number;
  }
  interface Session {
    user: { id: string; name: string; tokenVersion: number };
  }
}
declare module "@auth/core/jwt" {
  interface JWT {
    tokenVersion?: number;
  }
}

/** 30 days, in seconds. The tokenVersion check against the DB is the session resolver's (session.ts). */
export const SESSION_MAX_AGE = 2_592_000;

/**
 * The Credentials provider's authorize: delegates to verifyCredentials (#38), which returns null for any
 * miss after one Argon2id comparison. Only username and password are forwarded (not csrfToken etc.).
 */
export async function authorizeCredentials(
  credentials: Partial<Record<string, unknown>>,
): Promise<User | null> {
  return verifyCredentials({ username: credentials.username, password: credentials.password });
}

/**
 * Auth.js wiring (#786, ADR 0009). Extension points: `providers` (#49 appends GitHub and Discord with
 * their profile() mappers), `callbacks.signIn` (#49 runs the guest merge there).
 */
export const authConfig = {
  secret: env.AUTH_SECRET,
  // Railway's proxy sets the host; a production build refuses every request (UntrustedHost) otherwise.
  // Callback URLs stay checked against the request origin.
  trustHost: true,
  // JSON lines through the app logger, not Auth.js's console output (ARCHITECTURE 10).
  logger: createAuthLogger(logger),
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE },
  adapter: createAuthAdapter({ db, typistNameFor: createTypistNameFor(db) }),
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username" },
        password: { label: "Password", type: "password" },
      },
      authorize: authorizeCredentials,
    }),
  ],
  callbacks: {
    // On sign-in a fresh token from the row: sub, name, tokenVersion and nothing else.
    jwt({ token, user }) {
      if (!user) return token;
      return { sub: user.id, name: user.name, tokenVersion: user.tokenVersion };
    },
    session({ session, token }) {
      return {
        expires: session.expires,
        user: {
          id: token.sub ?? "",
          name: token.name ?? "",
          tokenVersion: token.tokenVersion ?? 0,
        },
      } as typeof session;
    },
  },
} satisfies NextAuthConfig;

const nextAuth = NextAuth(authConfig);

/** The raw Auth.js route handlers; `./handlers` wraps them for /api/auth (#786 C4, #787 C4). */
export const nextAuthHandlers = nextAuth.handlers;
export const { auth, signIn, signOut } = nextAuth;
