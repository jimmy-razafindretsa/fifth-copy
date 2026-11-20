import "server-only";
import { dayKey } from "@/lib/time";
import type { db as appDb } from "@/server/db";
import type { CharStatRow } from "../view/key-file";
import { type Callout, calloutsOf, calloutWeeks } from "./rule";

/** Who is looking: only the id matters (ADR 0009); guests have a file too. */
type CalloutsViewer = { id: string } | null;

/** Only the daily character aggregates (ADR 0008, ADR 0024): no other table is reachable here. */
type Db = { charStatDaily: Pick<typeof appDb.charStatDaily, "findMany"> };

/**
 * The viewer's improvement callouts (#999 C48): their own `CharStatDaily` rows of the last two stats
 * weeks in one query, then the pure rule (`rule.ts`). A visitor has none. Flagged results never reach
 * these rows (the rollup counts only counted results), so nothing here filters again.
 */
export async function getCallouts(
  viewer: CalloutsViewer,
  { db, now = new Date() }: { db?: Db; now?: Date } = {},
): Promise<Callout[]> {
  if (!viewer) return [];
  const client: Db = db ?? (await import("@/server/db")).db;
  const today = dayKey(now);
  const { lastWeek } = calloutWeeks(today);
  const rows = await client.charStatDaily.findMany({
    where: { userId: viewer.id, day: { gte: new Date(`${lastWeek}T00:00:00Z`) } },
    select: { day: true, char: true, hits: true, errors: true, timedHits: true, totalMs: true },
  });
  const charRows: CharStatRow[] = rows.map((r) => ({
    ...r,
    day: r.day.toISOString().slice(0, 10),
  }));
  return calloutsOf(charRows, today);
}
