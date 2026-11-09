import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DefaultPortrait, portraitVariant } from "./default-portrait";

// #60 C1: the stamped portrait is a pure function of its seed: same seed, same SVG; the variant is
// hash(seed) mod 4; every colour is a token role (`var(--color-...)`), never a raw value.

const html = (seed: string, size = 64) => renderToStaticMarkup(<DefaultPortrait seed={seed} size={size} />);

describe("DefaultPortrait", () => {
  it("renders the same inline SVG for the same seed", () => {
    expect(html("cuid_sparrow_482")).toBe(html("cuid_sparrow_482"));
    expect(html("cuid_sparrow_482")).toMatchSnapshot();
  });

  it("picks one of four variants from the seed and covers all four", () => {
    const seeds = Array.from({ length: 64 }, (_, i) => `user-${i}`);
    const variants = new Set(seeds.map(portraitVariant));
    expect([...variants].sort()).toEqual([0, 1, 2, 3]);
    for (const seed of seeds) expect(html(seed)).toContain(`data-variant="${portraitVariant(seed)}"`);
  });

  it("differs across seeds of different variants", () => {
    const seeds = Array.from({ length: 16 }, (_, i) => `seed-${i}`);
    const a = seeds.find((s) => portraitVariant(s) === 0)!;
    const b = seeds.find((s) => portraitVariant(s) === 1)!;
    expect(html(a)).not.toBe(html(b));
  });

  it("uses only token colours", () => {
    for (let i = 0; i < 8; i++) {
      const svg = html(`colour-${i}`);
      expect(svg).toMatch(/^<svg/);
      expect(svg).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(svg).not.toMatch(/rgb|hsl/i);
      const paints = [...svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]);
      for (const paint of paints) expect(paint).toMatch(/^(none|var\(--color-[a-z-]+\))$/);
    }
  });

  it("is sized and decorative unless labelled", () => {
    expect(html("x", 32)).toMatch(/width="32" height="32"/);
    expect(html("x")).toContain('aria-hidden="true"');
    const labelled = renderToStaticMarkup(<DefaultPortrait seed="x" size={64} label="Lynx-101" />);
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Lynx-101"');
  });
});
