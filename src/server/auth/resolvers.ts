import "server-only";
import { cookies } from "next/headers";
import { env } from "@/env";
import { db } from "@/server/db";
import { createGuestResolver, type GuestRow } from "./guest";
import type { ViewerResolver } from "./types";

function findGuestById(id: string): Promise<GuestRow | null> {
  return db.user.findUnique({
    where: { id },
    select: { id: true, typistName: true, isGuest: true, avatarStatus: true },
  });
}

export const resolveGuest = createGuestResolver({
  getCookieJar: cookies,
  findGuestById,
  secret: env.AUTH_SECRET,
});

// Ordered chain read by getViewer; the first non-null viewer wins.
// Extension point: #38 prepends the Auth.js session resolver; the guest cookie
// resolver (#32) stays last. Add resolvers here; never change a signature.
export const viewerResolvers: readonly ViewerResolver[] = [resolveGuest];
