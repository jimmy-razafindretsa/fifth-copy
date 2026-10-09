import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MAKER_PLATE, TypewriterKeyboard } from "./typewriter-keyboard";

// Contract of #558 C4: the keyboard draws the keys of `rows` and its chrome from props only.
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const tsx = readFileSync(
  path.join(process.cwd(), "src/features/race/components/typewriter-keyboard.tsx"),
  "utf8",
);
const ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";"],
  ["z", "x", "c", "v", "b", "n", "m", ",", ".", "é"],
];

/** Every `data-key` span with its attributes, in document order. */
function keys(markup: string) {
  return [...markup.matchAll(/<span([^>]*)data-key="([^"]*)"([^>]*)>/g)].map((m) => ({
    key: m[2]!.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#x27;/g, "'"),
    attrs: `${m[1]}${m[3]}`,
  }));
}

describe("TypewriterKeyboard markup (#558 C4)", () => {
  it("renders every key of rows as a presentational span, in order", () => {
    const out = keys(html(<TypewriterKeyboard rows={ROWS} />));
    expect(out.map((k) => k.key)).toEqual(ROWS.flat());
    for (const k of out) expect(k.attrs, k.key).toContain('role="presentation"');
  });

  it("draws whatever rows it is given (the layouts of #224 plug in here)", () => {
    const azerty = [
      ["a", "z", "e", "r", "t", "y", "u", "i", "o", "p", "^"],
      ["q", "s", "d"],
    ];
    expect(keys(html(<TypewriterKeyboard rows={azerty} />)).map((k) => k.key)).toEqual(
      azerty.flat(),
    );
    expect(keys(html(<TypewriterKeyboard rows={[]} />))).toEqual([]);
  });

  it("hides the whole machine from assistive tech: chrome, keys and plate", () => {
    expect(html(<TypewriterKeyboard rows={ROWS} />)).toMatch(
      /^<div[^>]*data-typewriter[^>]*aria-hidden="true"/,
    );
  });

  it("draws the type-bar basket, two spools and the maker's plate in the label role", () => {
    const out = html(<TypewriterKeyboard rows={ROWS} />);
    expect(out.match(/data-part="basket"/g)).toHaveLength(1);
    expect(out.match(/data-part="spool"/g)).toHaveLength(2);
    expect(out.match(/data-part="keybar"/g)).toHaveLength(1);
    expect(out.match(/data-part="platen"/g)).toHaveLength(1);
    expect(MAKER_PLATE).toBe("FIFTH COPY · MODEL 5");
    expect(out).toMatch(/<span[^>]*class="[^"]*type-label[^"]*"[^>]*data-part="plate"[^>]*>FIFTH COPY · MODEL 5</);
  });

  it("uses no raster image and no button: vectors and spans only", () => {
    const out = html(<TypewriterKeyboard rows={ROWS} pressed="a" wrong="b" jammed />);
    expect(out).toContain("<svg");
    for (const banned of ["<button", "<img", "<image", "<picture", "<canvas", "url("]) {
      expect(out, banned).not.toContain(banned);
    }
  });
});

describe("TypewriterKeyboard state attributes (#558 C4)", () => {
  const flagged = (markup: string, attr: string) =>
    keys(markup)
      .filter((k) => k.attrs.includes(`${attr}="true"`))
      .map((k) => k.key);

  it("sets nothing without the props", () => {
    const out = html(<TypewriterKeyboard rows={ROWS} />);
    for (const attr of ["data-pressed", "data-wrong", "data-disabled", "data-jammed"]) {
      expect(out, attr).not.toContain(attr);
    }
  });

  it("marks the pressed key and the wrong key, and only them", () => {
    const out = html(<TypewriterKeyboard rows={ROWS} pressed="m" wrong="é" />);
    expect(flagged(out, "data-pressed")).toEqual(["m"]);
    expect(flagged(out, "data-wrong")).toEqual(["é"]);
  });

  it("marks every listed disabled key", () => {
    const out = html(<TypewriterKeyboard rows={ROWS} disabledKeys={["q", "0", "missing"]} />);
    expect(flagged(out, "data-disabled")).toEqual(["0", "q"]);
  });

  it("jams the whole machine on the root, never per key", () => {
    const out = html(<TypewriterKeyboard rows={ROWS} jammed />);
    expect(out).toMatch(/^<div[^>]*data-jammed="true"/);
    expect(out.match(/data-jammed/g)).toHaveLength(1);
    expect(html(<TypewriterKeyboard rows={ROWS} jammed={false} />)).not.toContain("data-jammed");
  });

  it("is a pure function of its props (a server component: no state, no effect)", () => {
    const props = { rows: ROWS, pressed: "a", wrong: "s", jammed: true, disabledKeys: ["d"] };
    expect(html(<TypewriterKeyboard {...props} />)).toBe(html(<TypewriterKeyboard {...props} />));
    expect(tsx).not.toMatch(/^["']use client["']/m);
    expect(tsx).not.toMatch(/\buse(State|Effect|LayoutEffect|Ref|Reducer)\b/);
  });
});
