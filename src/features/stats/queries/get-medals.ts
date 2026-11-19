import "server-only";
import type { db as appDb } from "@/server/db";
import { type MedalShelf, medalShelf } from "../view/medals";

/** Who is looking: only the id matters (ADR 0009). */
type MedalViewer = { id: string };

type Db = { achievement: Pick<typeof appDb.achievement, "findMany"> };

/**
 * The viewer's enamel pins (#999 C36): their own `Achievement` rows only, then `medalShelf` over the
 * whole catalogue. No viewer (a cookie that no longer resolves): null, the file shows no pins section.
 * Creates nothing; `now` is injected for tests.
 */
export async function getMedals(
  viewer: MedalViewer | null,
  { db, now = new Date() }: { db?: Db; now?: Date } = {},
): Promise<MedalShelf | null> {
  if (!viewer) return null;
  const client: Db = db ?? (await import("@/server/db")).db;
  const awards = await client.achievement.findMany({
    where: { userId: viewer.id },
    select: { achievementId: true, awardedAt: true },
  });
  return medalShelf(awards, now);
}
