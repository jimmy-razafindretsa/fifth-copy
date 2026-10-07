import type { Redis } from "ioredis";
import type { Clock, Scheduler, TimerHandle } from "../clock";
import { OUTBOX_TTL_S, OUTBOXES_KEY, outboxKey } from "../rooms/keys";

/** First retry delay; doubled per failure up to `OUTBOX_MAX_DELAY_MS`. */
export const OUTBOX_FIRST_DELAY_MS = 1_000;
export const OUTBOX_MAX_DELAY_MS = 60_000;

/** Delay before retry `attempt` (0-based): 1 s, 2 s, 4 s ... capped at 60 s. */
export const retryDelayMs = (attempt: number) =>
  Math.min(OUTBOX_FIRST_DELAY_MS * 2 ** Math.min(attempt, 30), OUTBOX_MAX_DELAY_MS);

export type Outbox = {
  /**
   * Stores the entries of `id` (`RPUSH outbox:<id>`, `SADD outboxes <id>`, both with
   * `OUTBOX_TTL_S`, one MULTI), then sends them. Rejects only when Redis refuses the write.
   */
  enqueue(id: string, entries: readonly unknown[]): Promise<void>;
  /** Re-sends every entry of every id listed in `outboxes` (boot, after a restart). */
  drain(): Promise<void>;
  /** Cancels every pending retry; an in-flight send finishes but schedules nothing. */
  close(): void;
};

type Pending = { attempt: number; since: number; running: boolean; timer?: TimerHandle };

const log = (msg: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ level: "info", msg, ...fields }));

/**
 * The durable send queue of ADR 0008 ("Write path at race end"): generic over its entries, which
 * `send` receives parsed from JSON and acknowledges with `true` (any other outcome, a rejection
 * included, is a failure). One id's entries go out one at a time, oldest first; an acknowledged
 * entry leaves the list (`LREM`), a failure retries the id after `retryDelayMs` on the injected
 * scheduler, for up to `OUTBOX_TTL_S` on the clock (then the id is dropped, logged). The keys
 * outlive a restart: `drain` resumes them. Logs ids and attempts only, never an entry.
 */
export function createOutbox({
  redis,
  clock,
  scheduler,
  send,
}: {
  redis: Redis;
  clock: Clock;
  scheduler: Scheduler;
  send: (entry: unknown) => Promise<boolean>;
}): Outbox {
  const pending = new Map<string, Pending>();
  let closed = false;

  async function forget(id: string) {
    pending.delete(id);
    await redis.multi().del(outboxKey(id)).srem(OUTBOXES_KEY, id).exec();
  }

  function retry(id: string, p: Pending) {
    if (closed) return;
    if (clock.now() - p.since >= OUTBOX_TTL_S * 1000) {
      log("outbox gave up", { id, attempts: p.attempt + 1 });
      void forget(id).catch(() => undefined);
      return;
    }
    const delay = retryDelayMs(p.attempt);
    p.attempt += 1;
    log("outbox retry", { id, attempt: p.attempt, delayMs: delay });
    p.timer = scheduler.setTimeout(() => {
      p.timer = undefined;
      void pump(id);
    }, delay);
  }

  /** Sends the id's entries until the list is empty (true) or one fails (false). */
  async function run(id: string, p: Pending): Promise<boolean> {
    const key = outboxKey(id);
    for (;;) {
      if (closed) return true;
      const raw = await redis.lindex(key, 0);
      if (raw === null) {
        await redis.srem(OUTBOXES_KEY, id);
        pending.delete(id);
        return true;
      }
      let entry: unknown;
      try {
        entry = JSON.parse(raw);
      } catch {
        // Never written by this queue: it can never be sent.
        log("outbox dropped unreadable entry", { id });
        await redis.lrem(key, 1, raw);
        continue;
      }
      const ok = await send(entry).catch(() => false);
      if (!ok) return false;
      await redis.lrem(key, 1, raw);
      p.attempt = 0;
    }
  }

  async function pump(id: string): Promise<void> {
    if (closed) return;
    let p = pending.get(id);
    if (!p) {
      p = { attempt: 0, since: clock.now(), running: false };
      pending.set(id, p);
    }
    // Already sending, or waiting for its backoff: that run owns the id.
    if (p.running || p.timer) return;
    p.running = true;
    let done = false;
    try {
      done = await run(id, p);
    } catch (err) {
      if (!closed) log("outbox redis failed", { id, err: String(err) });
    } finally {
      p.running = false;
    }
    if (!done) retry(id, p);
  }

  return {
    async enqueue(id, entries) {
      if (entries.length === 0) return;
      const key = outboxKey(id);
      const results = await redis
        .multi()
        .rpush(key, ...entries.map((e) => JSON.stringify(e)))
        .expire(key, OUTBOX_TTL_S)
        .sadd(OUTBOXES_KEY, id)
        .expire(OUTBOXES_KEY, OUTBOX_TTL_S)
        .exec();
      if (!results) throw new Error(`outbox ${id}: transaction aborted`);
      for (const [err] of results) if (err) throw err;
      void pump(id);
    },

    async drain() {
      const ids = await redis.smembers(OUTBOXES_KEY);
      if (ids.length) log("outbox drain", { ids: ids.length });
      await Promise.all(ids.map((id) => pump(id)));
    },

    close() {
      closed = true;
      for (const p of pending.values()) if (p.timer) scheduler.clear(p.timer);
      pending.clear();
    },
  };
}
