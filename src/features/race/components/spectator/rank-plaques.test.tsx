import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import {
  overtakers,
  placePlaques,
  plaqueRows,
  RankPlaques,
  type PlaqueNode,
  type PlaqueRow,
} from "./rank-plaques";

// Contract of #999 C4 and C5 at unit level (bible 14.3 "Projector view", 8): the rank plaques are HTML
// (no text in WebGL), one per desk with its rank, desk number and name; they are placed from the scene's
// anchors through their nodes' style (no React state per frame), hidden when their desk has no anchor
// (off screen); an overtake or a new leader flips the overtaker's chip with `--motion-duration-slam`,
// never a literal duration, and both reduce selectors stop it.

const labels = en.race.projector;

describe("plaqueRows", () => {
  it("lists every desk of the roster by desk number with the server's live rank", () => {
    const members = [
      { desk: 5, name: "Lynx-105" },
      { desk: 1, name: "Lynx-101" },
      { desk: 3, name: "Lynx-103" },
    ];
    expect(plaqueRows(members, [3, 5, 1])).toEqual([
      { desk: 1, rank: 3, name: "Lynx-101" },
      { desk: 3, rank: 1, name: "Lynx-103" },
      { desk: 5, rank: 2, name: "Lynx-105" },
    ]);
    expect(plaqueRows(members, []).map((r) => r.rank)).toEqual([null, null, null]);
  });
});

describe("RankPlaques markup", () => {
  const rows: PlaqueRow[] = [
    { desk: 1, rank: 2, name: "Lynx-101" },
    { desk: 7, rank: 1, name: "Lynx-107" },
    { desk: 9, rank: null, name: "Lynx-109" },
  ];

  it("one chip per desk: rank, DESK 07 and the name, as HTML text; hidden until anchored", () => {
    const html = renderToStaticMarkup(<RankPlaques rows={rows} labels={labels} />);
    const plaques = html.match(/data-plaque="\d+"/g) ?? [];
    expect(plaques).toEqual(['data-plaque="1"', 'data-plaque="7"', 'data-plaque="9"']);
    expect(html).toContain("02");
    expect(html).toContain("DESK 07");
    expect(html).toContain("Lynx-107");
    expect(html).toContain(labels.noPlace); // desk 9 has no rank yet
    expect(html.match(/visibility:hidden/g)).toHaveLength(3);
    expect(html).not.toContain("<canvas");
  });

  it("speaks French from the catalog", () => {
    const html = renderToStaticMarkup(<RankPlaques rows={rows} labels={fr.race.projector} />);
    expect(html).toContain("BUREAU 07");
  });
});

describe("placePlaques", () => {
  const node = (): PlaqueNode => ({ style: { transform: "", visibility: "hidden" } });

  it("moves each anchored plaque to its share of the frame and shows it", () => {
    const nodes = new Map([
      [1, node()],
      [7, node()],
    ]);
    placePlaques(nodes, [
      [1, 0.25, 0.5],
      [7, 1, 0],
    ]);
    expect(nodes.get(1)!.style).toEqual({
      transform: "translate(25.00%, 50.00%)",
      visibility: "visible",
    });
    expect(nodes.get(7)!.style).toEqual({
      transform: "translate(100.00%, 0.00%)",
      visibility: "visible",
    });
  });

  it("hides a plaque whose desk is off screen (absent from the anchors), and every plaque on paper", () => {
    const nodes = new Map([
      [1, node()],
      [7, node()],
    ]);
    placePlaques(nodes, [
      [1, 0.25, 0.5],
      [7, 0.5, 0.5],
    ]);
    placePlaques(nodes, [[1, 0.3, 0.5]]);
    expect(nodes.get(1)!.style.visibility).toBe("visible");
    expect(nodes.get(7)!.style.visibility).toBe("hidden");
    placePlaques(nodes, []);
    expect(nodes.get(1)!.style.visibility).toBe("hidden");
  });
});

describe("overtakers (C5)", () => {
  const before = new Map<number, number | null>([
    [1, 1],
    [3, 2],
    [5, 3],
    [7, null],
  ]);

  it("an overtake or a new leader: the desk whose rank number went down", () => {
    expect(
      overtakers(before, [
        { desk: 1, rank: 2, name: "" },
        { desk: 3, rank: 1, name: "" },
        { desk: 5, rank: 3, name: "" },
      ]),
    ).toEqual([3]);
    expect(
      overtakers(before, [
        { desk: 1, rank: 1, name: "" },
        { desk: 3, rank: 3, name: "" },
        { desk: 5, rank: 2, name: "" },
      ]),
    ).toEqual([5]);
  });

  it("no flip for a first rank, a lost place or an unchanged one", () => {
    expect(
      overtakers(before, [
        { desk: 1, rank: 1, name: "" },
        { desk: 3, rank: 2, name: "" },
        { desk: 7, rank: 4, name: "" },
      ]),
    ).toEqual([]);
  });
});

describe("the flip's CSS (C5, bible 8)", () => {
  const css = readFileSync(path.join(__dirname, "rank-plaques.module.css"), "utf8");

  it("reads --motion-duration-slam, never a literal duration", () => {
    expect(css).toMatch(
      /\.plaque\[data-flip\] \{\s*animation: plaque-flip var\(--motion-duration-slam\)/,
    );
    expect(css).not.toMatch(/animation[^;]*\d+m?s/);
    expect(css).not.toContain("!important");
  });

  it("stops under prefers-reduced-motion and <html data-motion=reduce>", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.plaque\[data-flip\] \{\s*animation: none;/,
    );
    expect(css).toMatch(/:root\[data-motion="reduce"\] \.plaque\[data-flip\] \{\s*animation: none;/);
  });

  it("flips with a transform only (one movement, no luminance change: the flash rule)", () => {
    const keyframes = /@keyframes plaque-flip \{[\s\S]*?\n\}/.exec(css)?.[0] ?? "";
    expect(keyframes).toContain("transform");
    expect(keyframes).not.toMatch(/opacity|color|background|filter/);
  });
});
