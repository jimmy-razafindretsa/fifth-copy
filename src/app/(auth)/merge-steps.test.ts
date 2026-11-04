import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { featureMergeStepFiles } from "@/features/identity/testing/merge-steps";

// #36: the sign-in and sign-up actions run in the (auth) route graph, so every feature that registers a
// guest-merge step must be imported there, or mergeGuestInto fails closed on a fresh `next dev` route.
describe("(auth) merge-step imports (#36)", () => {
  it("imports every feature that registers a guest-merge step", () => {
    const source = readFileSync(path.join(__dirname, "merge-steps.ts"), "utf8");
    const features = new Set(featureMergeStepFiles().map((f) => f.split("/")[0]!));
    features.delete("identity"); // the pages import @/features/identity already
    expect(features.size).toBeGreaterThan(0);
    for (const feature of features) expect(source).toContain(`import "@/features/${feature}";`);
  });
});
