import "server-only";
import { db } from "@/server/db";
import { parseOutfit, type Outfit } from "../clerk/outfit";

/**
 * The saved clerk outfit of `viewerId` (#687), or null when nothing is saved or the stored value is no
 * longer a valid outfit of the current catalogue (callers then fall back to a random or per-desk outfit).
 */
export async function getClerkOutfit(viewerId: string): Promise<Outfit | null> {
  const row = await db.user.findUnique({ where: { id: viewerId }, select: { outfit: true } });
  return row ? parseOutfit(row.outfit) : null;
}
