import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { ACCENT_CHARS, AccentsRow } from "./accents-row";

// #999 C55 (and C29): the accents row draws every guide character as a key linking to its guide entry.

const BY_CHAR = {
  e: { hits: 300, errors: 3 },
  é: { hits: 40, errors: 4 },
  ç: { hits: 10, errors: 3 },
};

const render = (lang: "fr" | "en") => {
  const t = lang === "fr" ? fr : en;
  // the figures' no-break spaces read as plain spaces here
  return renderToStaticMarkup(
    <AccentsRow
      byChar={BY_CHAR}
      labels={t.profile.accents}
      mapLabels={t.profile.keyboardMap}
      locale={lang}
      id="t-accents"
      heading="h2"
    />,
  ).replace(/\u00a0/g, " ");
};

describe("AccentsRow (#999 C55, C29)", () => {
  it("the spec's characters, in the guide's order", () => {
    expect(ACCENT_CHARS).toEqual([..."éèêëàâçùûôîïœæ«»€"]);
    for (const c of ["é", "è", "ê", "à", "ç", "ù", "œ", "«", "»"])
      expect(ACCENT_CHARS).toContain(c);
  });

  it("one link per key to /guide#<char>, named by the map's sentence", () => {
    const html = render("en");
    expect(html.match(/<a /g)).toHaveLength(ACCENT_CHARS.length);
    expect(html).toContain('href="/guide#c-cedilla"');
    expect(html).toContain('href="/guide#guillemet-open"');
    expect(html).toContain('aria-label="Ç: 2.9 % of strokes, 30.0 % errors · how to type it"');
    expect(html).toContain('aria-label="Œ: never struck · how to type it"');
    expect(html).toContain('aria-label="Accents row"');
  });

  it("typed keys carry the circle and core, untyped ones none; French heading", () => {
    const html = render("fr");
    expect(html).toContain(">Rangée des accents</h2>");
    expect(html).toMatch(/data-key="é"[^>]*data-key-typed="true"/);
    expect(html).toMatch(/data-key="œ"[^>]*data-key-typed="false"/);
    expect(html.match(/data-key-circle/g)).toHaveLength(2);
    expect(html).toContain("É : 11,4 % des frappes, 10,0 % de fautes · comment la taper");
  });
});
