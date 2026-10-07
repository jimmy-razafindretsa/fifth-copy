import { describe, expect, it } from "vitest";
import { durationsFor } from "./durations";

// C5 (#166): the fast-clock e2e mode (ADR 0012 testing table) scales every lifecycle duration by 1/10.
// #178 C6: the reconnection grace (spec 7.4: 2 minutes) lives in the same table and scales with it.
describe("durations", () => {
  it("uses the spec durations by default", () => {
    expect(durationsFor({ RACE_FAST_CLOCK: "0" })).toEqual({
      COUNTDOWN_MS: 3000,
      GRACE_MS: 120_000,
    });
  });

  it("divides every duration by 10 when RACE_FAST_CLOCK=1", () => {
    expect(durationsFor({ RACE_FAST_CLOCK: "1" })).toEqual({ COUNTDOWN_MS: 300, GRACE_MS: 12_000 });
  });
});
