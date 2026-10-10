import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { plainSkin } from "./skins/__fixtures__/plain-skin";
import { machineSkinIds, machineSkins } from "./skins";
import { MachineFrame, TypingMachine } from "./typing-machine";

// Contract of #558 C4: TypingMachine is the skin seam. It renders the skin named by `skin` (default the
// teleprinter) from the registry inside one frame that owns the root contract.
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const dir = path.join(process.cwd(), "src/features/race/components/machine");
const tsx = readFileSync(path.join(dir, "typing-machine.tsx"), "utf8");
const ROWS = [
  ["q", "w", "e"],
  ["a", "s", "d"],
];

describe("TypingMachine (#558 C4)", () => {
  it("renders the teleprinter by default", () => {
    const out = html(<TypingMachine rows={ROWS} />);
    expect(out).toMatch(/^<div[^>]*\sdata-skin="teleprinter"/);
    expect(out).toBe(html(<MachineFrame skin={machineSkins.teleprinter} rows={ROWS} />));
  });

  it("renders the registered skin its skin prop names", () => {
    for (const id of machineSkinIds) {
      const props = { rows: ROWS, pressed: "a", wrong: "s", jammed: true, disabledKeys: ["d"] };
      const out = html(<TypingMachine {...props} skin={id} />);
      expect(out, id).toMatch(new RegExp(`^<div[^>]*\\sdata-skin="${id}"`));
      expect(out, id).toBe(html(<MachineFrame skin={machineSkins[id]} {...props} />));
    }
  });

  it("the frame owns the root: data-machine, data-skin, aria-hidden, data-jammed; the skin draws inside", () => {
    const out = html(<MachineFrame skin={plainSkin} rows={ROWS} jammed />);
    expect(out).toMatch(
      /^<div data-machine="true" data-skin="plain" data-jammed="true" aria-hidden="true"><span/,
    );
    expect(html(<MachineFrame skin={plainSkin} rows={ROWS} />)).toMatch(
      /^<div data-machine="true" data-skin="plain" aria-hidden="true"><span/,
    );
  });

  it("is a server component that reaches skins only through the registry", () => {
    expect(tsx).not.toMatch(/^["']use client["']/m);
    expect(tsx).not.toMatch(/\buse(State|Effect|LayoutEffect|Ref|Reducer|Context)\b/);
    const specs = [...tsx.matchAll(/from\s*["']([^"']+)["']/g)].map((m) => m[1]!);
    expect(specs.filter((s) => s.includes("skins"))).toEqual(["./skins"]);
  });
});
