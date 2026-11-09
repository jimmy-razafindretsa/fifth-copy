"use server";

import { redirect } from "next/navigation";
import { signOut as authSignOut } from "@/server/auth";

/**
 * Sign-out (#36 C15, ADR 0009): JWT sessions have no table, so signing out is deleting the session
 * cookie (Auth.js expires it), then back to the landing. Revoking the token on the server (bumping
 * `tokenVersion`) is #87's extension of this action.
 */
export async function signOut(): Promise<never> {
  await authSignOut({ redirect: false });
  redirect("/");
}
