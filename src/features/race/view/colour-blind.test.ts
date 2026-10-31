import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DESK_COLORS, MARKERS, deskIdentity } from "@fifth-copy/protocol";
import { CVD_MATRICES, deltaE76, lab, linearRgb, simulate, type Deficiency } from "@/lib/color";

// Contract of #565 C3 (R80, ARCHITECTURE 10): the twelve rival inks of each theme, as declared in
// docs/design/tokens.css, stay apart for colour-blind viewers. Each ink goes linear sRGB -> Machado 2009
// (severity 1) -> CIELAB D65; every pair of inks that share a marker shape keeps CIE76 >= 12. The
// minimum per simulation is logged (`console.info`) for the card log, work/log/565.md.

const css = readFileSync(path.join(process.cwd(), "docs/design/tokens.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** The `--t-rival-N` hexes of the first block opened by `selector` (one nesting level is enough). */
function inks(selector: string, from = 0): string[] {
  const start = css.indexOf(`${selector} {`, from);
  if (start < 0) throw new Error(`no block ${selector}`);
  const body = css.slice(start, css.indexOf("}", start));
  return Array.from({ length: DESK_COLORS }, (_, i) => {
    const m = new RegExp(`--t-rival-${i}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(body);
    if (!m?.[1]) throw new Error(`--t-rival-${i} missing in ${selector}`);
    return m[1];
  });
}

/** The first `:root {` block that declares the rival inks is the light theme (the motion :root has none). */
function lightInks(): string[] {
  let from = 0;
  for (;;) {
    const at = css.indexOf(":root {", from);
    if (at < 0) throw new Error("no light rival inks");
    if (css.slice(at, css.indexOf("}", at)).includes("--t-rival-0")) return inks(":root", at);
    from = at + 1;
  }
}

const SETS = {
  light: lightInks(),
  night: inks(':root[data-theme="dark"]'),
} as const;

const SIMULATIONS = Object.keys(CVD_MATRICES) as Deficiency[];
const MIN_DELTA_E = 12;

/** Ink indices that share a marker shape somewhere on the 30-desk ring (the allocator, #156). */
function sameShapePairs(): [number, number][] {
  const byShape = new Map<string, Set<number>>();
  for (let desk = 1; desk <= 30; desk++) {
    const { color, marker } = deskIdentity(desk);
    byShape.set(marker, (byShape.get(marker) ?? new Set()).add(color));
  }
  const pairs = new Set<string>();
  for (const colors of byShape.values()) {
    const list = [...colors].sort((a, b) => a - b);
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) pairs.add(`${list[i]},${list[j]}`);
  }
  return [...pairs].map((p) => p.split(",").map(Number) as [number, number]);
}

function minimum(hexes: readonly string[], kind: Deficiency | "normal") {
  const labs = hexes.map((h) =>
    lab(kind === "normal" ? linearRgb(h) : simulate(kind, linearRgb(h))),
  );
  let min = { dE: Infinity, a: -1, b: -1 };
  for (const [a, b] of sameShapePairs()) {
    const dE = deltaE76(labs[a]!, labs[b]!);
    if (dE < min.dE) min = { dE, a, b };
  }
  return min;
}

describe("#565 C3 colour-blind simulation of the rival inks", () => {
  it("every ink is a circle on desks 1-12: all twelve share a shape, so every pair is checked", () => {
    expect(MARKERS[0]).toBe("circle");
    expect(sameShapePairs()).toHaveLength((DESK_COLORS * (DESK_COLORS - 1)) / 2);
  });

  for (const [theme, hexes] of Object.entries(SETS)) {
    it(`${theme}: CIE76 >= ${MIN_DELTA_E} between same-shape inks under protanopia, deuteranopia and tritanopia`, () => {
      expect(new Set(hexes).size).toBe(DESK_COLORS);
      const line: string[] = [];
      for (const kind of ["normal", ...SIMULATIONS] as const) {
        const min = minimum(hexes, kind);
        line.push(`${kind} ${min.dE.toFixed(2)} (rival-${min.a}/rival-${min.b})`);
        if (kind !== "normal") {
          expect(min.dE, `${theme} ${kind} rival-${min.a}/rival-${min.b}`).toBeGreaterThanOrEqual(
            MIN_DELTA_E,
          );
        }
      }
      console.info(`#565 C3 ${theme} min CIE76: ${line.join(", ")}`);
    });
  }

  it("control: a red and a green a protanope confuses fall under the bar (the matrices are applied)", () => {
    const min = minimum(["#B0413E", "#6E8B3D", ...SETS.light.slice(2)], "protanopia");
    expect(min.dE).toBeLessThan(MIN_DELTA_E);
  });
});
