import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import type { Callout } from "../callouts/rule";
import { Callouts } from "./callouts";

// #999 C49: the callouts render on the Personnel file, both languages, one sentence per key.

const CALLOUTS: Callout[] = [
  { kind: "faster", char: "ç", pct: 30 },
  { kind: "messier", char: "t", pct: 50 },
];

const render = (lang: "fr" | "en", callouts = CALLOUTS) =>
  renderToStaticMarkup(
    <Callouts
      callouts={callouts}
      labels={(lang === "fr" ? fr : en).profile.callouts}
      locale={lang}
      id="t-callouts"
      heading="h2"
    />,
  );

describe("Callouts (#999 C49)", () => {
  it("English: heading, list and the templates' sentences in order", () => {
    const html = render("en");
    expect(html).toContain('data-section="callouts"');
    expect(html).toContain(">This week at your desk</h2>");
    expect(html).toContain('aria-label="This week&#x27;s callouts"');
    expect(html).toContain("Your ç is 30% faster than last week.");
    expect(html).toContain(
      "You missed t 50% more often than last week: slow down on it and it will settle.",
    );
    expect(html.indexOf('data-callout-key="ç"')).toBeLessThan(html.indexOf('data-callout-key="t"'));
  });

  it("French", () => {
    const html = render("fr");
    expect(html).toContain(">Cette semaine à ton bureau</h2>");
    expect(html).toContain("Ton ç est 30 % plus rapide que la semaine dernière.");
  });

  it("no callout, no section", () => {
    expect(render("en", [])).toBe("");
  });
});
