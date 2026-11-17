import "server-only";
import type { db as appDb } from "@/server/db";
import {
  type CharStatRow,
  emptyKeyFile,
  KEY_FILE_DAYS,
  type KeyFile,
  keyFileOf,
  type PairStatRow,
} from "../view/key-file";

/** Who is looking: only the id matters (ADR 0009); guests have a file too. */
type KeyFileViewer = { id: string } | null;

/** Only the two daily aggregate tables (ADR 0008, ADR 0024): no other table is reachable here. */
type Db = {
  charStatDaily: Pick<typeof appDb.charStatDaily, "groupBy" | "findMany">;
  bigramStatDaily: Pick<typeof appDb.bigramStatDaily, "groupBy">;
};

/** A `@db.Date` value as the stats day key (`YYYY-MM-DD`, stored at 00:00 UTC). */
const dayKeyOf = (day: Date) => day.toISOString().slice(0, 10);

/**
 * The viewer's key file (#961 C5): their own daily aggregates only, in three queries whatever the
 * file's length: the `KEY_FILE_DAYS` latest days with character rows, the character rows of those
 * days, and the letter pairs of the same days summed per pair. `keyFileOf` does the rest. A `null`
 * viewer, or one without a row, gets the empty file.
 */
export async function getKeyFile(
  viewer: KeyFileViewer,
  { db }: { db?: Db } = {},
): Promise<KeyFile> {
  if (!viewer) return emptyKeyFile();
  const client: Db = db ?? (await import("@/server/db")).db;
  const userId = viewer.id;

  const latest = await client.charStatDaily.groupBy({
    by: ["day"],
    where: { userId },
    orderBy: { day: "desc" },
    take: KEY_FILE_DAYS,
  });
  const oldest = latest.at(-1)?.day;
  if (!oldest) return emptyKeyFile();

  const window = { userId, day: { gte: oldest } };
  const [chars, pairs] = await Promise.all([
    client.charStatDaily.findMany({
      where: window,
      select: { day: true, char: true, hits: true, errors: true, timedHits: true, totalMs: true },
    }),
    client.bigramStatDaily.groupBy({
      by: ["pair"],
      where: window,
      _sum: { hits: true, errors: true, timedHits: true, totalMs: true },
    }),
  ]);

  const charRows: CharStatRow[] = chars.map((r) => ({ ...r, day: dayKeyOf(r.day) }));
  const pairRows: PairStatRow[] = pairs.map((p) => ({
    pair: p.pair,
    hits: p._sum.hits ?? 0,
    errors: p._sum.errors ?? 0,
    timedHits: p._sum.timedHits ?? 0,
    totalMs: p._sum.totalMs ?? 0,
  }));
  return keyFileOf(charRows, pairRows);
}
