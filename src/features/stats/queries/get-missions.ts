import "server-only";
import type { db as appDb } from "@/server/db";
import { buildMissions, type Missions } from "../view/missions";
import { countedWhere } from "./counted-where";

/** Who is looking: only the id matters (ADR 0009); guests have missions too. */
type MissionsViewer = { id: string } | null;

type Db = { raceResult: Pick<typeof appDb.raceResult, "findMany"> };

/**
 * Today's mission and the star total of the viewer (#943 C17, ADR 0008): one read of their own counted
 * results (the Personnel file's filter, `countedWhere`), only `createdAt` and `accuracy`. Creates
 * nothing; `null` for no viewer, without a query.
 */
export async function getMissions(
  viewer: MissionsViewer,
  { db, now = new Date() }: { db?: Db; now?: Date } = {},
): Promise<Missions | null> {
  if (!viewer) return null;
  const client: Db = db ?? (await import("@/server/db")).db;
  const rows = await client.raceResult.findMany({
    where: countedWhere(viewer.id),
    select: { createdAt: true, accuracy: true },
  });
  return buildMissions(rows, now);
}
