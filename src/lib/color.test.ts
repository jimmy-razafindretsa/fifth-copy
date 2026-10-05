import { describe, expect, it } from "vitest";
import { contrastRatio, mixSrgb, parseHex } from "./color";

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
