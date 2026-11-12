import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Contract of #639 C1: the lobby's notice pulse never dips below 0.75 on text, so ink keeps 4.5:1 at the
// dip in light and Night shift (bible 3.3, 7.4 notice row, 8). The computed pulse and axe run in
// e2e/lobby.spec.ts (C6).
const css = readFileSync(
  path.join(process.cwd(), "src/features/lobby/components/lobby.module.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

describe("lobby.module.css lkPulse (#639 C1)", () => {
  it("dips to opacity 0.75, never lower", () => {
    const keyframes = css.match(/@keyframes lkPulse \{([\s\S]*?\})\s*\}/);
    expect(keyframes).not.toBeNull();
    const opacities = [...keyframes![1]!.matchAll(/opacity:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    expect(opacities).toEqual([0.75]);
  });

  it("keeps the pulsing notice (.pulse) on lkPulse 1.3s and still under reduced motion", () => {
    expect(css).toMatch(/\.pulse \{[^}]*animation: lkPulse 1\.3s ease-in-out infinite;/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.pulse \{\s*animation: none;/,
    );
    expect(css).toMatch(/\[data-motion="reduce"\] \.pulse \{\s*animation: none;/);
  });

  // #105: the notice row itself is a statement (WAITING FOR THE HOST) and never pulses
  it("the plain .notice carries no animation", () => {
    expect(css).toMatch(/\.notice \{[^}]*\}/);
    expect(/\.notice \{([^}]*)\}/.exec(css)![1]).not.toContain("animation");
  });
});
