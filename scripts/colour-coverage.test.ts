import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { Rgb } from "@/lib/color";
import { measure } from "./colour-coverage";
import {
  candidates,
  classify,
  formatLine,
  parseBrand,
  warn,
  type Shares,
} from "./lib/colour-coverage";

// Contract of #15 C8-C12: the colour coverage check against bible 3.1 (paper 55 / red 28 / ink 10 / violet 5 / gold 2).
const root = path.join(__dirname, "..");
const brand = parseBrand(fs.readFileSync(path.join(root, "docs/design/tokens.css"), "utf8"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coverage-"));

/** Writes a 100x100 PNG made of horizontal stripes: [colour, percent of rows]. */
async function png(name: string, stripes: [Rgb, number][]): Promise<string> {
  const w = 100;
  const h = 100;
  const raw = Buffer.alloc(w * h * 3);
  let row = 0;
  for (const [c, pct] of stripes) {
    for (let r = 0; r < pct; r++, row++) {
      for (let x = 0; x < w; x++) raw.set(c, (row * w + x) * 3);
    }
  }
  expect(row).toBe(h);
  const file = path.join(tmp, name);
  await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toFile(file);
  return file;
}

const shift = (c: Rgb, d: number): Rgb => [
  Math.min(255, Math.max(0, c[0] + d)),
  Math.min(255, Math.max(0, c[1] + d)),
  Math.min(255, Math.max(0, c[2] + d)),
];
const b = (name: string): Rgb => {
  const c = brand[name];
  if (!c) throw new Error(`no --brand-${name}`);
  return c;
};

describe("C9 brand palette from tokens.css", () => {
  it("parses the fifteen --brand-* hexes", () => {
    expect(Object.keys(brand)).toHaveLength(15);
    expect(b("paper")).toEqual([241, 232, 214]);
    expect(b("agit-red")).toEqual([184, 29, 36]);
  });

  it("keeps both script files free of hex literals", () => {
    for (const f of ["scripts/colour-coverage.ts", "scripts/lib/colour-coverage.ts"]) {
      expect(fs.readFileSync(path.join(root, f), "utf8"), f).not.toMatch(/#[0-9A-Fa-f]{6}/);
    }
  });
});

describe("C8 classification", () => {
  const light = candidates(brand, false);
  const dark = candidates(brand, true);

  it("buckets each pixel to the nearest brand colour within sRGB distance 48", () => {
    expect(classify(b("newsprint"), light)).toBe("paper");
    expect(classify(b("tape-paper"), light)).toBe("paper");
    expect(classify(b("night-panel"), dark)).toBe("paper");
    expect(classify(b("banner"), light)).toBe("red");
    expect(classify(shift(b("agit-red"), 20), light)).toBe("red");
    expect(classify(b("ribbon-violet"), light)).toBe("violet");
    expect(classify(b("medal-gold"), light)).toBe("gold");
    expect(classify(b("press-ink"), light)).toBe("ink");
    expect(classify(b("backroom-grey"), light)).toBe("other");
    expect(classify(b("phosphor"), light)).toBe("other");
    expect(classify([0, 0, 255], light)).toBe("other");
  });

  it("counts night-ink and night-muted as ink only in dark files", () => {
    expect(classify(b("night-ink"), dark)).toBe("ink");
    expect(classify(b("night-muted"), dark)).toBe("ink");
    expect(classify(b("night-muted"), light)).not.toBe("ink");
  });

  it("measures a synthetic PNG of known composition within 2 points", async () => {
    const file = await png("target-light.png", [
      [shift(b("paper"), -6), 40],
      [b("newsprint"), 15],
      [b("agit-red"), 20],
      [shift(b("banner"), 10), 8],
      [b("press-ink"), 10],
      [b("ribbon-violet"), 4],
      [b("medal-gold"), 2],
      [[0, 0, 255], 1],
    ]);
    const s = await measure(file, brand);
    const want: Shares = { paper: 55, red: 28, ink: 10, violet: 4, gold: 2, other: 1 };
    for (const k of Object.keys(want) as (keyof Shares)[]) {
      expect(Math.abs(s[k] - want[k]), k).toBeLessThanOrEqual(2);
    }
    expect(warn(s)).toEqual([]);
  });

  it("uses the dark rule from the file name", async () => {
    const stripes: [Rgb, number][] = [
      [b("night"), 60],
      [b("night-ink"), 40],
    ];
    const darkFile = await png("screen-dark.png", stripes);
    expect((await measure(darkFile, brand)).ink).toBeCloseTo(40, 0);
  });
});

describe("C10 warnings", () => {
  const base: Shares = { paper: 55, red: 28, ink: 10, violet: 5, gold: 2, other: 0 };

  it("warns when red or paper is more than 15 points off target, or gold above 6", () => {
    expect(warn(base)).toEqual([]);
    expect(warn({ ...base, paper: 70.5, red: 12.5 })).toEqual(["paper", "red"]);
    expect(warn({ ...base, paper: 70, red: 13 })).toEqual([]);
    expect(warn({ ...base, paper: 39 })).toEqual(["paper"]);
    expect(warn({ ...base, gold: 6.5 })).toEqual(["gold"]);
  });

  it("formats one line per file with a WARN <role> suffix per role", () => {
    expect(formatLine("a.png", base)).toBe(
      "a.png paper 55% red 28% ink 10% violet 5% gold 2% other 0%",
    );
    expect(formatLine("a.png", { ...base, paper: 90, red: 0 })).toBe(
      "a.png paper 90% red 0% ink 10% violet 5% gold 2% other 0% WARN paper WARN red",
    );
  });
});

describe("C10 C12 CLI", () => {
  const cli = path.join(__dirname, "colour-coverage.ts");
  const tsx = path.join(root, "node_modules", ".bin", "tsx");
  const exec = (args: string[]) => {
    try {
      return { code: 0, out: execFileSync(tsx, [cli, ...args], { encoding: "utf8" }) };
    } catch (e) {
      const err = e as { status: number; stdout: string };
      return { code: err.status, out: err.stdout };
    }
  };

  it("prints one line per file; exits 0 on warnings unless --strict", async () => {
    const good = await png("good.png", [
      [b("paper"), 55],
      [b("agit-red"), 28],
      [b("press-ink"), 10],
      [b("ribbon-violet"), 5],
      [b("medal-gold"), 2],
    ]);
    const bad = await png("bad.png", [[b("paper"), 100]]);
    const loose = exec([good, bad]);
    expect(loose.code).toBe(0);
    const lines = loose.out.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/good\.png paper 55% red 28% ink 10% violet 5% gold 2% other 0%$/);
    expect(lines[1]).toMatch(/bad\.png paper 100% .* WARN paper WARN red$/);
    expect(exec(["--strict", good]).code).toBe(0);
    expect(exec(["--strict", good, bad]).code).toBe(1);
  }, 30_000);
});
