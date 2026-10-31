import { describe, expect, it } from "vitest";
import {
  PLINTH_MOUNT_GAP_MS,
  plinthMountState,
  type MountEvent,
  type MountSlot,
} from "./podium-mount";

// Contract of #688 C4: the plinth frames mount one at a time in place order 1, 2, 3; the next mounts once
// the previous is ready or its gap elapsed; frameless slots (UNFILLED, UNDER REVIEW) count as ready.
const all: MountSlot[] = [
  { place: 1, frame: true },
  { place: 2, frame: true },
  { place: 3, frame: true },
];
const ready = (place: 1 | 2 | 3): MountEvent => ({ type: "ready", place });
const timeout = (place: 1 | 2 | 3): MountEvent => ({ type: "timeout", place });

describe("plinthMountState (#688 C4)", () => {
  it("waits 2 s at most per plinth", () => {
    expect(PLINTH_MOUNT_GAP_MS).toBe(2_000);
  });

  it.each<[string, MountSlot[], MountEvent[], (1 | 2 | 3)[], 1 | 2 | 3 | null]>([
    ["nothing reported: only the first", all, [], [1], 1],
    ["first ready: the second", all, [ready(1)], [1, 2], 2],
    ["first and second ready: all three", all, [ready(1), ready(2)], [1, 2, 3], 3],
    ["all ready: nothing waits", all, [ready(1), ready(2), ready(3)], [1, 2, 3], null],
    ["the first timed out: the second mounts anyway", all, [timeout(1)], [1, 2], 2],
    ["timeout then ready", all, [timeout(1), ready(2)], [1, 2, 3], 3],
    ["signals out of order (3 before 2)", all, [ready(1), ready(3)], [1, 2], 2],
    ["out of order, then 2 arrives", all, [ready(3), ready(1), ready(2)], [1, 2, 3], null],
    ["a late ready after a timeout changes nothing", all, [timeout(1), ready(1)], [1, 2], 2],
    [
      "an UNFILLED or UNDER REVIEW slot has no frame and counts as ready",
      [
        { place: 1, frame: true },
        { place: 2, frame: false },
        { place: 3, frame: true },
      ],
      [ready(1)],
      [1, 3],
      3,
    ],
    [
      "the first slot frameless: the second mounts at once",
      [
        { place: 1, frame: false },
        { place: 2, frame: true },
        { place: 3, frame: true },
      ],
      [],
      [2],
      2,
    ],
    [
      "no frame at all",
      [
        { place: 1, frame: false },
        { place: 2, frame: false },
        { place: 3, frame: false },
      ],
      [],
      [],
      null,
    ],
  ])("%s", (_name, slots, events, mounted, waiting) => {
    expect(plinthMountState(slots, events)).toEqual({ mounted, waiting });
  });

  it("never lets more than one mounted plinth wait", () => {
    const sequences: MountEvent[][] = [[], [ready(1)], [timeout(1)], [ready(1), timeout(2)]];
    for (const events of sequences) {
      const { mounted } = plinthMountState(all, events);
      const pending = mounted.filter((p) => !events.some((e) => e.place === p));
      expect(pending.length, JSON.stringify(events)).toBeLessThanOrEqual(1);
    }
  });
});
