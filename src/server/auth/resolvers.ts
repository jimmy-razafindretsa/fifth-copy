import "server-only";
import { cookies } from "next/headers";
import { env } from "@/env";
import { db } from "@/server/db";
import { auth } from "./auth";
import { createGuestResolver, type GuestRow } from "./guest";
import { type AccountRow, createSessionResolver } from "./session";
import type { ViewerResolver } from "./types";

function findGuestById(id: string): Promise<GuestRow | null> {
  return db.user.findUnique({
    where: { id },
    select: { id: true, typistName: true, isGuest: true, avatarStatus: true },
  });
}

/** One read by the session's `sub`, shared by the resolver and the /api/auth/session check. */
export function findAccountById(id: string): Promise<AccountRow | null> {
  return db.user.findUnique({
    where: { id },
    select: { typistName: true, isGuest: true, tokenVersion: true, avatarStatus: true },
  });
}

/** Auth.js's default session cookie names (http, https); `.0` is the first chunk of a split cookie. */
export const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"] as const;

// No session cookie: skip auth() (no JWT decode, no DB read), so guests pay nothing for the session check.
async function getSession() {
  const jar = await cookies();
  const present = SESSION_COOKIES.some((name) => jar.get(name) ?? jar.get(`${name}.0`));
  return present ? auth() : null;
}

export const resolveSession = createSessionResolver({ getSession, findAccountById });

export const resolveGuest = createGuestResolver({
  getCookieJar: cookies,
  findGuestById,
  secret: env.AUTH_SECRET,
});

// Ordered chain read by getViewer; the first non-null viewer wins (ADR 0009): the Auth.js session
// first, the guest cookie (#32) last. Add resolvers here; never change a signature.
export const viewerResolvers: readonly ViewerResolver[] = [resolveSession, resolveGuest];
