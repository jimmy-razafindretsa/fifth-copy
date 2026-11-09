import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import type { Job } from "./job";
import { createPgAdvisoryLocks, type AdvisoryLocks } from "./locks";
import { createScheduler } from "./scheduler";

// #733 C2: advisory-lock scheduler against the test database (ADR 0003, 0011).
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const silent = { info: () => undefined, error: () => undefined };
const RUN = randomUUID().slice(0, 8);
let n = 0;
const jobName = (label: string) => `t${RUN}-${label}-${n++}`;

describe.skipIf(!testDatabaseUrl)("scheduler (needs TEST_DATABASE_URL)", () => {
  let db: ReturnType<typeof createPrismaClient>;
  const opened: AdvisoryLocks[] = [];
  const locks = () => {
    const l = createPgAdvisoryLocks(testDatabaseUrl!);
    opened.push(l);
    return l;
  };

  beforeAll(() => {
    db = createPrismaClient(testDatabaseUrl!);
  });
  afterAll(async () => {
    await db.jobRun.deleteMany({ where: { name: { startsWith: `t${RUN}-` } } });
    await Promise.all(opened.map((l) => l.close()));
    await db.$disconnect();
  });

  it("runs a due job, writes an OK JobRun and releases its lock", async () => {
    let runs = 0;
    const job: Job = { name: jobName("ok"), every: { minutes: 5 }, run: async () => void runs++ };
    const lockA = locks();
    const s = createScheduler({ db, locks: lockA, jobs: [job], log: silent });
    await s.tick();

    expect(runs).toBe(1);
    const rows = await db.jobRun.findMany({ where: { name: job.name } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "OK", error: null });
    expect(rows[0]!.finishedAt).not.toBeNull();
    // Released: another session takes the same lock at once.
    const other = locks();
    expect(await other.tryLock(job.name)).toBe(true);
    await other.unlock(job.name);
  });

  it("two schedulers on the same DB run a due job once", async () => {
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const job: Job = {
      name: jobName("once"),
      every: { minutes: 5 },
      run: async () => {
        runs++;
        await gate;
      },
    };
    const a = createScheduler({ db, locks: locks(), jobs: [job], log: silent });
    const b = createScheduler({ db, locks: locks(), jobs: [job], log: silent });
    const first = a.tick();
    // Let A claim the lock and start the job, then B ticks while A still runs.
    await waitFor(() => runs === 1);
    await b.tick();
    release();
    await first;
    // B again after A finished: the run is no longer due.
    await b.tick();

    expect(runs).toBe(1);
    expect(await db.jobRun.count({ where: { name: job.name } })).toBe(1);
  });

  it("runs the job again only once `every` has passed", async () => {
    let runs = 0;
    let clock = new Date("2026-11-09T12:00:00Z");
    const job: Job = {
      name: jobName("every"),
      every: { minutes: 5 },
      run: async () => void runs++,
    };
    const s = createScheduler({ db, locks: locks(), jobs: [job], log: silent, now: () => clock });
    await s.tick();
    clock = new Date("2026-11-09T12:04:59Z");
    await s.tick();
    expect(runs).toBe(1);
    clock = new Date("2026-11-09T12:05:00Z");
    await s.tick();
    expect(runs).toBe(2);
  });

  it("a throwing job records FAILED with its message and the scheduler keeps running", async () => {
    let okRuns = 0;
    let clock = new Date("2026-11-09T13:00:00Z");
    const bad: Job = {
      name: jobName("bad"),
      every: { minutes: 1 },
      run: async () => {
        throw new Error("boom: disk full");
      },
    };
    const good: Job = {
      name: jobName("good"),
      every: { minutes: 1 },
      run: async () => void okRuns++,
    };
    const s = createScheduler({
      db,
      locks: locks(),
      jobs: [bad, good],
      log: silent,
      now: () => clock,
    });

    await s.tick();
    clock = new Date("2026-11-09T13:01:00Z");
    await s.tick();

    const failed = await db.jobRun.findMany({ where: { name: bad.name } });
    expect(failed).toHaveLength(2);
    for (const row of failed) {
      expect(row.status).toBe("FAILED");
      expect(row.error).toBe("boom: disk full");
      expect(row.finishedAt).not.toBeNull();
    }
    expect(okRuns).toBe(2);
    // Lock released after the failure too.
    const other = locks();
    expect(await other.tryLock(bad.name)).toBe(true);
    await other.unlock(bad.name);
  });

  it("stop() waits for the running job to finish", async () => {
    let release!: () => void;
    let started = false;
    const gate = new Promise<void>((r) => (release = r));
    const job: Job = {
      name: jobName("stop"),
      every: { minutes: 5 },
      run: async () => {
        started = true;
        await gate;
      },
    };
    const s = createScheduler({ db, locks: locks(), jobs: [job], log: silent, tickMs: 60_000 });
    s.start();
    await waitFor(() => started);
    let stopped = false;
    const stopping = s.stop().then(() => (stopped = true));
    await new Promise((r) => setTimeout(r, 50));
    expect(stopped).toBe(false);
    release();
    await stopping;
    const row = await db.jobRun.findFirstOrThrow({ where: { name: job.name } });
    expect(row.status).toBe("OK");
  });
});

async function waitFor(cond: () => boolean, ms = 5000) {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}
