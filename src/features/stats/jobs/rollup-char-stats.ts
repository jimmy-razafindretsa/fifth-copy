import { storedReplay } from "@/features/results/server";
import type { KeyboardLayout, Prisma } from "@/generated/prisma/client";
import { dayKey } from "@/lib/time";
import type { Job, JobContext } from "@/worker/job";
import { countedPopulationWhere } from "../queries/counted-where";
import { traceIncrements, type TraceIncrements } from "./trace-increments";

/** The most `RaceKeystrokes` rows one run rolls up (#314 C1): bounded work per minute. */
export const ROLLUP_BATCH = 200;

/** The layout of a typist who never saved one (#314 C2). */
const DEFAULT_LAYOUT: KeyboardLayout = "CSA";

type Tx = Prisma.TransactionClient;

type Target = { userId: string; day: string; layout: KeyboardLayout; increments: TraceIncrements };

async function addChars(tx: Tx, { userId, day, layout, increments }: Target) {
  const rows = increments.chars;
  if (rows.length === 0) return;
  await tx.$executeRaw`
    INSERT INTO "CharStatDaily" ("userId", "day", "char", "layout", "hits", "errors", "timedHits", "totalMs")
    SELECT ${userId}, ${day}::date, t.k, ${layout}::"KeyboardLayout", t.h, t.e, t.th, t.ms
    FROM unnest(
      ${rows.map((r) => r.char)}::text[], ${rows.map((r) => r.hits)}::int[],
      ${rows.map((r) => r.errors)}::int[], ${rows.map((r) => r.timedHits)}::int[],
      ${rows.map((r) => r.totalMs)}::int[]
    ) AS t(k, h, e, th, ms)
    ON CONFLICT ("userId", "day", "char", "layout") DO UPDATE SET
      "hits" = "CharStatDaily"."hits" + EXCLUDED."hits",
      "errors" = "CharStatDaily"."errors" + EXCLUDED."errors",
      "timedHits" = "CharStatDaily"."timedHits" + EXCLUDED."timedHits",
      "totalMs" = "CharStatDaily"."totalMs" + EXCLUDED."totalMs"`;
}

async function addPairs(tx: Tx, { userId, day, increments }: Target) {
  const rows = increments.pairs;
  if (rows.length === 0) return;
  await tx.$executeRaw`
    INSERT INTO "BigramStatDaily" ("userId", "day", "pair", "hits", "errors", "timedHits", "totalMs")
    SELECT ${userId}, ${day}::date, t.k, t.h, t.e, t.th, t.ms
    FROM unnest(
      ${rows.map((r) => r.pair)}::text[], ${rows.map((r) => r.hits)}::int[],
      ${rows.map((r) => r.errors)}::int[], ${rows.map((r) => r.timedHits)}::int[],
      ${rows.map((r) => r.totalMs)}::int[]
    ) AS t(k, h, e, th, ms)
    ON CONFLICT ("userId", "day", "pair") DO UPDATE SET
      "hits" = "BigramStatDaily"."hits" + EXCLUDED."hits",
      "errors" = "BigramStatDaily"."errors" + EXCLUDED."errors",
      "timedHits" = "BigramStatDaily"."timedHits" + EXCLUDED."timedHits",
      "totalMs" = "BigramStatDaily"."totalMs" + EXCLUDED."totalMs"`;
}

export type RollupOptions = {
  /** Rows per run; `ROLLUP_BATCH` by default. */
  limit?: number;
  /** Narrows the rows a run sees (tests sharing a database scope runs to their own typists). */
  only?: Prisma.RaceKeystrokesWhereInput;
};

/**
 * One rollup run (#314, ADR 0008, 0024): the oldest unrolled `RaceKeystrokes` rows, each in its own
 * transaction that sets `rolledUpAt` and adds the trace's increments to `CharStatDaily` and
 * `BigramStatDaily` (summed on a clashing key), so a trace counts once. A trace counts only when its
 * result does (`countedPopulationWhere`: a human desk, not flagged, finished or timed out, race not
 * voided) and belongs to the trace's typist; otherwise, or when its stored values cannot be replayed
 * (a deterministic failure), it is marked and writes nothing. A failed write rolls its transaction
 * back and leaves the trace for the next run. One log line of counts; no name, id or text.
 */
export async function rollupKeystrokes(
  { db, now, log }: JobContext,
  { limit = ROLLUP_BATCH, only }: RollupOptions = {},
): Promise<void> {
  const batch = await db.raceKeystrokes.findMany({
    where: { rolledUpAt: null, ...only },
    orderBy: [{ createdAt: "asc" }, { raceId: "asc" }, { desk: "asc" }],
    take: limit,
    select: { raceId: true, desk: true, userId: true, data: true, count: true },
  });
  if (batch.length === 0) return;

  const counted = await db.raceResult.findMany({
    where: {
      AND: [countedPopulationWhere(), { OR: batch.map(({ raceId, desk }) => ({ raceId, desk })) }],
    },
    select: {
      raceId: true,
      desk: true,
      userId: true,
      overlay: true,
      createdAt: true,
      race: { select: { textContent: true, settings: true } },
    },
  });
  const resultOf = new Map(counted.map((r) => [`${r.raceId}:${r.desk}`, r]));
  const preferences = await db.preference.findMany({
    where: { userId: { in: [...new Set(batch.map((k) => k.userId))] } },
    select: { userId: true, layout: true },
  });
  const layoutOf = new Map(preferences.map((p) => [p.userId, p.layout]));

  let rolled = 0;
  let skipped = 0;
  let failed = 0;
  for (const trace of batch) {
    const result = resultOf.get(`${trace.raceId}:${trace.desk}`);
    let target: Target | null = null;
    if (result && result.userId === trace.userId) {
      try {
        const replay = storedReplay({
          textContent: result.race.textContent,
          settings: result.race.settings,
          overlay: result.overlay,
          data: trace.data,
          count: trace.count,
        });
        if (replay) {
          target = {
            userId: trace.userId,
            day: dayKey(result.createdAt),
            layout: layoutOf.get(trace.userId) ?? DEFAULT_LAYOUT,
            increments: traceIncrements(replay),
          };
        }
      } catch {
        target = null; // a stored value the engine rejects: never replayable, so skipped
      }
    }
    try {
      const marked = await db.$transaction(async (tx) => {
        const { count } = await tx.raceKeystrokes.updateMany({
          where: { raceId: trace.raceId, desk: trace.desk, rolledUpAt: null },
          data: { rolledUpAt: now },
        });
        if (count === 0) return false; // rolled up meanwhile: nothing to add
        if (target) {
          await addChars(tx, target);
          await addPairs(tx, target);
        }
        return true;
      });
      if (marked && target) rolled += 1;
      else if (marked) skipped += 1;
    } catch {
      failed += 1;
    }
  }
  log.info("char stats rolled up", { rolled, skipped, failed });
}

/**
 * `stats.rollup` (#314, ADR 0011): every minute, the per-key daily stats catch up with the traces
 * stored since, at most `ROLLUP_BATCH` per run. Run only by the worker (src/worker/registry.ts).
 */
export const rollupCharStats: Job = {
  name: "stats.rollup",
  every: { minutes: 1 },
  run: (ctx) => rollupKeystrokes(ctx),
};
