import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { type BestInput, bestsView } from "../view/bests";
import type { Language, LanguageStats } from "../view/profile";
import { Bests } from "./bests";

// #999 C43: the "Personal bests" section of the Personnel file (bible 14.3 "Personal bests"): no races
// yet, one language only, populated; the French versus English comparison; real tables.
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
const none: LanguageStats = { races: 0, bestWpm: null, meanWpm: null };
const at = new Date("2026-11-12T15:00:00Z");
const BESTS: BestInput[] = [
  {
    language: "EN",
    textType: "SENTENCES",
    length: "SHORT",
    cleanWpm: 61.4,
    accuracy: 0.95,
    achievedAt: at,
  },
  {
    language: "EN",
    textType: "WORDS",
    length: "MEDIUM",
    cleanWpm: 48.2,
    accuracy: 0.97,
    achievedAt: at,
  },
  {
    language: "FR",
    textType: "SENTENCES",
    length: "SHORT",
    cleanWpm: 44,
    accuracy: 0.9,
    achievedAt: at,
  },
];

const render = (
  lang: "en" | "fr",
  bests: BestInput[],
  languages: Record<Language, LanguageStats>,
) =>
  renderToStaticMarkup(
    <Bests
      view={bestsView(bests, languages)}
      labels={(lang === "en" ? en : fr).profile.bests}
      locale={lang}
      id="bests"
      heading="h2"
    />,
  );

describe("Bests (#999 C43)", () => {
  it("no races yet: the head and one sentence, no table", () => {
    const html = render("en", [], { FR: none, EN: none });
    expect(html).toContain('data-bests="none"');
    expect(html).toMatch(/<h2 id="bests"[^>]*>Personal bests<\/h2>/);
    expect(text(html)).toContain("PERSONAL BESTS · BY CATEGORY");
    expect(text(html)).toContain("No best on file yet.");
    expect(html).not.toContain("<table");
    expect(text(render("fr", [], { FR: none, EN: none }))).toContain("Aucun record au dossier.");
  });

  it("one language only: the other's row reads dashes and the sentence asks for a race in it", () => {
    const html = render("en", BESTS.slice(0, 2), {
      FR: none,
      EN: { races: 2, bestWpm: 61.4, meanWpm: 54.8 },
    });
    expect(html).toContain('data-bests="one-language"');
    expect(html).toContain('data-bests-verdict="only"');
    expect(text(html)).toContain("Only English on file so far. Race in French to compare.");
    const frRow = html.match(/<tr data-bests-language="FR">.*?<\/tr>/)![0];
    expect(text(frRow)).toBe("FRENCH 0 — —");
    const enRow = html.match(/<tr data-bests-language="EN">.*?<\/tr>/)![0];
    expect(text(enRow)).toBe("ENGLISH 2 61.4 54.8");
  });

  it("populated: both languages, the comparison and every best by text type and length", () => {
    const languages = {
      FR: { races: 1, bestWpm: 44, meanWpm: 44 },
      EN: { races: 2, bestWpm: 61.4, meanWpm: 54.8 },
    };
    const html = render("en", BESTS, languages);
    expect(html).toContain('data-bests="populated"');
    expect(text(html)).toContain("In French you type 10.8 WPM slower than in English, on average.");
    // two dockets with their own headings, one level under the section's
    expect(html).toMatch(/<h3[^>]*>FRENCH VERSUS ENGLISH<\/h3>/);
    expect(html).toMatch(/<h3[^>]*>BY TEXT TYPE AND LENGTH<\/h3>/);
    // a real table per docket, with captions and column heads
    expect(html.match(/<table/g)).toHaveLength(2);
    expect(html.match(/<caption/g)).toHaveLength(2);
    const rows = [...html.matchAll(/<tr data-best="([^"]+)">(.*?)<\/tr>/g)].map(
      (m) => `${m[1]}: ${text(m[2]!)}`,
    );
    expect(rows).toEqual([
      "FR-SENTENCES-SHORT: FR SENTENCES · SHORT 44.0 90.0 % NOV 12, 2026",
      "EN-SENTENCES-SHORT: EN SENTENCES · SHORT 61.4 95.0 % NOV 12, 2026",
      "EN-WORDS-MEDIUM: EN WORDS · MEDIUM 48.2 97.0 % NOV 12, 2026",
    ]);
    // the wide table scrolls inside its own focusable, named region
    expect(html).toMatch(
      /role="region" aria-label="Personal bests, scrolls sideways" tabindex="0"/,
    );
    // French: decimal comma, French names
    const frHtml = render("fr", BESTS, languages);
    expect(text(frHtml)).toContain(
      "En français, tu tapes 10,8 MPM moins vite qu'en anglais, en moyenne.",
    );
    expect(text(frHtml)).toContain("PHRASES · COURT");
    expect(text(frHtml)).toContain("FRANÇAIS CONTRE ANGLAIS");
  });
});
