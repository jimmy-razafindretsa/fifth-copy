import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Contract of #11: the seven brand vectors of public/brand/ and the Assets table of docs/design/logo.md.
const root = process.cwd();
const brandDir = path.join(root, "public/brand");
const guide = readFileSync(path.join(root, "docs/design/logo.md"), "utf8");

const INK = "#2A2420";
const RED = "#B81D24";
const PAPER = "#F1E8D6";
const FORBIDDEN = ["#1E1B2E", "#3E3934", "#4B453E"];

/** The asset facts (#12, #13): exact hex set per file, and whether it is a monogram. */
const ASSETS: Record<string, { hexes: string[]; monogram: boolean }> = {
  "wordmark-red-on-paper.svg": { hexes: [INK, RED, PAPER], monogram: false },
  "wordmark-ink-on-red.svg": { hexes: [INK, PAPER], monogram: false },
  "wordmark-red-on-ink.svg": { hexes: [RED, PAPER], monogram: false },
  "wordmark-tagline-red-on-paper.svg": { hexes: [INK, RED, PAPER], monogram: false },
  "monogram-paper.svg": { hexes: [INK, RED, PAPER], monogram: true },
  "monogram-red.svg": { hexes: [INK, RED, PAPER], monogram: true },
  "monogram-ink.svg": { hexes: [INK, RED, PAPER], monogram: true },
};

type Point = [number, number];

/** Minimal XML well-formedness check: one root, balanced tags, quoted attributes, no stray markup. */
function parseXml(src: string): string[] {
  const names: string[] = [];
  const stack: string[] = [];
  let roots = 0;
  const token =
    /<\?[^>]*\?>|<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>|([^<]+)|(<)/g;
  for (const m of src.matchAll(token)) {
    const [, close, name, , selfClose, text, stray] = m;
    if (stray) throw new Error(`malformed markup at ${m.index}`);
    if (text !== undefined) {
      if (text.trim() && stack.length === 0) throw new Error("text outside the root element");
      continue;
    }
    if (!name) continue;
    if (close) {
      if (stack.pop() !== name) throw new Error(`unbalanced </${name}>`);
      continue;
    }
    if (stack.length === 0 && ++roots > 1) throw new Error("more than one root element");
    names.push(name);
    if (!selfClose) stack.push(name);
  }
  if (stack.length) throw new Error(`unclosed <${stack.join("><")}>`);
  if (roots !== 1) throw new Error("no root element");
  return names;
}

function viewBox(svg: string): number[] {
  const m = svg.match(/<svg\b[^>]*\sviewBox="([^"]+)"/);
  if (!m?.[1]) throw new Error("no viewBox");
  return m[1].trim().split(/\s+/).map(Number);
}

type Bar = [Point, Point, Point, Point, Point];

/** The bar: the only path whose d is a closed 5-point polygon `M x y L x y L x y L x y L x y`. */
function bar(svg: string): Bar {
  const num = String.raw`(-?[\d.]+) (-?[\d.]+)`;
  const shape = new RegExp(String.raw`^M${num}(?:L${num}){4}$`);
  const bars = [...svg.matchAll(/\sd="([^"]+)"/g)]
    .map((m) => m[1] ?? "")
    .filter((d) => shape.test(d));
  if (bars.length !== 1) throw new Error(`expected one bar polygon, found ${bars.length}`);
  return [...bars.join("").matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]) as Bar;
}

/** Bar height = length of the bar's vertical right edge (points 2 to 3), in viewBox units. */
const barHeight = ([, b, c]: Bar) => Math.abs(c[1] - b[1]);
/** Slant of the bar's bottom-left to top-right edge (points 1 to 2), degrees, positive = up. */
const barAngle = ([a, b]: Bar) => (Math.atan2(a[1] - b[1], b[0] - a[0]) * 180) / Math.PI;

const read = (file: string) => readFileSync(path.join(brandDir, file), "utf8");

describe("brand assets (public/brand)", () => {
  it("holds exactly the seven brand vectors", () => {
    const files = readdirSync(brandDir).filter((f) => f.endsWith(".svg"));
    expect(files.sort()).toEqual(Object.keys(ASSETS).sort());
  });

  describe.each(Object.entries(ASSETS))("%s", (file, { hexes, monogram }) => {
    const svg = read(file);

    it("parses as XML and contains only svg, title and path", () => {
      const names = parseXml(svg);
      expect(names[0]).toBe("svg");
      expect(new Set(names)).toEqual(new Set(["svg", "title", "path"]));
    });

    it(`has a viewBox${monogram ? " (square)" : ""}`, () => {
      const vb = viewBox(svg);
      expect(vb).toHaveLength(4);
      expect(vb.every(Number.isFinite)).toBe(true);
      if (monogram) expect(vb[2]).toBe(vb[3]);
    });

    it("is vector-only and small", () => {
      for (const banned of ["base64", "fill-rule", "evenodd", "mask"])
        expect(svg).not.toContain(banned);
      expect(statSync(path.join(brandDir, file)).size).toBeLessThan((monogram ? 8 : 20) * 1024);
    });

    it("uses exactly its brand hex set and no night ground", () => {
      const found = new Set([...svg.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0].toUpperCase()));
      expect([...found].sort()).toEqual([...hexes].sort());
      for (const hex of FORBIDDEN) expect(svg.toUpperCase()).not.toContain(hex);
    });

    it("has one bar polygon slanting up at 8.0 degrees", () => {
      expect(Math.abs(barAngle(bar(svg)) - 8.0)).toBeLessThanOrEqual(0.5);
    });
  });
});

describe("docs/design/logo.md Assets table", () => {
  const section = guide.split(/^## /m).find((s) => s.startsWith("Assets")) ?? "";
  const table = section
    .split("\n")
    .filter((l) => l.startsWith("|"))
    .map((l) => l.split("|").map((c) => c.trim().replace(/`/g, "")));
  const header = (table[0] ?? []).map((c) => c.toLowerCase());
  const col = (name: string) => header.findIndex((c) => c.startsWith(name));
  const rows = table
    .filter((r) => r.some((c) => c.includes("public/brand/")))
    .map((r) => ({
      file: r[col("file")] ?? "",
      viewBox: (r[col("viewbox")] ?? "").split(/\s+/).map(Number),
      barHeight: Number(r[col("bar height")]),
    }));

  it("has an Assets section with file, viewBox and bar height columns", () => {
    expect(section).not.toBe("");
    expect(col("file")).toBeGreaterThan(0);
    expect(col("viewbox")).toBeGreaterThan(0);
    expect(col("bar height")).toBeGreaterThan(0);
  });

  it("lists exactly the seven files, each existing", () => {
    for (const { file } of rows) {
      expect(file).toMatch(/^public\/brand\/[a-z-]+\.svg$/);
      expect(existsSync(path.join(root, file))).toBe(true);
    }
    expect(rows.map((r) => path.basename(r.file)).sort()).toEqual(Object.keys(ASSETS).sort());
  });

  it.each(rows)("$file: viewBox and bar height match the SVG", (row) => {
    const svg = read(path.basename(row.file));
    const vb = viewBox(svg);
    expect(row.viewBox).toHaveLength(4);
    row.viewBox.forEach((v, i) => expect(Math.abs(v - (vb[i] ?? NaN))).toBeLessThanOrEqual(1));
    expect(Math.abs(row.barHeight - barHeight(bar(svg)))).toBeLessThanOrEqual(1);
  });
});
