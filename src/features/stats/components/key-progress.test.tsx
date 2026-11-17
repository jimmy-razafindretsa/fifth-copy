import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { addDays } from "@/lib/time";
import { type CharStatRow, type KeyFile, keyFileOf, REFERENCE_KEYS } from "../view/key-file";
import { keyFileFixtures } from "../view/key-file-fixtures";
import { profileFixtures } from "../view/profile-fixtures";
import { heatTone, KeyProgress, rowLabel } from "./key-progress";
import { ProfileScreen, profileLabels } from "./profile-screen";

// #962 C1-C5: the progress by key ("Progression par touche", bible 14.3).
const root = process.cwd();
const css = readFileSync(
  path.join(root, "src/features/stats/components/key-progress.module.css"),
  "utf8",
);
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** `days` days of the key `e`, timed so its speed on day `i` is `wpms[i]` (null: no row that day). */
function rows(wpms: (number | null)[], char = "e"): CharStatRow[] {
  return wpms.flatMap((wpm, i) =>
    wpm === null
      ? []
      : [
          {
            day: addDays("2026-10-01", i),
            char,
            hits: 11,
            errors: 0,
            timedHits: 10,
            totalMs: (12000 * 10) / wpm,
          },
        ],
  );
}

/** A 40-day file: `e` from 28 to 41.3 every day, `a` on every day so the window holds 40 days. */
const FORTY = keyFileOf(
  [
    ...rows(Array.from({ length: 40 }, (_, i) => (i === 0 ? 28 : i === 39 ? 41.3 : 34))),
    ...rows(
      Array.from({ length: 40 }, () => 40),
      "a",
    ),
  ],
  [],
);

const render = (lang: "fr" | "en", keyFile = FORTY) =>
  renderToStaticMarkup(
    <KeyProgress
      keyFile={keyFile}
      labels={profileLabels(lang === "en" ? en : fr).keyProgress}
      locale={lang}
      id="kp"
      heading="h2"
    />,
  );

