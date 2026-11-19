import { describe, expect, it } from "vitest";
import { median, parseArgs } from "./lighthouse";

// #999 C58: the Lighthouse runner's arguments and its median (the measurement itself needs a build).
describe("lighthouse runner", () => {
  it("reads the route, runs, min and a local base url", () => {
    expect(parseArgs(["/", "--runs", "5", "--min", "90"])).toEqual({
      route: "/",
      runs: 5,
      min: 90,
      url: null,
    });
    expect(parseArgs(["/welcome", "--url", "http://localhost:5999"])).toMatchObject({
      route: "/welcome",
      runs: 5,
      min: 90,
      url: "http://localhost:5999",
    });
  });

  it("refuses a missing route, bad counts and a non-local url", () => {
    expect(() => parseArgs([])).toThrow(/missing route/);
    expect(() => parseArgs(["/", "--runs", "0"])).toThrow(/--runs/);
    expect(() => parseArgs(["/", "--min", "101"])).toThrow(/--min/);
    expect(() => parseArgs(["/", "--url", "https://example.com"])).toThrow(/local origin/);
    expect(() => parseArgs(["/", "/welcome"])).toThrow(/unexpected/);
  });

  it("takes the middle score, or the mean of the two middle ones", () => {
    expect(median([88, 100, 91, 95, 72])).toBe(91);
    expect(median([90, 80])).toBe(85);
    expect(() => median([])).toThrow(RangeError);
  });
});
