"use server";

import { getViewer } from "@/server/auth";
import { db } from "@/server/db";
import { limit } from "@/server/limiter";
import { outfitSchema } from "../schema";

export type SaveClerkOutfitResult =
  { saved: true } | { saved: false; reason: "invalid" | "no-viewer" | "rate-limited" };
/** The action's type, for the landing's client leaf (it receives the action as a prop). */
export type SaveClerkOutfit = (input: unknown) => Promise<SaveClerkOutfitResult>;

/**
 * Saves the clerk outfit (bible 10.1) on the viewer's own `User` row (#687). Cosmetic: a visitor without an
 * identity is not saved, and no guest is created or cookie set for it (ADR 0009). The target is always the
 * viewer, never an id from the input; the input is parsed before anything else. Saves count against the
 * viewer's `clerk-outfit` limit (ADR 0020); a refused save writes nothing.
 */
export async function saveClerkOutfit(input: unknown): Promise<SaveClerkOutfitResult> {
  const parsed = outfitSchema.safeParse(input);
  if (!parsed.success) return { saved: false, reason: "invalid" };
  const viewer = await getViewer();
  if (!viewer) return { saved: false, reason: "no-viewer" };
  if (!(await limit("clerk-outfit", `user:${viewer.id}`)).ok) {
    return { saved: false, reason: "rate-limited" };
  }
  await db.user.update({ where: { id: viewer.id }, data: { outfit: parsed.data } });
  return { saved: true };
}
