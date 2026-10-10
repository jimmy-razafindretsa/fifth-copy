import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { typedViewFixtures as F } from "../view/typed-view";
import { TELEX_BAND, TelexStrip, telexScrollLeft } from "./telex-strip";

// Contract of #558 C2: markup and the pure scroll rule here; the box containment and the computed
// scroll-behavior in a real browser are checked in e2e/race/typing-surface.spec.ts.
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const css = readFileSync(
  path.join(process.cwd(), "src/features/race/components/telex-strip.module.css"),
  "utf8",
);
const LABELS = { strip: "Text to type" };

function block(selector: string, from = css): string {
  const at = from.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return from.slice(at, from.indexOf("}", at) + 1);
}

const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("TelexStrip markup (#558 C2)", () => {
  it("renders one data-state span per character, in document order", () => {
    for (const [name, view] of Object.entries(F)) {
      const out = html(<TelexStrip view={view} labels={LABELS} />);
      const spans = [...out.matchAll(/<span[^>]*data-state="(\w+)"[^>]*>([^<]*)<\/span>/g)];
      expect(spans, name).toHaveLength(view.chars.length);
      expect(
        spans.map((m) => m[1]),
        name,
      ).toEqual(view.chars.map((c) => c.state));
      expect(unescape(spans.map((m) => m[2]).join("")), name).toBe(
        view.chars.map((c) => c.ch).join(""),
      );
    }
  });

  it("puts no text node outside the char spans", () => {
    const out = html(<TelexStrip view={F["continue-wrong"]} labels={LABELS} />)
      .replace(/<span[^>]*data-state="\w+"[^>]*>[^<]*<\/span>/g, "")
      .replace(/<[^>]+>/g, "");
    expect(out).toBe("");
  });

  it("is a named group whose glyphs are hidden from assistive tech", () => {
    const out = html(<TelexStrip view={F.racing} labels={LABELS} />);
    expect(out).toMatch(/^<div[^>]*role="group"[^>]*aria-label="Text to type"/);
    expect(out).toMatch(/aria-hidden="true"[^>]*><span[^>]*data-state=/);
    expect(out).toContain("data-telex");
  });

  it("marks the last typed char (cursor - 1) with data-last", () => {
    const out = html(<TelexStrip view={F.racing} labels={LABELS} />);
    const states = [...out.matchAll(/<span([^>]*)data-state="\w+"([^>]*)>/g)];
    const last = states
      .map((m, i) => (/data-last="true"/.test(`${m[1]}${m[2]}`) ? i : -1))
      .filter((i) => i >= 0);
    expect(last).toEqual([F.racing.cursor - 1]);
  });
});

describe("TelexStrip styles (#558 C2)", () => {
  it("cannot be selected and holds one line", () => {
    const strip = block(".strip");
    expect(strip).toContain("user-select: none");
    expect(block(".viewport")).toContain("overflow: hidden");
    expect(block(".viewport")).toContain("white-space: nowrap");
  });

  it("scrolls smoothly, and never smoothly under either reduce selector", () => {
    expect(block(".viewport")).toContain("scroll-behavior: smooth");
    const media = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block(".viewport", media)).toContain("scroll-behavior: auto");
    expect(block('[data-motion="reduce"] .viewport')).toContain("scroll-behavior: auto");
  });
});

describe("telexScrollLeft (#558 C2)", () => {
  const W = 600;
  const CH = 20;

  it("leaves the scroll alone while the next char sits inside the reading band", () => {
    expect(TELEX_BAND).toEqual({ from: 0.2, to: 0.7, anchor: 0.3 });
    expect(telexScrollLeft(200, CH, W, 0)).toBe(0);
    expect(telexScrollLeft(1200, CH, W, 1000)).toBe(1000);
  });

  it("brings a next char past the band back to the anchor (30% of the viewport)", () => {
    expect(telexScrollLeft(500, CH, W, 0)).toBe(500 - 0.3 * W);
    expect(telexScrollLeft(3000, CH, W, 0)).toBe(3000 - 0.3 * W);
  });

  it("follows backwards (a backspace or a reset) and never goes below 0", () => {
    expect(telexScrollLeft(1000, CH, W, 1500)).toBe(1000 - 0.3 * W);
    expect(telexScrollLeft(40, CH, W, 800)).toBe(0);
    expect(telexScrollLeft(0, CH, W, 0)).toBe(0);
  });

  it("after every cursor change the next char's box lies inside the visible box", () => {
    for (const width of [280, 600, 1100]) {
      let scroll = 0;
      for (let cursor = 0; cursor < 300; cursor++) {
        const left = cursor * CH;
        scroll = telexScrollLeft(left, CH, width, scroll);
        expect(left, `${width} #${cursor}`).toBeGreaterThanOrEqual(scroll);
        expect(left + CH, `${width} #${cursor}`).toBeLessThanOrEqual(scroll + width);
      }
      // and back again, as after a run of backspaces
      for (let cursor = 299; cursor >= 0; cursor--) {
        const left = cursor * CH;
        scroll = telexScrollLeft(left, CH, width, scroll);
        expect(left).toBeGreaterThanOrEqual(scroll);
        expect(left + CH).toBeLessThanOrEqual(scroll + width);
      }
    }
  });

  it("is idempotent: a settled scroll stays put", () => {
    const once = telexScrollLeft(2222, CH, W, 0);
    expect(telexScrollLeft(2222, CH, W, once)).toBe(once);
  });
});
