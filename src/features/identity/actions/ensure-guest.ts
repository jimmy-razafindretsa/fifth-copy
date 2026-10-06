import "server-only";
import { cookies } from "next/headers";
import { env } from "@/env";
import { Prisma } from "@/generated/prisma/client";
import {
  getViewer,
  GUEST_COOKIE,
  guestCookieOptions,
  signGuestCookie,
  type Viewer,
} from "@/server/auth";
import { db } from "@/server/db";
import { withUniqueTypistName } from "../guest/names";

// Server-only function, deliberately NOT a Server Action (no use-server directive): guest
// creation must not be a public endpoint. Call it only from inside a Server
// Function or Route Handler that performs a write needing an identity (e.g.
// createLobby, mintRaceToken): Next only allows cookies().set there.
//
// Returns the current viewer (session user or valid guest), or creates one
// guest User and sets a freshly signed fc_guest cookie (ADR 0009). A tampered,
// unsigned or unknown-id cookie resolves to no viewer, so it is overwritten.
export async function ensureGuest(): Promise<Viewer> {
  const viewer = await getViewer();
  if (viewer) return viewer;

  const user = await withUniqueTypistName(Math.random, createGuestRow);
  const jar = await cookies();
  jar.set(
    GUEST_COOKIE,
    signGuestCookie(user.id, env.AUTH_SECRET),
    guestCookieOptions(env.NODE_ENV),
  );
  return { id: user.id, name: user.typistName, isGuest: true, hasAvatar: false };
}

// null = typistName already taken (unique index), so the caller draws again.
async function createGuestRow(typistName: string) {
  try {
    return await db.user.create({
      data: { isGuest: true, typistName },
      select: { id: true, typistName: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return null;
    throw error;
  }
}
