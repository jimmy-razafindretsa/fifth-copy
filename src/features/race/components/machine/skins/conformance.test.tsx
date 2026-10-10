import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MachineSkin, MachineSkinProps } from "../skin";
import { MachineFrame } from "../typing-machine";
import { plainSkin } from "./__fixtures__/plain-skin";
import { machineSkinIds, machineSkins } from "./index";

// Contract of #558 C4: every machine skin honours one props-to-attributes contract, so the motion (#224),
// the jam (#220), the seat layout (#561) and a skin picker (#638) never depend on a skin module. The suite
// runs over every registered skin plus a test-only fixture skin it registers here (spans only, no CSS):
// a new skin is one module, its tokens and one registry line, and passes this file unchanged.
const SKINS: Record<string, MachineSkin<string>> = { ...machineSkins, plain: plainSkin };

const ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";"],
  ["z", "x", "c", "v", "b", "n", "m", ",", ".", "é"],
];

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** Every element carrying `data-key`, with its tag and attributes, in document order. */
function keys(markup: string) {
  return [...markup.matchAll(/<(\w+)([^>]*?)\sdata-key="([^"]*)"([^>]*)>/g)].map((m) => ({
    tag: m[1]!,
    key: decode(m[3]!),
    attrs: `${m[2]}${m[4]}`,
  }));
}

const on = (attrs: string, name: string) => attrs.includes(`${name}="true"`);

function render(skin: MachineSkin<string>, props: Partial<MachineSkinProps> = {}) {
  return renderToStaticMarkup(<MachineFrame skin={skin} rows={ROWS} {...props} />);
}

/** The keys of the markup minus at most one space bar (`data-key=" "`), the one key a skin may add. */
function withoutSpaceBar(list: { key: string }[], rows: readonly (readonly string[])[]) {
  const listed = list.map((k) => k.key);
  const extra =
    listed.filter((k) => k === " ").length - rows.flat().filter((k) => k === " ").length;
  expect(extra, "at most one added space bar").toBeLessThanOrEqual(1);
  if (extra === 1) listed.splice(listed.lastIndexOf(" "), 1);
  return listed;
}

describe("machine skin registry (#558 C4)", () => {
  it("lists every skin once, each entry under its own id", () => {
    expect(Object.keys(machineSkins).sort()).toEqual([...machineSkinIds].sort());
    for (const id of machineSkinIds) expect(machineSkins[id].id, id).toBe(id);
  });

  it("registers the teleprinter, the default skin", () => {
    expect(machineSkinIds).toContain("teleprinter");
  });
});

for (const [name, skin] of Object.entries(SKINS)) {
  describe(`skin "${name}" honours the machine contract (#558 C4)`, () => {
    it("sits in one root that carries data-machine, data-skin and aria-hidden", () => {
      const out = render(skin);
      expect(out).toMatch(/^<div[^>]*\sdata-machine="[^"]*"/);
      expect(out).toMatch(new RegExp(`^<div[^>]*\\sdata-skin="${skin.id}"`));
      expect(out).toMatch(/^<div[^>]*\saria-hidden="true"/);
      expect(out.match(/data-machine=/g)).toHaveLength(1);
      expect(out.match(/data-skin=/g)).toHaveLength(1);
    });

    it("carries data-jammed on the root only, and only while jammed", () => {
      expect(render(skin)).not.toContain("data-jammed");
      expect(render(skin, { jammed: false })).not.toContain("data-jammed");
      const jammed = render(skin, { jammed: true });
      expect(jammed).toMatch(/^<div[^>]*\sdata-jammed="true"/);
      expect(jammed.match(/data-jammed=/g)).toHaveLength(1);
    });

    it("renders every key of rows as a presentational span, in document order", () => {
      const list = keys(render(skin));
      expect(withoutSpaceBar(list, ROWS)).toEqual(ROWS.flat());
      for (const k of list) {
        expect(k.tag, k.key).toBe("span");
        expect(k.attrs, k.key).toContain('role="presentation"');
      }
    });

    it("draws whatever rows it is given (the layouts of #224 plug in here)", () => {
      const azerty = [
        ["a", "z", "e", "r", "t", "y", "u", "i", "o", "p", "^", "$"],
        ["q", "s", "d"],
      ];
      const out = renderToStaticMarkup(<MachineFrame skin={skin} rows={azerty} />);
      expect(withoutSpaceBar(keys(out), azerty)).toEqual(azerty.flat());
      const empty = renderToStaticMarkup(<MachineFrame skin={skin} rows={[]} />);
      expect(withoutSpaceBar(keys(empty), [])).toEqual([]);
    });

    it("uses no button and no raster image", () => {
      const out = render(skin, { pressed: "a", wrong: "b", jammed: true, disabledKeys: ["c"] });
      for (const banned of ["<button", "<img", "<image", "<picture", "<canvas", "url("]) {
        expect(out, banned).not.toContain(banned);
      }
    });

    it("sets no key state without the props", () => {
      const out = render(skin);
      for (const attr of ["data-pressed", "data-wrong", "data-disabled"]) {
        expect(out, attr).not.toContain(attr);
      }
    });

    it("drives data-pressed, data-wrong and data-disabled from the props only, space bar included", () => {
      const cases: Partial<MachineSkinProps>[] = [
        { pressed: "m", wrong: "é" },
        { pressed: " ", wrong: " " },
        { disabledKeys: ["q", "0", " ", "missing"] },
        { pressed: "a", wrong: "a", disabledKeys: ["a"], jammed: true },
      ];
      for (const props of cases) {
        const list = keys(render(skin, props));
        for (const k of list) {
          const label = `${JSON.stringify(props)} key ${JSON.stringify(k.key)}`;
          expect(on(k.attrs, "data-pressed"), label).toBe(k.key === props.pressed);
          expect(on(k.attrs, "data-wrong"), label).toBe(k.key === props.wrong);
          expect(on(k.attrs, "data-disabled"), label).toBe(
            (props.disabledKeys ?? []).includes(k.key),
          );
        }
      }
      const one = keys(render(skin, { pressed: "m", wrong: "é" }));
      expect(one.filter((k) => on(k.attrs, "data-pressed")).map((k) => k.key)).toEqual(["m"]);
      expect(one.filter((k) => on(k.attrs, "data-wrong")).map((k) => k.key)).toEqual(["é"]);
    });

    it("is a pure function of its props (server-renderable: same props, same markup)", () => {
      const props = { pressed: "a", wrong: "s", jammed: true, disabledKeys: ["d"] };
      expect(render(skin, props)).toBe(render(skin, props));
    });
  });
}
