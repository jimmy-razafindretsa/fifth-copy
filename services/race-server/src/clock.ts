/** The race server's single time source (ms since epoch). Injected so tests and the fast-clock e2e mode control it. */
export type Clock = { now(): number };

export const systemClock: Clock = { now: () => Date.now() };

export type FakeClock = Clock & { advance(ms: number): void };

export function createFakeClock(startMs = 0): FakeClock {
  let t = startMs;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

/** Opaque handle of a scheduled callback. */
export type TimerHandle = { readonly timer: unknown };

/**
 * Deferred callbacks on the same time base as `Clock` (the room lifecycle's GO and timer end,
 * #166). In-process only: a restart voids running rooms (ADR 0008, #204).
 */
export type Scheduler = {
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clear(handle: TimerHandle): void;
};

export const systemScheduler: Scheduler = {
  setTimeout: (fn, ms) => ({ timer: setTimeout(fn, Math.max(0, ms)) }),
  clear: (handle) => clearTimeout(handle.timer as ReturnType<typeof setTimeout>),
};

/**
 * A scheduler driven by `clock.advance`: advancing fires every due callback in time order (ties in
 * scheduling order), with the clock set to each callback's instant while it runs. Wraps `advance`.
 */
/** A `Scheduler` whose `armed()` counts the callbacks still pending (tests assert cleanup). */
export type FakeScheduler = Scheduler & { armed(): number };

export function createFakeScheduler(clock: FakeClock): FakeScheduler {
  type Pending = { at: number; seq: number; fn: () => void };
  const pending = new Set<Pending>();
  let seq = 0;
  const step = clock.advance.bind(clock);

  clock.advance = (ms) => {
    const target = clock.now() + ms;
    for (;;) {
      const next = [...pending]
        .filter((p) => p.at <= target)
        .sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!next) break;
      pending.delete(next);
      if (next.at > clock.now()) step(next.at - clock.now());
      next.fn();
    }
    if (target > clock.now()) step(target - clock.now());
  };

  return {
    setTimeout: (fn, ms) => {
      const entry: Pending = { at: clock.now() + Math.max(0, ms), seq: seq++, fn };
      pending.add(entry);
      return { timer: entry };
    },
    clear: (handle) => void pending.delete(handle.timer as Pending),
    armed: () => pending.size,
  };
}
