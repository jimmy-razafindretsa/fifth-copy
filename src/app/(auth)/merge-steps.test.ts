import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// #36: the sign-in and sign-up actions run in the (auth) route graph, so every feature that registers a
// guest-merge step (src/features/<feature>/merge-step(s).ts, #56) must be imported there, or
// mergeGuestInto fails closed on a fresh `next dev` route.
const FEATURES = path.resolve(__dirname, "../../features");

describe("(auth) merge-step imports (#36)", () => {
  it("imports every feature that registers a guest-merge step", () => {
    const source = readFileSync(path.join(__dirname, "merge-steps.ts"), "utf8");
    const features = readdirSync(FEATURES, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .filter((d) =>
        readdirSync(path.join(FEATURES, d.name)).some((f) => /^merge-steps?\.ts$/.test(f)),
      )
      .map((d) => d.name);
    expect(features.length).toBeGreaterThan(0);
    for (const feature of features) expect(source).toContain(`import "@/features/${feature}";`);
  });
});
