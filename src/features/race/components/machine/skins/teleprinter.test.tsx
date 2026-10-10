import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MachineSkinProps } from "../skin";
import { MachineFrame } from "../typing-machine";
import { MAKER_PLATE, teleprinter } from "./teleprinter";

// Contract of #558 C5: the teleprinter skin draws the owner's compact teleprinter (E4, bible 7.7a) in CSS
// and inline SVG, sized from its own width.
const dir = path.join(process.cwd(), "src/features/race/components/machine/skins");
const css = readFileSync(path.join(dir, "teleprinter.module.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);
const ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";"],
  ["z", "x", "c", "v", "b", "n", "m", ",", ".", "/"],
];
const html = (props: Partial<MachineSkinProps> = {}) =>
  renderToStaticMarkup(<MachineFrame skin={teleprinter} rows={ROWS} {...props} />);

/** The `data-part` names in document order. */
const parts = (markup: string) => [...markup.matchAll(/data-part="([^"]+)"/g)].map((m) => m[1]);
/** The CSS block of one selector (first match). */
const block = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
};

describe("teleprinter parts (#558 C5)", () => {
  it("draws the top panel (slot, reel, plate, dial) then the key deck", () => {
    expect(parts(html())).toEqual(["panel", "slot", "reel", "plate", "dial", "deck"]);
  });

  it("shows the jam X at the printing point only while jammed", () => {
    expect(parts(html({ jammed: true }))).toEqual([
      "panel",
      "slot",
      "reel",
      "jam",
      "plate",
      "dial",
      "deck",
    ]);
    expect(
      html({ jammed: true })
        .match(/data-part="jam"[^]*?<\/svg>/)?.[0]
        .match(/<line/g),
    ).toHaveLength(2);
  });

  it("the reel: a flange, the wound tape and a hub, with a tape stub", () => {
    const reel = html().match(/<svg[^>]*data-part="reel"[^]*?<\/svg>/)?.[0] ?? "";
    expect(reel.match(/<circle/g)).toHaveLength(3);
    expect(html()).toMatch(/<span class="[^"]*stub[^"]*"><\/span>\s*<svg[^>]*data-part="reel"/);
  });

  it("the dial: a ring, ten finger holes, a hub and a finger stop", () => {
    const dial = html().match(/<svg[^>]*data-part="dial"[^]*?<\/svg>/)?.[0] ?? "";
    expect(dial.match(/<circle/g)).toHaveLength(12);
    expect(dial.match(/class="[^"]*hole[^"]*"/g)).toHaveLength(10);
    expect(dial.match(/<line/g)).toHaveLength(1);
  });

  it("the maker's plate reads FIFTH COPY · MODEL 5 in the label role, never translated", () => {
    expect(MAKER_PLATE).toBe("FIFTH COPY · MODEL 5");
    expect(html()).toMatch(
      /<span class="[^"]*type-label[^"]*" data-part="plate">FIFTH COPY · MODEL 5<\/span>/,
    );
  });

  it("the deck holds every key of rows in order, then one space bar, and no function key", () => {
    const deck = html().slice(html().indexOf('data-part="deck"'));
    const keys = [...deck.matchAll(/data-key="([^"]*)"/g)].map((m) => m[1]);
    expect(keys).toEqual([...ROWS.flat(), " "]);
    expect(html().match(/data-key=/g)).toHaveLength(ROWS.flat().length + 1);
  });

  it("vectors and spans only: inline SVG, no raster, no button", () => {
    const out = html({ jammed: true, pressed: "a", wrong: "b", disabledKeys: ["c"] });
    expect(out).toContain("<svg");
    for (const banned of ["<button", "<img", "<image", "<picture", "<canvas", "url("]) {
      expect(out, banned).not.toContain(banned);
    }
  });
});

describe("teleprinter module (#558 C5)", () => {
  it("is 620px wide at most and sizes every part in machine units (container units)", () => {
    const root = block(".machine");
    expect(root).toMatch(/width:\s*min\(620px,\s*100%\)/);
    expect(root).toMatch(/container-type:\s*inline-size/);
    expect(root).toMatch(/--_u:\s*calc\(100cqi \/ 620\)/);
    expect(block(".panel")).toMatch(/height:\s*calc\(64 \* var\(--_u\)\)/);
    expect(block(".slot")).toMatch(/width:\s*calc\(400 \* var\(--_u\)\)/);
  });

  it("uses px only for the 2px ink rules, the 6px 6px 0 offset and the 620px cap", () => {
    const px = [...css.matchAll(/(-?\d*\.?\d+)px/g)].map((m) => m[0]);
    for (const p of px) expect(["2px", "-2px", "6px", "620px"], p).toContain(p);
    expect(block(".deck")).toMatch(/box-shadow:\s*6px 6px 0 var\(--_ink\)/);
    expect(block(".deck")).toMatch(/border:\s*2px solid var\(--_ink\)/);
    expect(block(".panel")).toMatch(/border:\s*2px solid var\(--_ink\)/);
  });

  it("has square keys: no radius anywhere in the module", () => {
    expect(css).not.toMatch(/radius/);
    expect(css).not.toMatch(/rounded/);
  });

  it("tilts the key bed about 22 degrees, hinged at its near edge", () => {
    expect(block(".bed")).toMatch(/transform:\s*perspective\(.+?\)\s+rotateX\(22deg\)/);
    expect(block(".bed")).toMatch(/transform-origin:\s*50% 100%/);
  });

  it("staggers each row a quarter pitch right of the row behind it", () => {
    expect(block(".row")).toMatch(
      /padding-left:\s*calc\(var\(--_row\) \* var\(--_pitch\) \* 0\.25\)/,
    );
  });

  it("paints only the machine roles, the tape and the error red, through private --_ properties", () => {
    const roles = [...css.matchAll(/var\((--color-[\w-]+)\)/g)].map((m) => m[1]);
    expect(roles.length).toBeGreaterThan(0);
    for (const r of roles)
      expect(r).toMatch(/^--color-(machine-(paper|deck|ink|metal|muted)|tape|typing-error)$/);
    const vars = [...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!);
    for (const v of vars) expect(v.startsWith("--_") || v.startsWith("--color-"), v).toBe(true);
  });
});
