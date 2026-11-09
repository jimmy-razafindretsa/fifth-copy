"use server";

import { redirect } from "next/navigation";
import { getViewer, signOut as authSignOut } from "@/server/auth";
import { db } from "@/server/db";
import { logger } from "@/server/logger";

/**
 * Sign-out (#36 C15, #87 C8, ADR 0009 amended 2026-10-04): an account's `tokenVersion` is bumped first,
 * so every session cookie of that account, on every device, stops resolving (`accountViewer`); then
 * Auth.js deletes this browser's cookie and the viewer lands on `/`. A guest or signed-out request only
 * loses its session cookie. A failed bump is logged by name and the cookie is still deleted.
 */
export async function signOut(): Promise<never> {
  const viewer = await getViewer();
  if (viewer && !viewer.isGuest) {
    try {
      await db.user.updateMany({
        where: { id: viewer.id, isGuest: false },
        data: { tokenVersion: { increment: 1 } },
      });
    } catch {
      logger.warn("sign-out revoke failed", {});
    }
  }
  await authSignOut({ redirect: false });
  redirect("/");
}
