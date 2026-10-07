import fs from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  APPLE_ICON,
  checkIcons,
  FAVICON,
  ICON_SVG,
  paper,
  pngSize,
  rasterise,
  readIco,
  SOURCE,
  writeIco,
} from "./icons";

describe("ICO writer", () => {
  it("round-trips PNG frames with their sizes in the directory", async () => {
    const svg = fs.readFileSync(SOURCE);
    const frames = await Promise.all([16, 32].map((s) => rasterise(svg, s)));
    const ico = writeIco(frames);
    const read = readIco(ico);
    expect(read.map((f) => [f.width, f.height])).toEqual([
      [16, 16],
      [32, 32],
    ]);
    expect(read[1]!.png.equals(frames[1]!)).toBe(true);
  });

  it("refuses a payload that is not a PNG", () => {
    expect(() => writeIco([Buffer.from("nope, not a png at all")])).toThrow(/not a PNG/);
  });
});

// #24 C5: the committed site icons come from public/brand/monogram-paper.svg.
describe("src/app site icons", () => {
  it("hold: icon.svg byte-identical, apple-icon 180x180, favicon 16 and 32", () => {
    expect(checkIcons()).toEqual([]);
    expect(fs.readFileSync(ICON_SVG).equals(fs.readFileSync(SOURCE))).toBe(true);
    expect(pngSize(fs.readFileSync(APPLE_ICON))).toEqual({ width: 180, height: 180 });
    expect(readIco(fs.readFileSync(FAVICON)).map((f) => f.width)).toEqual([16, 32]);
  });

  it("apple-icon is opaque, its corners flattened on paper", async () => {
    const { data, info } = await sharp(APPLE_ICON).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels === 3 || data.every((v, i) => i % 4 !== 3 || v === 255)).toBe(true);
    const corner = [...data.subarray(0, 3)];
    paper().forEach((v, i) => expect(Math.abs(v - corner[i]!)).toBeLessThanOrEqual(2));
  });

  it("favicon frames keep transparent corners", async () => {
    for (const { png } of readIco(fs.readFileSync(FAVICON))) {
      const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(data[3]).toBe(0);
    }
  });
});
