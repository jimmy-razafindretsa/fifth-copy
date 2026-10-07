import { describe, expect, it } from "vitest";
import { durationsFor } from "./durations";

// C5: the fast-clock e2e mode (ADR 0012 testing table) scales every lifecycle duration by 1/10.
describe("durations", () => {
  it("uses the spec durations by default", () => {
    expect(durationsFor({ RACE_FAST_CLOCK: "0" })).toEqual({ COUNTDOWN_MS: 3000 });
  });

  it("divides every duration by 10 when RACE_FAST_CLOCK=1", () => {
    expect(durationsFor({ RACE_FAST_CLOCK: "1" })).toEqual({ COUNTDOWN_MS: 300 });
  });
});
