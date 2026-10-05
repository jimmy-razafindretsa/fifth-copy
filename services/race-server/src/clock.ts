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
