import { pathToFileURL } from "node:url";
import { env } from "@/env";
import { db } from "@/server/db";
import { logger } from "@/server/logger";
import type { JobLogger } from "./job";
import { createPgAdvisoryLocks } from "./locks";
import { jobs } from "./registry";
import { createScheduler, type Scheduler } from "./scheduler";

/**
 * The worker process (ADR 0011, #733): `npm run dev:worker` (tsx) or `npm run start:worker` (the
 * esbuild bundle, scripts/build-worker.mjs). It loads the validated env, runs the jobs of
 * registry.ts through the advisory-lock scheduler, and listens on no port. SIGTERM (Railway
 * redeploy) or SIGINT lets the running job finish, closes the connections and exits 0.
 */
export type WorkerProcess = {
  once: (signal: "SIGTERM" | "SIGINT", listener: () => void) => unknown;
  exit: (code: number) => void;
};

export type WorkerDeps = {
  scheduler: Scheduler;
  proc: WorkerProcess;
  /** Closes the database and lock connections after the scheduler stopped. */
  close: () => Promise<void>;
  log: JobLogger;
};

export function runWorker({ scheduler, proc, close, log }: WorkerDeps): void {
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("worker: stopping", { signal });
    void scheduler
      .stop()
      .then(close)
      .then(
        () => {
          log.info("worker: stopped", { signal });
          proc.exit(0);
        },
        (err: unknown) => {
          log.error("worker: stop failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          proc.exit(1);
        },
      );
  };
  proc.once("SIGTERM", () => shutdown("SIGTERM"));
  proc.once("SIGINT", () => shutdown("SIGINT"));
  scheduler.start();
  log.info("worker: started", { jobs: jobs.map((j) => j.name).join(",") });
}

function main() {
  const locks = createPgAdvisoryLocks(env.DATABASE_URL);
  const log: JobLogger = { info: logger.info, error: logger.error };
  runWorker({
    scheduler: createScheduler({ db, locks, jobs, log }),
    proc: process,
    close: async () => {
      await locks.close();
      await db.$disconnect();
    },
    log,
  });
}

// Run only as the entry point (tsx src/worker/main.ts or the bundle), never when a test imports it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
