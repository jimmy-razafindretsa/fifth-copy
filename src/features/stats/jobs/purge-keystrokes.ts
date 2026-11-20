import { Prisma } from "@/generated/prisma/client";
import { addDays, dayKey } from "@/lib/time";
import type { Job, JobContext } from "@/worker/job";

/** Raw keystrokes leave 30 days after their race (docs/privacy/retention.md, ADR 0008, #315 C1). */
export const RAW_KEYSTROKES_RETENTION_DAYS = 30;

/**
 * A result's speed curve (`RaceResult.wpmSeries`) is cleared 30 days after it was filed, with the raw
 * keystrokes it comes from (retention.md "Race speed curves", ADR 0027, #999); the row stays.
 */
export const SPEED_CURVE_RETENTION_DAYS = 30;

/** Daily letter-pair stats leave 90 days after their stats day (retention.md, ADR 0024, #315 C2). */
export const LETTER_PAIR_RETENTION_DAYS = 90;

/** The most rows one delete statement removes (#315 C3). */
export const PURGE_BATCH = 1000;

/** The most delete statements one run sends, both tables together (#315 C3): bounded work per run. */
export const PURGE_MAX_BATCHES = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

export type PurgeOptions = {
  /** Rows per delete statement; `PURGE_BATCH` by default. */
  batch?: number;
  /** Narrows the rows a run sees (tests sharing a database scope runs to their own typists). */
  userIds?: string[];
};

/**
 * One purge run (#315, ADR 0008, 0011, 0024). Deletes every `RaceKeystrokes` row created more than
 * `RAW_KEYSTROKES_RETENTION_DAYS` before `now`, rolled up or not (the published promise has no
 * condition), then clears the `wpmSeries` of every `RaceResult` filed more than
 * `SPEED_CURVE_RETENTION_DAYS` before `now` (ADR 0027: the row and its figures stay), then every
 * `BigramStatDaily` row whose day is more than `LETTER_PAIR_RETENTION_DAYS` before the stats day of `now`. Each batch is one atomic DELETE of at most `batch` rows, so a crash
 * between batches leaves only rows that were due anyway, and the next run carries on. `Race` and
 * `CharStatDaily` are never touched, nor any `RaceResult` field but `wpmSeries`. One log line of counts; no id, name or content.
 */
export async function purgeExpiredStats(
  { db, now, log }: JobContext,
  { batch = PURGE_BATCH, userIds }: PurgeOptions = {},
): Promise<void> {
  const scope = userIds ? Prisma.sql`AND "userId" = ANY(${userIds}::text[])` : Prisma.empty;
  const keysBefore = new Date(now.getTime() - RAW_KEYSTROKES_RETENTION_DAYS * DAY_MS);
  const seriesBefore = new Date(now.getTime() - SPEED_CURVE_RETENTION_DAYS * DAY_MS);
  const pairsBefore = addDays(dayKey(now), -LETTER_PAIR_RETENTION_DAYS);

  let batches = 0;
  let raceKeystrokes = 0;
  let neverRolledUp = 0;
  let wpmSeries = 0;
  let bigramStatDaily = 0;

  while (batches < PURGE_MAX_BATCHES) {
    batches += 1;
    const [gone = { deleted: 0, unrolled: 0 }] = await db.$queryRaw<
      { deleted: number; unrolled: number }[]
    >`
      WITH gone AS (
        DELETE FROM "RaceKeystrokes" WHERE ("raceId", "desk") IN (
          SELECT "raceId", "desk" FROM "RaceKeystrokes"
          WHERE "createdAt" < ${keysBefore} ${scope}
          LIMIT ${batch}
        )
        RETURNING "rolledUpAt"
      )
      SELECT count(*)::int AS deleted, count(*) FILTER (WHERE "rolledUpAt" IS NULL)::int AS unrolled
      FROM gone`;
    raceKeystrokes += gone.deleted;
    neverRolledUp += gone.unrolled;
    if (gone.deleted < batch) break;
  }

  while (batches < PURGE_MAX_BATCHES) {
    batches += 1;
    const cleared = await db.$executeRaw`
      UPDATE "RaceResult" SET "wpmSeries" = NULL WHERE "id" IN (
        SELECT "id" FROM "RaceResult"
        WHERE "createdAt" < ${seriesBefore} AND "wpmSeries" IS NOT NULL ${scope}
        LIMIT ${batch}
      )`;
    wpmSeries += cleared;
    if (cleared < batch) break;
  }

  while (batches < PURGE_MAX_BATCHES) {
    batches += 1;
    const [gone = { deleted: 0 }] = await db.$queryRaw<{ deleted: number }[]>`
      WITH gone AS (
        DELETE FROM "BigramStatDaily" WHERE ("userId", "day", "pair") IN (
          SELECT "userId", "day", "pair" FROM "BigramStatDaily"
          WHERE "day" < ${pairsBefore}::date ${scope}
          LIMIT ${batch}
        )
        RETURNING 1
      )
      SELECT count(*)::int AS deleted FROM gone`;
    bigramStatDaily += gone.deleted;
    if (gone.deleted < batch) break;
  }

  log.info("stats purged", { raceKeystrokes, neverRolledUp, wpmSeries, bigramStatDaily, batches });
}

/**
 * `stats.purge` (#315, ADR 0011): every hour, the three retention periods of
 * docs/privacy/retention.md are enforced, at most `PURGE_MAX_BATCHES` x `PURGE_BATCH` rows per run.
 * Run only by the worker (src/worker/registry.ts).
 */
export const purgeKeystrokes: Job = {
  name: "stats.purge",
  every: { hours: 1 },
  run: (ctx) => purgeExpiredStats(ctx),
};
