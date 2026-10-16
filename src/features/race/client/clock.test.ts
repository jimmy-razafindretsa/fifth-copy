import { describe, expect, it } from "vitest";
import { clockOffset, remainingTo } from "./clock";

// Contract of #214 C1 (the clock half): the countdown runs on the server clock (ADR 0006, ARCHITECTURE
// 7.3). `clockOffset` turns this device's clock into the server's from a `welcome.serverNow`;
// `remainingTo` is the delay until GO on that corrected clock. Both pure, no `Date.now()` inside.
describe("clockOffset (#214 C1)", () => {
  it.each([
    ["the device is behind the server", 1_767_225_600_500, 1_767_225_600_000, 500],
    ["the device is ahead of the server", 1_767_225_600_000, 1_767_225_600_750, -750],
    ["both clocks agree", 1_767_225_600_000, 1_767_225_600_000, 0],
  ])("%s: serverNow - receivedAt", (_, serverNow, receivedAt, offset) => {
    expect(clockOffset(serverNow, receivedAt)).toBe(offset);
    // the corrected clock reads the server's time at the moment of receipt
    expect(receivedAt + clockOffset(serverNow, receivedAt)).toBe(serverNow);
  });
});

describe("remainingTo (#214 C1)", () => {
  const t0 = 1_767_225_603_000;

  it.each([
    ["the whole countdown ahead", t0 - 3_000, 3_000],
    ["mid-countdown", t0 - 1_250, 1_250],
    ["at GO", t0, 0],
    ["after GO (a late page): never negative", t0 + 4_000, 0],
  ])("%s", (_, now, remaining) => {
    expect(remainingTo(t0, now)).toBe(remaining);
  });

  it("is pure: same input, same output", () => {
    expect(remainingTo(t0, t0 - 10)).toBe(remainingTo(t0, t0 - 10));
    expect(clockOffset(5, 3)).toBe(clockOffset(5, 3));
  });
});
