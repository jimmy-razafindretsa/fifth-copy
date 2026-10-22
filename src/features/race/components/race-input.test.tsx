import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { keyOf, RaceInput, TYPING_SURFACE } from "./race-input";

// #559 C4, the markup and the key filter (the focus, the lock and the clipboard live in a browser:
// e2e/race/input.spec.ts).
const noop = () => {};
const html = (disabled: boolean) =>
  renderToStaticMarkup(<RaceInput disabled={disabled} onKey={noop} label="Text to type" />);
const down = (key: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>> = {}) =>
  keyOf({ key, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe("RaceInput (#559 C4)", () => {
  it("is a named text input with every browser aid off", () => {
    const markup = html(false);
    expect(markup).toMatch(/^<input [^>]*\/?>$/);
    for (const attr of [
      'type="text"',
      'aria-label="Text to type"',
      'autoComplete="off"',
      'autoCorrect="off"',
      'autoCapitalize="off"',
      'spellCheck="false"',
      'inputMode="text"',
      "data-race-input",
    ]) {
      expect(markup.toLowerCase(), attr).toContain(attr.toLowerCase());
    }
    expect(markup).not.toContain("disabled");
    expect(markup).not.toMatch(/value=/);
  });

  it("is disabled while locked", () => {
    expect(html(true)).toMatch(/ disabled=""/);
  });

  it("is visually hidden, not removed (it keeps the focus and the keys)", () => {
    const css = readFileSync(
      path.join(process.cwd(), "src/features/race/components/race-input.module.css"),
      "utf8",
    );
    expect(css).toMatch(/clip: rect\(0, 0, 0, 0\)/);
    expect(css).toMatch(/width: 1px/);
    expect(css).not.toMatch(/display:\s*none|visibility:\s*hidden/);
  });

  it("takes printable characters and Backspace, as the layout produced them", () => {
    for (const k of ["a", "L", " ", "é", "ç", "«", "»", "'", "€", "9"]) expect(down(k), k).toBe(k);
    expect(down("Backspace")).toBe("Backspace");
    // AltGr on Windows reports Ctrl+Alt; Option on macOS reports Alt: both type a character
    expect(down("@", { ctrlKey: true, altKey: true })).toBe("@");
    expect(down("œ", { altKey: true })).toBe("œ");
  });

  it("ignores everything else: named keys, shortcuts, dead keys, composition", () => {
    for (const k of [
      "Shift",
      "Enter",
      "Tab",
      "Escape",
      "ArrowLeft",
      "Dead",
      "Unidentified",
      "F5",
      "Meta",
    ]) {
      expect(down(k), k).toBeNull();
    }
    expect(down("v", { ctrlKey: true })).toBeNull();
    expect(down("v", { metaKey: true })).toBeNull();
    expect(down("c", { metaKey: true, altKey: true })).toBeNull();
    expect(
      keyOf({ key: "e", ctrlKey: false, metaKey: false, altKey: false, isComposing: true }),
    ).toBe(null);
  });

  it("names the typing surface by its three parts", () => {
    expect(TYPING_SURFACE).toBe("[data-telex], [data-sheet], [data-machine]");
  });
});

// Contract of #220 C6: the input carries the live error settings and your engine errors as data, so the
// e2e and later cards read them without a scoring copy.
describe("RaceInput live attributes (#220 C6)", () => {
  const live = (props: { mode?: "continue" | "block"; backspace?: boolean; errors?: number }) =>
    renderToStaticMarkup(<RaceInput disabled onKey={noop} label="Text to type" {...props} />);

  it("data-mode, data-backspace (on | off) and data-errors from its props", () => {
    const block = live({ mode: "block", backspace: true, errors: 3 });
    expect(block).toContain('data-mode="block"');
    expect(block).toContain('data-backspace="on"');
    expect(block).toContain('data-errors="3"');
    const off = live({ mode: "continue", backspace: false, errors: 0 });
    expect(off).toContain('data-mode="continue"');
    expect(off).toContain('data-backspace="off"');
    expect(off).toContain('data-errors="0"');
  });

  it("before the room's settings and your desk are known, none of them", () => {
    const out = live({});
    for (const attr of ["data-mode", "data-backspace", "data-errors"]) {
      expect(out, attr).not.toContain(attr);
    }
  });
});
