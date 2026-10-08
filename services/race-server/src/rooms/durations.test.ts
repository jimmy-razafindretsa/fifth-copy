import { describe, expect, it } from "vitest";
import { durationsFor } from "./durations";

// C5 (#166): the fast-clock e2e mode (ADR 0012 testing table) scales every lifecycle duration by 1/10.
// #178 C6: the reconnection grace (spec 7.4: 2 minutes) lives in the same table and scales with it.
// #183 C6: the idle warning (45 s) and kick (60 s) of spec 4.5 too (4 500 / 6 000 ms fast).
describe("durations", () => {
  it("uses the spec durations by default", () => {
    expect(durationsFor({ RACE_FAST_CLOCK: "0" })).toEqual({
      COUNTDOWN_MS: 3000,
      GRACE_MS: 120_000,
      IDLE_WARN_MS: 45_000,
      IDLE_KICK_MS: 60_000,
    });
  });

  it("divides every duration by 10 when RACE_FAST_CLOCK=1", () => {
    expect(durationsFor({ RACE_FAST_CLOCK: "1" })).toEqual({
      COUNTDOWN_MS: 300,
      GRACE_MS: 12_000,
      IDLE_WARN_MS: 4_500,
      IDLE_KICK_MS: 6_000,
    });
  });
});
