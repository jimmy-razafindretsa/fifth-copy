import { describe, expect, it } from "vitest";
import { bestOffset, clockOffset, pongOffset, remainingTo } from "./clock";

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

// Contract of #643 C1: the `ping`/`pong` refinement (ARCHITECTURE 7.3). A pong's offset assumes the
// server read its clock half way through the round trip; the best of a round is the sample with the
// smallest round trip (the least room for an asymmetric path). Both pure.
describe("pongOffset (#643 C1)", () => {
  it.each([
    ["server ahead, 80 ms round trip", 1_000, 1_540, 1_080, 500],
    ["server behind, 40 ms round trip", 1_000, 270, 1_040, -750],
    ["zero round trip: the welcome formula", 1_000, 1_000, 1_000, 0],
  ])("%s: serverNow - (sent + receivedAt) / 2", (_, sent, serverNow, receivedAt, offset) => {
    expect(pongOffset(sent, serverNow, receivedAt)).toBe(offset);
    expect(pongOffset(sent, serverNow, receivedAt)).toBe(serverNow - (sent + receivedAt) / 2);
  });

  it("an odd round trip keeps the half millisecond", () => {
    expect(pongOffset(0, 100, 1)).toBe(99.5);
  });
});

describe("bestOffset (#643 C1)", () => {
  it("returns the offset of the sample with the smallest round trip", () => {
    const samples = [
      { sent: 0, serverNow: 600, receivedAt: 200 }, // rtt 200 -> 500
      { sent: 100, serverNow: 620, receivedAt: 140 }, // rtt 40 -> 500
      { sent: 200, serverNow: 790, receivedAt: 260 }, // rtt 60 -> 560
    ];
    expect(bestOffset(samples)).toBe(pongOffset(100, 620, 140));
    // order does not matter
    expect(bestOffset([...samples].reverse())).toBe(pongOffset(100, 620, 140));
  });

  it("a tie keeps the first sample", () => {
    expect(
      bestOffset([
        { sent: 0, serverNow: 50, receivedAt: 20 },
        { sent: 100, serverNow: 900, receivedAt: 120 },
      ]),
    ).toBe(40);
  });

  it("no sample: null", () => {
    expect(bestOffset([])).toBeNull();
  });

  it("is pure: the input is not mutated", () => {
    const samples = Object.freeze([Object.freeze({ sent: 0, serverNow: 10, receivedAt: 4 })]);
    expect(bestOffset(samples)).toBe(8);
    expect(bestOffset(samples)).toBe(8);
  });
});
