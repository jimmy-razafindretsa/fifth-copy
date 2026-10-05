import { describe, expect, it } from "vitest";
import { nextDesk } from "./desks";

describe("nextDesk", () => {
  it.each([
    [[], 1],
    [[1, 2, 3], 4],
    [[1, 3], 2],
    [[2], 1],
    [[1, 1, 2], 3],
    [[3, 1], 2],
  ])("taken %j -> %i", (taken, expected) => {
    expect(nextDesk(taken)).toBe(expected);
  });
});
