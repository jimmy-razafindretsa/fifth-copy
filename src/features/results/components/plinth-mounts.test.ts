import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { heldMountState, PODIUM_SETTLE_MS } from "./plinth-mounts";
import { PLINTH_MOUNT_GAP_MS, plinthMountState, type MountSlot } from "./podium-mount";

// #690 C2: the podium holds its first clerk back one gap after it swaps in, so the first software-WebGL
// boot never lands in the swap's own commit; then the #688 queue runs unchanged.
const all: MountSlot[] = [
  { place: 1, frame: true },
  { place: 2, frame: true },
  { place: 3, frame: true },
];

describe("heldMountState (#690 C2)", () => {
  it("the podium settles one plinth gap before the first clerk", () => {
    expect(PODIUM_SETTLE_MS).toBe(PLINTH_MOUNT_GAP_MS);
  });

  it("while settling: nothing mounts and no plinth timer runs, whatever was reported", () => {
    expect(heldMountState(false, all, [])).toEqual({ mounted: [], waiting: null });
    expect(heldMountState(false, all, [{ type: "ready", place: 1 }])).toEqual({
      mounted: [],
      waiting: null,
    });
  });

  it("settled: the #688 queue as is", () => {
    for (const events of [[], [{ type: "ready", place: 1 } as const]]) {
      expect(heldMountState(true, all, events)).toEqual(plinthMountState(all, events));
    }
  });

  it("the provider starts unsettled and settles on one timer from its mount", () => {
    const source = readFileSync(path.join(__dirname, "plinth-mounts.tsx"), "utf8");
    expect(source).toContain("useState(false)");
    expect(source).toContain("setTimeout(() => setSettled(true), PODIUM_SETTLE_MS)");
    expect(source).toContain("heldMountState(settled, slots, events)");
  });
});
