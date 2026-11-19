import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { StuckHint } from "./stuck-hint";

// Contract of #999 C31 (markup and CSS; the live hint, its 8 s and the focus are e2e/race/stuck-hint.spec.ts):
// the bible 7.4 notice row `STUCK ON ç? HERE'S HOW →` in the UI language, the link to the guide's entry
// in a new tab, the character in its own case, no motion.
const html = (el: React.ReactElement) =>
  renderToStaticMarkup(el)
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, (tag) => (tag.startsWith("<a ") || tag.startsWith("<p ") ? tag : ""));
const css = readFileSync(
  path.join(process.cwd(), "src/features/race/components/stuck-hint.module.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

describe("StuckHint (#999 C31)", () => {
  it("reads STUCK ON ç? HERE'S HOW → in English", () => {
    const out = html(<StuckHint char="ç" href="/guide#c-cedilla" labels={en.race.stuckHint} />);
    expect(out).toMatch(/^<p[^>]*role="status"[^>]*data-notice="stuck-hint"/);
    expect(out.replace(/<[^>]+>/g, "")).toBe("STUCK ON ç? HERE'S HOW →");
  });

  it("reads BLOQUÉ SUR ç ? VOICI COMMENT → in French", () => {
    const out = html(<StuckHint char="ç" href="/guide#c-cedilla" labels={fr.race.stuckHint} />);
    expect(out.replace(/<[^>]+>/g, "")).toBe("BLOQUÉ SUR ç ? VOICI COMMENT →");
  });

  it("links the guide's entry in a new tab", () => {
    const out = html(<StuckHint char="ç" href="/guide#c-cedilla" labels={en.race.stuckHint} />);
    expect(out).toMatch(/<a href="\/guide#c-cedilla" target="_blank" rel="noopener"/);
  });

  it("keeps the character's case under the label caps and has no motion", () => {
    expect(css).toMatch(/\.char \{\s*text-transform: none;/);
    expect(css).not.toMatch(/animation|transition/);
  });
});
