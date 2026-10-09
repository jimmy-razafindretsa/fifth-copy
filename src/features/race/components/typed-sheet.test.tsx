import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { typedViewFixtures as F } from "../view/typed-view";
import { TypedSheet } from "./typed-sheet";

// Contract of #558 C3 (markup and CSS; the computed animations are checked in e2e/race/typing-surface.spec.ts).
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const read = (file: string) =>
  readFileSync(path.join(process.cwd(), "src/features/race/components", file), "utf8");
const chars = read("typing.module.css");
const sheetCss = read("typed-sheet.module.css");

/** The `data-state` spans of the markup, in document order. */
function spans(markup: string) {
  return [...markup.matchAll(/<span([^>]*)data-state="(\w+)"([^>]*)>([^<]*)<\/span>/g)].map(
    (m) => ({ state: m[2], attrs: `${m[1]}${m[3]}`, text: m[4] }),
  );
}

/** The body of the first `selector {` block (no nesting inside). */
function block(selector: string, css: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at) + 1);
}

const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("TypedSheet markup (#558 C3)", () => {
  it("renders only the typed part: the chars before the cursor plus the caret cell", () => {
    for (const name of ["racing", "continue-wrong", "block-jammed"] as const) {
      const view = F[name];
      const out = spans(html(<TypedSheet view={view} />));
      expect(out, name).toHaveLength(view.cursor + 1);
      expect(
        out.map((s) => s.state),
        name,
      ).toEqual(view.chars.slice(0, view.cursor + 1).map((c) => c.state));
      expect(unescape(out.map((s) => s.text).join("")), name).toBe(
        view.chars
          .slice(0, view.cursor + 1)
          .map((c) => c.ch)
          .join(""),
      );
      expect(
        out.filter((s) => s.state === "remaining"),
        name,
      ).toHaveLength(0);
      expect(out.at(-1)?.state, name).toBe("next");
    }
  });

  it("before the start the sheet holds only the caret cell; finished, the whole copy", () => {
    expect(spans(html(<TypedSheet view={F["before-start"]} />)).map((s) => s.state)).toEqual([
      "next",
    ]);
    const done = spans(html(<TypedSheet view={F.finished} />));
    expect(done).toHaveLength(F.finished.chars.length);
    expect(done.every((s) => s.state === "done")).toBe(true);
  });

  it("marks the span at cursor - 1 with data-last, and none before the first keystroke", () => {
    for (const name of ["racing", "continue-wrong", "block-jammed", "finished"] as const) {
      const out = spans(html(<TypedSheet view={F[name]} />));
      const last = out
        .map((s, i) => (/data-last="true"/.test(s.attrs) ? i : -1))
        .filter((i) => i >= 0);
      expect(last, name).toEqual([F[name].cursor - 1]);
    }
    expect(html(<TypedSheet view={F["before-start"]} />)).not.toContain("data-last");
  });

  it("keeps the two Continue-mode slips as wrong spans", () => {
    const out = spans(html(<TypedSheet view={F["continue-wrong"]} />));
    expect(out.filter((s) => s.state === "wrong").map((s) => s.text)).toEqual(["r", "n"]);
  });

  it("is a visual echo hidden from assistive tech, marked data-sheet", () => {
    expect(html(<TypedSheet view={F.racing} />)).toMatch(
      /^<div[^>]*data-sheet[^>]*aria-hidden="true"/,
    );
  });

  it("puts no text node outside the char spans", () => {
    const out = html(<TypedSheet view={F["continue-wrong"]} />)
      .replace(/<span[^>]*data-state="\w+"[^>]*>[^<]*<\/span>/g, "")
      .replace(/<[^>]+>/g, "");
    expect(out).toBe("");
  });
});

describe("TypedSheet styles (#558 C3)", () => {
  it("wrong = red text with an X overstrike pseudo-element in the error role", () => {
    expect(block('.char[data-state="wrong"]', chars)).toContain("color: var(--color-typing-error)");
    const over = block('[data-state="wrong"]::after', sheetCss);
    expect(over).toMatch(/content: "×"/);
    expect(over).toContain("color: var(--color-typing-error)");
  });

  it("next = the red cell with paper text, blinking fcCaret 1.05s steps(1)", () => {
    const next = block('.char[data-state="next"]', chars);
    expect(next).toContain("background: var(--color-typing-next-bg)");
    expect(next).toContain("color: var(--color-typing-next)");
    expect(next).toMatch(/animation: fcCaret 1\.05s steps\(1\) infinite/);
    expect(chars).toMatch(/@keyframes fcCaret/);
  });

  it("the last typed char pops in with fcPop 0.18s", () => {
    expect(block('.char[data-last="true"]', chars)).toMatch(
      /animation: fcPop 0\.18s var\(--motion-ease-out\)/,
    );
    expect(chars).toMatch(/@keyframes fcPop/);
  });

  it("stops the caret (solid cell) and the pop under both reduce selectors", () => {
    const media = chars.slice(chars.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(media.length).toBeGreaterThan(0);
    for (const sel of ['.char[data-state="next"]', '.char[data-last="true"]']) {
      expect(block(sel, media), sel).toContain("animation: none");
      expect(block(`[data-motion="reduce"] ${sel}`, chars), sel).toContain("animation: none");
    }
    expect(chars).not.toContain("!important");
  });
});
