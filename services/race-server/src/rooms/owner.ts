import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { Scheduler, TimerHandle } from "../clock";
import { instanceKey } from "./keys";

/** Lifetime of a process's lease (#704); a killed process's rooms are orphaned this long at most. */
export const LEASE_TTL_MS = 30_000;
/** Refresh period: a third of the TTL, so two missed refreshes still keep the lease. */
export const LEASE_REFRESH_MS = 10_000;

export type OwnerLease = {
  readonly id: string;
  /** Writes the lease and keeps refreshing it on the scheduler. */
  start(): Promise<void>;
  /** Whether the process `id` still holds its lease. */
  alive(id: string): Promise<boolean>;
  /** Stops refreshing and deletes the lease (a clean exit hands its rooms over at once). */
  stop(): Promise<void>;
};

/**
 * Liveness of the race-server process (#704): Railway runs the new deployment next to the draining
 * one on the same Redis, so the races of a process are voided on boot only when it is gone.
 */
export function createOwnerLease({
  redis,
  scheduler,
  id = randomUUID(),
}: {
  redis: Redis;
  scheduler: Scheduler;
  id?: string;
}): OwnerLease {
  let timer: TimerHandle | null = null;
  let stopped = false;
  const write = () => redis.set(instanceKey(id), "1", "PX", LEASE_TTL_MS);
  const refresh = () => {
    timer = scheduler.setTimeout(() => {
      if (stopped) return;
      refresh();
      write().catch((err: unknown) =>
        console.log(
          JSON.stringify({ level: "info", msg: "lease refresh failed", err: String(err) }),
        ),
      );
    }, LEASE_REFRESH_MS);
  };
  return {
    id,
    async start() {
      await write();
      refresh();
    },
    alive: async (other) => (await redis.exists(instanceKey(other))) === 1,
    async stop() {
      stopped = true;
      if (timer) scheduler.clear(timer);
      timer = null;
      await redis.del(instanceKey(id)).catch(() => undefined);
    },
  };
}
