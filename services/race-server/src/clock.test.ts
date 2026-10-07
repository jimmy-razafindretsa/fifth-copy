import { describe, expect, it } from "vitest";
import { createFakeClock, createFakeScheduler } from "./clock";

describe("fake scheduler", () => {
  it("fires due callbacks in time order on advance, each at its own instant", () => {
    const clock = createFakeClock(1_000);
    const scheduler = createFakeScheduler(clock);
    const fired: [string, number][] = [];
    scheduler.setTimeout(() => fired.push(["b", clock.now()]), 200);
    scheduler.setTimeout(() => fired.push(["a", clock.now()]), 100);
    scheduler.setTimeout(() => fired.push(["c", clock.now()]), 500);

    clock.advance(300);
    expect(fired).toEqual([
      ["a", 1_100],
      ["b", 1_200],
    ]);
    expect(clock.now()).toBe(1_300);
    clock.advance(200);
    expect(fired.at(-1)).toEqual(["c", 1_500]);
  });

  it("never fires a cleared callback, and fires a callback scheduled by another one", () => {
    const clock = createFakeClock(0);
    const scheduler = createFakeScheduler(clock);
    const fired: string[] = [];
    const h = scheduler.setTimeout(() => fired.push("cleared"), 10);
    scheduler.clear(h);
    scheduler.setTimeout(() => {
      fired.push("first");
      scheduler.setTimeout(() => fired.push("chained"), 5);
    }, 10);
    clock.advance(20);
    expect(fired).toEqual(["first", "chained"]);
  });
});
