import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { medalShelf } from "../view/medals";
import { Medals } from "./medals";

// #999 C36: the enamel pins section (bible 14.3 "Medals", 7.6, 13): none, some, locked, new.
const NOW = new Date("2026-11-19T17:00:00Z");
const css = readFileSync(
  path.join(process.cwd(), "src/features/stats/components/medals.module.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const SOME = medalShelf(
  [
    { achievementId: "first-win", awardedAt: new Date("2026-10-02T15:00:00Z") },
    { achievementId: "accuracy-100", awardedAt: new Date("2026-11-18T15:00:00Z") },
  ],
  NOW,
);

const render = (lang: "en" | "fr", shelf = SOME) =>
  renderToStaticMarkup(
    <Medals
      shelf={shelf}
      labels={(lang === "en" ? en : fr).profile.medals}
      locale={lang}
      id="medals"
      heading="h2"
    />,
  );

describe("Medals (#999 C36)", () => {
  it("none: the sentence for the first pin, every pin of the catalogue locked", () => {
    const html = render("en", medalShelf([], NOW));
    expect(html).toContain('data-medals="none"');
    expect(html).toContain("data-medals-none");
    expect(html).toContain("0 / 5 PINNED");
    expect(html.match(/data-state="locked"/g)).toHaveLength(5);
    expect(text(html)).toContain("No pin on your file yet.");
  });

  it("some: earned, new and locked cards, in the catalogue's order, the name one level below", () => {
    const html = render("en");
    expect(html).toContain('data-medals="some"');
    expect(html).not.toContain("data-medals-none");
    expect(html).toContain("2 / 5 PINNED");
    const states = [...html.matchAll(/data-pin="([^"]+)" data-state="([^"]+)"/g)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(states).toEqual([
      ["first-win", "earned"],
      ["wpm-50-club", "locked"],
      ["accuracy-100", "new"],
      ["accent-master", "locked"],
      ["streak-7-days", "locked"],
    ]);
    expect(html).toContain('<h2 id="medals"');
    expect(html.match(/<h3 /g)).toHaveLength(5);
    expect(text(html)).toContain("Order of the First Copy");
    expect(text(html)).toContain("PINNED OCT 2, 2026");
    expect(html.match(/data-new=""/g)).toHaveLength(1);
    expect(text(html)).toContain("LOCKED");
  });

  it("French: the catalogue's names and the canonical LOCKED / NEW strings", () => {
    const html = render("fr");
    expect(text(html)).toContain("2 / 5 ÉPINGLÉES");
    expect(text(html)).toContain("Ordre de la première copie");
    expect(text(html)).toContain("VERROUILLÉ");
    expect(text(html)).toContain("NOUVEAU");
    expect(text(html)).toContain("ÉPINGLÉE LE 2 OCT. 2026");
  });

  it("the pin is decoration, drawn in colour roles only (no raw colour)", () => {
    const html = render("en");
    expect(html.match(/<svg[^>]*aria-hidden="true"/g)).toHaveLength(5);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/--brand-/);
    expect(css).toMatch(/\[data-state="locked"\] \.pin \{\s*filter: grayscale\(1\)/);
  });
});
