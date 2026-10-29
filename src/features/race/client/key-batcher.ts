import { keystrokeSchema, MAX_KEYS_PER_BATCH } from "@fifth-copy/protocol";
import type { Keystroke } from "./prediction";

/** How long a keystroke may wait before it leaves (ARCHITECTURE 7.2: `keys` carries <= 50 ms of keys). */
export const KEY_BATCH_MS = 50;

/** The timers the batcher schedules its flush with (injected in tests). */
export type BatchTimer = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

const deviceTimer: BatchTimer = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type KeyBatcherOptions = {
  flushMs?: number;
  /** Ms since GO on the corrected clock: negative before GO, when nothing is accepted. */
  now: () => number;
  timer?: BatchTimer;
};

export type KeyBatcher = {
  /** Queues a keystroke; `false` (dropped) before GO, after `close`, or when the wire would refuse it. */
  push(keystroke: Keystroke): boolean;
  /** Sends what is queued now. */
  flush(): void;
  /** The desk is done (its own finish, or the page leaves): sends what is queued, then refuses all. */
  close(): void;
};

/**
 * Groups keystrokes into `keys` batches (#559 C2, ADR 0006): the first key after a pause leaves on the
 * next task, later ones wait until `flushMs` after the previous flush, so batches are at most every
 * `flushMs` and no key waits longer. When the timer is starved (the seat scene shares the main thread,
 * ADR 0017), the next keystroke after the flush fell due sends the queue synchronously (#695 C3), so no key
 * waits past the next keystroke and batches stay at least `flushMs` apart. Each batch is a valid
 * protocol `keys` batch: only keystrokes `keystrokeSchema` accepts, at most `MAX_KEYS_PER_BATCH` per
 * batch, in typing order.
 */
export function createKeyBatcher(
  send: (batch: Keystroke[]) => void,
  { flushMs = KEY_BATCH_MS, now, timer = deviceTimer }: KeyBatcherOptions,
): KeyBatcher {
  let queue: Keystroke[] = [];
  let pending: unknown = null;
  /** When the pending flush is due (ms since GO). */
  let due = Infinity;
  let lastFlush = -Infinity;
  let closed = false;

  function flush() {
    if (pending !== null) timer.clearTimeout(pending);
    pending = null;
    if (queue.length === 0) return;
    const keys = queue;
    queue = [];
    lastFlush = now();
    for (let i = 0; i < keys.length; i += MAX_KEYS_PER_BATCH) {
      send(keys.slice(i, i + MAX_KEYS_PER_BATCH));
    }
  }

  return {
    push(keystroke) {
      if (closed || now() < 0) return false;
      const parsed = keystrokeSchema.safeParse(keystroke);
      if (!parsed.success) return false;
      queue.push({ t: parsed.data.t, key: parsed.data.key });
      const at = now();
      if (pending === null) {
        due = Math.max(at, lastFlush + flushMs);
        pending = timer.setTimeout(flush, due - at);
      } else if (at > due) {
        // #695 C3: the timer is overdue (a heavy frame on the shared main thread starves the timer
        // queue): this keystroke takes what waits along, now, instead of waiting behind the frames
        flush();
      }
      return true;
    },
    flush,
    close() {
      flush();
      closed = true;
    },
  };
}
