import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  CVD_MATRICES,
  deltaE76,
  hue,
  lab,
  linearRgb,
  mixSrgb,
  parseHex,
  simulate,
} from "./color";

describe("color", () => {
  it("parses hex in any case and short form", () => {
    expect(parseHex("#B81D24")).toEqual([184, 29, 36]);
    expect(parseHex("#b81d24")).toEqual([184, 29, 36]);
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(() => parseHex("red")).toThrow();
  });

  it("mixes in sRGB with integer channels", () => {
    expect(mixSrgb("#2A2420", "#F1E8D6", 0.8)).toEqual([82, 75, 68]); // #524B44
    expect(mixSrgb("#000000", "#ffffff", 0.5)).toEqual([128, 128, 128]);
  });

  it("computes WCAG contrast ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#F1E8D6", "#7E1015")).toBeCloseTo(8.75, 1);
    expect(contrastRatio("#F4ECDC", "#3E3934")).toBeCloseTo(9.72, 1);
    expect(contrastRatio("#CFC6B3", "#3E3934")).toBeCloseTo(6.73, 1);
  });
});

describe("color: hue, CIELAB, CVD simulation (#565)", () => {
  it("reads the HSL hue", () => {
    expect(hue("#B81D24")).toBeCloseTo(357.5, 0);
    expect(hue("#00ff00")).toBe(120);
    expect(hue("#0000ff")).toBe(240);
    expect(hue("#808080")).toBe(0);
  });

  it("converts to CIELAB D65 (reference values)", () => {
    const white = lab(linearRgb("#ffffff"));
    expect(white[0]).toBeCloseTo(100, 2);
    expect(white[1]).toBeCloseTo(0, 2);
    expect(white[2]).toBeCloseTo(0, 2);
    const red = lab(linearRgb("#ff0000"));
    expect(red[0]).toBeCloseTo(53.24, 1);
    expect(red[1]).toBeCloseTo(80.09, 1);
    expect(red[2]).toBeCloseTo(67.2, 1);
    expect(lab(linearRgb("#000000"))[0]).toBeCloseTo(0, 5);
  });

  it("measures CIE76", () => {
    expect(deltaE76([50, 0, 0], [53, 4, 0])).toBe(5);
  });

  it("simulates dichromacy with the Machado 2009 matrices (rows sum to 1: greys stay grey)", () => {
    for (const kind of Object.keys(CVD_MATRICES) as (keyof typeof CVD_MATRICES)[]) {
      for (const row of CVD_MATRICES[kind]) expect(row[0] + row[1] + row[2]).toBeCloseTo(1, 3);
      const grey = simulate(kind, linearRgb("#808080"));
      expect(grey[0]).toBeCloseTo(grey[1], 3);
      expect(grey[1]).toBeCloseTo(grey[2], 3);
    }
    // protanopes and deuteranopes lose red-green: pure red and pure green come close in Lab
    const gap = (kind: keyof typeof CVD_MATRICES) =>
      deltaE76(
        lab(simulate(kind, linearRgb("#cc3333"))),
        lab(simulate(kind, linearRgb("#55aa33"))),
      );
    const normal = deltaE76(lab(linearRgb("#cc3333")), lab(linearRgb("#55aa33")));
    expect(gap("protanopia")).toBeLessThan(normal / 2);
    expect(gap("deuteranopia")).toBeLessThan(normal / 2);
    expect(gap("tritanopia")).toBeGreaterThan(gap("deuteranopia"));
  });
});
