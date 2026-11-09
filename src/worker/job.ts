import type { PrismaClient } from "@/generated/prisma/client";

/**
 * The shape of a background job (ADR 0011, #733). A job module lives in its feature's `jobs/` folder,
 * exports one `Job`, and is listed in `src/worker/registry.ts`; nothing else changes to add one.
 * Jobs are idempotent and bounded: a crashed or repeated run must be safe to run again.
 */
export type Duration = { seconds?: number; minutes?: number; hours?: number; days?: number };

export type JobLogger = {
  info: (msg: string, fields?: Record<string, string | number | boolean | null>) => void;
  error: (msg: string, fields?: Record<string, string | number | boolean | null>) => void;
};

export type JobContext = {
  /** The Prisma client the worker owns. */
  db: PrismaClient;
  /** The scheduler's clock at the start of the run (injected in tests). */
  now: Date;
  log: JobLogger;
};

export type Job = {
  /** Unique, stable name: the advisory lock key and `JobRun.name`. */
  name: string;
  /** Minimum time between two run starts. */
  every: Duration;
  run: (ctx: JobContext) => Promise<void>;
};

export function durationMs(d: Duration): number {
  const ms =
    ((d.days ?? 0) * 24 * 60 * 60 +
      (d.hours ?? 0) * 60 * 60 +
      (d.minutes ?? 0) * 60 +
      (d.seconds ?? 0)) *
    1000;
  if (!Number.isFinite(ms) || ms <= 0) throw new Error("job duration must be positive");
  return ms;
}
