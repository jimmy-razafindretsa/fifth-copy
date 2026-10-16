import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { Countdown, countdownStep, GO_STAMP_MS, nextStepIn } from "./countdown";

// #214 C3 at unit level: the step the seat shows for the time left to GO (3, 2, 1, the GO stamp, then
// nothing 1.2 s after GO), when it next changes, and the markup of each step. The live countdown on the
// server clock, the slam, reduced motion and the layout are e2e/race/countdown.spec.ts.
describe("countdownStep (#214 C3)", () => {
  it.each([
    [5_000, 3],
    [3_000, 3],
    [2_001, 3],
    [2_000, 2],
    [1_001, 2],
    [1_000, 1],
    [1, 1],
    [0, "go"],
    [-1, "go"],
    [-(GO_STAMP_MS - 1), "go"],
    [-GO_STAMP_MS, null],
    [-30_000, null],
  ] as const)("%i ms to GO -> %s", (msToGo, step) => {
    expect(countdownStep(msToGo)).toBe(step);
  });

  it("the GO stamp stays 1.2 s", () => {
    expect(GO_STAMP_MS).toBe(1_200);
  });
});

describe("nextStepIn (#214 C3)", () => {
  it.each([
    [3_000, 1_000],
    [2_500, 500],
    [2_000, 1_000],
    [1, 1],
    [0, GO_STAMP_MS],
    [-600, 600],
    [-GO_STAMP_MS, null],
  ] as const)("%i ms to GO: the step changes in %s ms", (msToGo, next) => {
    expect(nextStepIn(msToGo)).toBe(next);
  });

  it("lands exactly on the next step", () => {
    for (const msToGo of [3_000, 2_750, 2_000, 1_200, 999, 1, 0, -400]) {
      const next = nextStepIn(msToGo)!;
      expect(countdownStep(msToGo - next), String(msToGo)).not.toBe(countdownStep(msToGo));
      expect(countdownStep(msToGo - next + 1), String(msToGo)).toBe(countdownStep(msToGo));
    }
  });
});

describe("Countdown (#214 C3)", () => {
  const html = (step: Parameters<typeof Countdown>[0]["step"], labels = en.race.countdown) =>
    renderToStaticMarkup(<Countdown step={step} labels={labels} />);

  it.each([3, 2, 1] as const)(
    "%i: one digit in the display-lg role, hidden from assistive tech",
    (n) => {
      const out = html(n);
      expect(out).toMatch(new RegExp(`^<div data-countdown="${n}" aria-hidden="true"`));
      expect(out).toMatch(
        new RegExp(`<span data-digit="${n}" class="type-display-lg [^"]+">${n}</span>`),
      );
      expect(out).not.toContain("data-stamp-tone");
    },
  );

  it("GO: the red lg Stamp at a fixed -6 degrees, the Major's word tagged Russian, no live region", () => {
    const out = html("go");
    expect(out).toContain('data-countdown="go"');
    expect(out).toContain('data-stamp-tone="red"');
    expect(out).toContain('data-stamp-size="lg"');
    expect(out).toContain('data-stamp-angle="-6"');
    expect(out).toContain('<span lang="ru">НАЧАЛИ</span> · GO');
    expect(out).not.toContain("role=");
    expect(out).not.toContain("data-digit");
  });

  it("French: НАЧАЛИ · PARTEZ", () => {
    expect(html("go", fr.race.countdown)).toContain('<span lang="ru">НАЧАЛИ</span> · PARTEZ');
    expect(html("go", fr.race.countdown)).not.toContain("GO<");
  });

  it("the digits slam on the slam token and stop under both reduced-motion selectors", () => {
    const css = readFileSync(path.join(__dirname, "countdown.module.css"), "utf8");
    expect(css).toMatch(
      /animation:\s*fcSlam var\(--motion-duration-slam\) var\(--motion-ease-slam\)/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.digit\s*\{\s*animation: none;/,
    );
    expect(css).toMatch(/\[data-motion="reduce"\] \.digit\s*\{\s*animation: none;/);
    expect(css).toMatch(/overflow: clip/);
  });
});
