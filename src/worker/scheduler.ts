import type { PrismaClient } from "@/generated/prisma/client";
import { durationMs, type Job, type JobLogger } from "./job";
import type { AdvisoryLocks } from "./locks";

/**
 * The worker's scheduler (ADR 0011, #733). Every tick it walks the registered jobs and, for each due
 * one, claims `pg_try_advisory_lock(hash(name))`, re-checks that it is still due (another replica
 * may have just finished it), writes a RUNNING `JobRun`, runs the job, records OK or FAILED, and
 * releases the lock. A job is due when no run of it started within its `every`. Nothing a job
 * throws stops the loop; a crashed run stays RUNNING in `JobRun` and is retried once it is due.
 */
export type SchedulerDeps = {
  db: PrismaClient;
  locks: AdvisoryLocks;
  jobs: readonly Job[];
  log: JobLogger;
  now?: () => Date;
  /** Time between ticks (ADR 0011: every minute). */
  tickMs?: number;
};

export type Scheduler = {
  /** One pass over the jobs; resolves when every due job has run. Never rejects. */
  tick: () => Promise<void>;
  start: () => void;
  /** Stops ticking and resolves once the running tick (and its job) has finished. */
  stop: () => Promise<void>;
};

const ERROR_MAX = 2000;

export function createScheduler(deps: SchedulerDeps): Scheduler {
  const { db, locks, jobs, log } = deps;
  const now = deps.now ?? (() => new Date());
  const tickMs = deps.tickMs ?? 60_000;
  const names = new Set<string>();
  for (const job of jobs) {
    if (names.has(job.name)) throw new Error(`duplicate job name: ${job.name}`);
    names.add(job.name);
    durationMs(job.every);
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let stopping = false;

  async function isDue(job: Job, at: Date): Promise<boolean> {
    const since = new Date(at.getTime() - durationMs(job.every));
    const recent = await db.jobRun.findFirst({
      where: { name: job.name, startedAt: { gt: since } },
      select: { id: true },
    });
    return recent === null;
  }

  async function runOne(job: Job) {
    if (!(await isDue(job, now()))) return;
    if (!(await locks.tryLock(job.name))) return;
    try {
      const startedAt = now();
      if (!(await isDue(job, startedAt))) return;
      const run = await db.jobRun.create({ data: { name: job.name, startedAt } });
      try {
        await job.run({ db, now: startedAt, log });
        await db.jobRun.update({
          where: { id: run.id },
          data: { status: "OK", finishedAt: now() },
        });
        log.info("worker: job ok", { job: job.name });
      } catch (err) {
        const message = (err instanceof Error ? err.message : String(err)).slice(0, ERROR_MAX);
        await db.jobRun.update({
          where: { id: run.id },
          data: { status: "FAILED", finishedAt: now(), error: message },
        });
        log.error("worker: job failed", { job: job.name, error: message });
      }
    } finally {
      await locks.unlock(job.name);
    }
  }

  async function tick() {
    for (const job of jobs) {
      // On stop, finish the job in hand and skip the rest.
      if (stopping) break;
      try {
        await runOne(job);
      } catch (err) {
        // Database or lock connection trouble: log and try again next tick.
        log.error("worker: tick error", {
          job: job.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  function schedule(delay: number) {
    if (stopping) return;
    timer = setTimeout(() => {
      timer = null;
      running = tick().finally(() => {
        running = null;
        schedule(tickMs);
      });
    }, delay);
  }

  return {
    tick,
    start() {
      stopping = false;
      if (timer === null && running === null) schedule(0);
    },
    async stop() {
      stopping = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (running) await running;
    },
  };
}
