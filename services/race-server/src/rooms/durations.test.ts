import { describe, expect, it } from "vitest";
import { durationsFor } from "./durations";

// C5 (#166): the fast-clock e2e mode (ADR 0012 testing table) scales every lifecycle duration by 1/10.
// #178 C6: the reconnection grace (spec 7.4: 2 minutes) lives in the same table and scales with it.
// #814 C2: a public room's automatic start (45 s, owner decision 2026-11-04), 4 500 ms fast.
// #183 C6: the idle warning (45 s) and kick (60 s) of spec 4.5 too (4 500 / 6 000 ms fast).
// #926 C2: the readiness barrier's hard limit (30 s), 3 000 ms fast.
describe("durations", () => {
  it("uses the spec durations by default", () => {
    expect(durationsFor({ RACE_FAST_CLOCK: "0" })).toEqual({
      COUNTDOWN_MS: 3000,
      GRACE_MS: 120_000,
      IDLE_WARN_MS: 45_000,
      IDLE_KICK_MS: 60_000,
      AUTO_START_MS: 45_000,
      LOAD_LIMIT_MS: 30_000,
    });
  });

  it("divides every duration by 10 when RACE_FAST_CLOCK=1", () => {
    expect(durationsFor({ RACE_FAST_CLOCK: "1" })).toEqual({
      COUNTDOWN_MS: 300,
      GRACE_MS: 12_000,
      IDLE_WARN_MS: 4_500,
      IDLE_KICK_MS: 6_000,
      AUTO_START_MS: 4_500,
      LOAD_LIMIT_MS: 3_000,
    });
  });

  it("RACE_GRACE_MS (e2e only, #868) sets the grace alone, with or without the fast clock", () => {
    expect(durationsFor({ RACE_FAST_CLOCK: "0", RACE_GRACE_MS: 20_000 })).toEqual({
      ...durationsFor({ RACE_FAST_CLOCK: "0" }),
      GRACE_MS: 20_000,
    });
    expect(durationsFor({ RACE_FAST_CLOCK: "1", RACE_GRACE_MS: 20_000 })).toEqual({
      ...durationsFor({ RACE_FAST_CLOCK: "1" }),
      GRACE_MS: 20_000,
    });
  });
});