describe("KeyProgress (#962)", () => {
  it("C1 the section head in both languages", () => {
    const frHtml = render("fr");
    expect(frHtml).toContain('aria-labelledby="kp"');
    expect(text(frHtml)).toContain("RAPPORT D'APPRENTISSAGE");
    expect(frHtml).toMatch(/<h2 id="kp"[^>]*>Progression par touche<\/h2>/);
    expect(text(frHtml)).toContain(
      "Une ligne par touche, une case par jour de frappe. Les touches jamais rencontrées restent vides.",
    );
    const enHtml = render("en");
    expect(text(enHtml)).toContain("LEARNING REPORT");
    expect(enHtml).toMatch(/<h2 id="kp"[^>]*>Progress by key<\/h2>/);
    expect(text(enHtml)).toContain(
      "One row per key, one cell per day of typing. Keys you never met stay empty.",
    );
  });

  it("C2 the head row, 30 rows in the key file's order, one cell per day, the average", () => {
    const html = render("fr");
    expect(html).toContain("JOUR 1 → 40");
    expect(html).toContain("MOY. MPM");
    expect(render("en")).toContain("DAY 1 → 40");
    expect(render("en")).toContain("AVG WPM");
    const caps = [...html.matchAll(/<th scope="row"[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(caps).toEqual(REFERENCE_KEYS.map((k) => k.toLocaleUpperCase("fr")));
    expect(caps.slice(-4)).toEqual(["É", "È", "À", "Ç"]);
    const e = html.split('data-key="e"')[1]!.split("</tr>")[0]!;
    expect(e.match(/<span class="[^"]*cell[^"]*" style=/g)).toHaveLength(40);
    expect(e).toMatch(/>34,\d<\/td>/);
    // a key never met: empty cells only and a dash
    const k = html.split('data-key="k"')[1]!.split("</tr>")[0]!;
    expect(k).not.toContain('style="background');
    expect(k).toContain(">—</td>");
    expect(render("en").split('data-key="e"')[1]!.split("</tr>")[0]).toMatch(/>34\.\d<\/td>/);
  });

  it("C2 a short file: the day count, one day reads JOUR 1; a gap is the empty cell", () => {
    const short = keyFileOf(rows([30, null, 40]), []);
    // the file's days are those with a row: 2 days
    expect(render("fr", short)).toContain("JOUR 1 → 2");
    const one = keyFileOf(rows([30]), []);
    const html = render("fr", one);
    expect(html).toContain(">JOUR 1<");
    expect(render("en", one)).toContain(">DAY 1<");
    // a day under 3 timed hits has no value: the empty cell
    const thin = keyFileOf(
      [
        ...rows([30, 30]),
        { day: "2026-10-03", char: "e", hits: 2, errors: 0, timedHits: 1, totalMs: 400 },
      ],
      [],
    );
    const e = render("fr", thin).split('data-key="e"')[1]!.split("</tr>")[0]!;
    expect(e.match(/style="background/g)).toHaveLength(2);
    expect(e.match(/class="[^"]*empty[^"]*"/g)).toHaveLength(1);
  });

  it("C3 the cell colour is a pure function of the speed through token roles", () => {
    expect(heatTone(10)).toBe("var(--color-primary)");
    expect(heatTone(18)).toBe("var(--color-primary)");
    expect(heatTone(33)).toBe("var(--heat-mid)");
    expect(heatTone(48)).toBe("var(--color-rival)");
    expect(heatTone(60)).toBe("var(--color-rival)");
    expect(heatTone(25.5)).toBe("color-mix(in srgb, var(--heat-mid) 50%, var(--color-primary))");
    expect(heatTone(40.5)).toBe("color-mix(in srgb, var(--color-rival) 50%, var(--heat-mid))");
    expect(heatTone(30)).toBe(heatTone(30));
    for (const v of [10, 18, 25, 33, 41, 48, 60]) expect(heatTone(v)).not.toMatch(/#|--brand-/);
    // the mid tone and the empty cell are roles too, themed by the tokens
    expect(css).toMatch(
      /--heat-mid: color-mix\(in srgb, var\(--color-fg\) 10%, var\(--color-surface\)\)/,
    );
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/#[0-9a-f]{3,8}\b|--brand-/i);
    // the legend under the grid
    const html = render("fr");
    expect(text(html.split("data-key-legend")[1]!)).toMatch(/^[^A-Z]*LENTE RAPIDE/);
    expect(text(render("en").split("data-key-legend")[1]!)).toMatch(/^[^A-Z]*SLOW FAST/);
    expect(css).toMatch(
      /linear-gradient\(90deg, var\(--color-primary\), var\(--heat-mid\), var\(--color-rival\)\)/,
    );
  });

  it("C4 a table with the key as row header; day cells hidden, one sentence per row", () => {
    const html = render("fr");
    expect(html).toContain("<table");
    expect(html.match(/<th scope="row"/g)).toHaveLength(30);
    expect(html.match(/<div aria-hidden="true"/g)).toHaveLength(30);
    const e = html.split('data-key="e"')[1]!.split("</tr>")[0]!;
    expect(text(e)).toContain("E : moyenne 34,");
    expect(text(e)).toMatch(/E : moyenne \d+,\d MPM, de 28,0 à 41,3 sur 40 jours/);
    const en1 = render("en").split('data-key="e"')[1]!.split("</tr>")[0]!;
    expect(text(en1)).toMatch(/E: average \d+\.\d WPM, from 28\.0 to 41\.3 over 40 days/);
    expect(text(html.split('data-key="k"')[1]!.split("</tr>")[0]!)).toContain(
      "K : jamais rencontrée",
    );
    expect(text(render("en").split('data-key="k"')[1]!.split("</tr>")[0]!)).toContain(
      "K: never met",
    );
    // the exact sentence of the contract
    const labels = profileLabels(fr).keyProgress;
    const entry = { ...FORTY.keys[4]!, averageWpm: 34.2 };
    expect(rowLabel(entry, labels, "fr")).toBe("E : moyenne 34,2 MPM, de 28,0 à 41,3 sur 40 jours");
    expect(rowLabel(entry, profileLabels(en).keyProgress, "en")).toBe(
      "E: average 34.2 WPM, from 28.0 to 41.3 over 40 days",
    );
  });

  it("C5 the scroll region is focusable and named", () => {
    const html = render("fr");
    expect(html).toMatch(
      /role="region" aria-label="Progression par touche, défilement horizontal" tabindex="0"/,
    );
    expect(render("en")).toContain('aria-label="Progress by key, scrolls sideways"');
    expect(css).toMatch(/\.scroll \{\s*overflow-x: auto;/);
  });
});

describe("ProfileScreen placement (#962 C5)", () => {
  const screen = (fixture: keyof typeof profileFixtures, keyFile?: KeyFile) =>
    renderToStaticMarkup(
      <ProfileScreen
        profile={profileFixtures[fixture]}
        viewer={{ name: "DOCKET-829", isGuest: false }}
        since={null}
        stage={{ clerkSrc: null, picture: null, still: true }}
        labels={profileLabels(en)}
        locale="en"
        links={{ play: "/", settings: "/settings", signUp: "/sign-up" }}
        keyFile={keyFile}
      />,
    );

  it("after the clean streaks, before the output curve", () => {
    const html = screen("two-weeks", keyFileFixtures.twoWeeks);
    const order = [...html.matchAll(/data-section="([^"]+)"/g)].map((m) => m[1]);
    expect(order.indexOf("key-progress")).toBe(order.indexOf("curve") - 1);
    expect(html.indexOf('data-section="key-progress"')).toBeGreaterThan(
      html.indexOf("profile-streaks"),
    );
  });

  it("absent under 3 races or without key data, with no placeholder", () => {
    expect(screen("one-race", keyFileFixtures.twoWeeks)).not.toContain("key-progress");
    expect(screen("two-weeks", keyFileFixtures.empty)).not.toContain("key-progress");
    expect(screen("two-weeks")).not.toContain("key-progress");
  });
});
