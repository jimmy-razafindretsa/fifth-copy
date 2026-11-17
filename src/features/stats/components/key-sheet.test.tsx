import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { addDays } from "@/lib/time";
import {
  type CharStatRow,
  KEY_GOAL_WPM,
  type KeyFile,
  keyFileOf,
  REFERENCE_KEYS,
} from "../view/key-file";
import { keyFileFixtures } from "../view/key-file-fixtures";
import { initialKey, KEY_SCALE, keySheetPlot } from "../view/key-sheet";
import { linePath, movingAverage, yAt } from "../view/performance-curve";
import { profileFixtures } from "../view/profile-fixtures";
import { KeySheet, plotSentence, rateText } from "./key-sheet";
import { KeySheetSection } from "./key-sheet-section";
import { ProfileScreen, profileLabels } from "./profile-screen";

// #963 C1-C4 (and the server half of C5, C6): the key sheet ("Fiche par touche", bible 14.3).
const css = readFileSync(
  path.join(process.cwd(), "src/features/stats/components/key-sheet.module.css"),
  "utf8",
);
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const NBSP = " ";

/** Rows of `char`, its speed on day `i` `wpms[i]` (null: no row), `hits` presses a day. */
function rows(wpms: (number | null)[], char: string, hits = 11, errors = 0): CharStatRow[] {
  return wpms.flatMap((wpm, i) =>
    wpm === null
      ? []
      : [
          {
            day: addDays("2026-10-01", i),
            char,
            hits,
            errors,
            timedHits: 10,
            totalMs: (12000 * 10) / wpm,
          },
        ],
  );
}

/** 40 days: `e` from 28 to 41.3 (38 between, most typed, goal reached), `ç` weak, `w` once, `k` never. */
const FILE = keyFileOf(
  [
    ...rows(
      Array.from({ length: 40 }, (_, i) => (i === 0 ? 28 : i === 39 ? 41.3 : 38)),
      "e",
      40,
      1,
    ),
    ...rows(
      Array.from({ length: 40 }, (_, i) => (i % 2 ? null : 20 + i * 0.5)),
      "ç",
    ),
    ...rows([...Array<null>(39).fill(null), 70], "w"),
  ],
  [],
);

const labelsOf = (lang: "fr" | "en") => (lang === "fr" ? fr : en).profile.keySheet;

const render = (lang: "fr" | "en", keyFile: KeyFile = FILE) =>
  renderToStaticMarkup(
    <KeySheetSection
      keyFile={keyFile}
      labels={labelsOf(lang)}
      locale={lang}
      id="t-key-sheet"
      heading="h2"
    />,
  );

describe("key sheet head (#963 C1)", () => {
  it("reads the kicker, the h2 and the intro naming the goal, in both languages", () => {
    const html = render("fr");
    expect(html).toContain('data-section="key-sheet"');
    expect(html).toMatch(/<h2 id="t-key-sheet"[^>]*>Fiche par touche<\/h2>/);
    expect(text(html)).toContain("INTERROGATOIRE INDIVIDUEL");
    expect(text(html)).toContain(
      "Choisis une touche. Marine : objectif de 35 MPM atteint. Rouge : à retravailler.",
    );
    const enHtml = render("en");
    expect(enHtml).toMatch(/<h2[^>]*>Key sheet<\/h2>/);
    expect(text(enHtml)).toContain("INDIVIDUAL QUESTIONING");
    expect(text(enHtml)).toContain("Pick a key. Navy: 35 WPM goal reached. Red: needs work.");
    expect(KEY_GOAL_WPM).toBe(35);
  });

  it("fr and en carry the same keys", () => {
    const shape = (o: unknown): unknown =>
      o && typeof o === "object"
        ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, shape(v)]))
        : typeof o;
    expect(shape(fr.profile.keySheet)).toEqual(shape(en.profile.keySheet));
  });
});

describe("key chips (#963 C2)", () => {
  const chips = (html: string) => [...html.matchAll(/<button[^>]*data-key-chip="([^"]+)"[^>]*>/g)];

  it("30 buttons in the reference's order, three looks, named with their state", () => {
    const html = render("fr");
    const all = chips(html);
    expect(all.map((m) => m[1])).toEqual(REFERENCE_KEYS);
    const tag = (char: string) => all.find((m) => m[1] === char)![0];
    expect(tag("e")).toContain('aria-label="E, objectif atteint"');
    expect(tag("e")).toContain('data-key-state="good"');
    expect(tag("ç")).toContain('aria-label="Ç, à retravailler"');
    expect(tag("ç")).toContain('data-key-state="weak"');
    expect(tag("k")).toContain('aria-label="K, jamais rencontrée"');
    expect(tag("k")).toContain("disabled");
    for (const m of all) expect(m[0]).toMatch(/aria-pressed="(true|false)"/);
    const enAll = chips(render("en"));
    expect(enAll.find((m) => m[1] === "e")![0]).toContain('aria-label="E, goal reached"');
    expect(enAll.find((m) => m[1] === "ç")![0]).toContain('aria-label="Ç, needs work"');
    expect(enAll.find((m) => m[1] === "k")![0]).toContain('aria-label="K, never met"');
  });

  it("the server render selects KeyFile.mostTyped", () => {
    expect(FILE.mostTyped).toBe("e");
    const html = render("en");
    const pressed = chips(html).filter((m) => m[0].includes('aria-pressed="true"'));
    expect(pressed.map((m) => m[1])).toEqual(["e"]);
    expect(html).toContain('data-key-selected="e"');
    expect(initialKey({ keys: FILE.keys, mostTyped: "k" })).toBe("e");
    expect(initialKey(keyFileFixtures.empty)).toBeNull();
    expect(render("en", keyFileFixtures.empty)).toBe("");
  });

  it("chips are 44px; the selected one is the ink ground with the red offset; none is muted", () => {
    expect(css).toMatch(/\.chip \{[^}]*width: 44px;[^}]*height: 44px;/);
    expect(css).toMatch(
      /\.chip\.on \{[^}]*background: var\(--color-fg\);[^}]*color: var\(--color-bg\);[^}]*box-shadow: 3px 3px 0 var\(--color-primary\);/,
    );
    expect(css).toMatch(/\.none \{[^}]*color: var\(--color-fg-muted\);/);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("key cells (#963 C3)", () => {
  const cell = (html: string, id: string) =>
    text(html.match(new RegExp(`data-key-stat="${id}">(.*?)</div>`))![1]!);

  it("five cells: latest, best, average to one decimal, the learning rate, the error rate", () => {
    const html = render("fr");
    expect(cell(html, "latest")).toBe(`DERNIÈRE VITESSE 41,3${NBSP}MPM`);
    expect(cell(html, "best")).toBe(`RECORD 41,3${NBSP}MPM`);
    expect(cell(html, "average")).toMatch(new RegExp(`^MOYENNE \\d+,\\d${NBSP}MPM$`));
    expect(cell(html, "rate")).toMatch(/^RYTHME D'APPRENTISSAGE [+-]\d,\d\d \/ JOUR$/);
    expect(cell(html, "errors")).toBe(`TAUX DE FAUTES 2,5${NBSP}%`);
    const enHtml = render("en");
    expect(cell(enHtml, "latest")).toBe(`LATEST SPEED 41.3${NBSP}WPM`);
    expect(cell(enHtml, "best")).toMatch(/^BEST /);
    expect(cell(enHtml, "average")).toMatch(/^AVERAGE /);
    expect(cell(enHtml, "rate")).toMatch(/^LEARNING RATE [+-]\d\.\d\d \/ DAY$/);
    expect(cell(enHtml, "errors")).toBe(`ERROR RATE 2.5${NBSP}%`);
  });

  it("the rate is signed with two decimals; UNCERTAIN under six values", () => {
    expect(rateText(0.38, labelsOf("fr"), "fr")).toBe("+0,38 / JOUR");
    expect(rateText(0.38, labelsOf("en"), "en")).toBe("+0.38 / DAY");
    expect(rateText(-0.123, labelsOf("en"), "en")).toBe("-0.12 / DAY");
    expect(rateText(-0.001, labelsOf("en"), "en")).toBe("+0.00 / DAY");
    expect(rateText(null, labelsOf("fr"), "fr")).toBe("INCERTAIN");
    expect(rateText(null, labelsOf("en"), "en")).toBe("UNCERTAIN");
    const w = FILE.keys.find((k) => k.char === "w")!;
    expect(w.learningRate).toBeNull();
  });
});

describe("key plot (#963 C4)", () => {
  it("ticks 60 45 30 15 0, the 1000x300 viewBox, four dashed grid lines and the goal at 35", () => {
    const html = render("en");
    expect(text(html)).toContain("60 45 30 15 0");
    expect(html).toContain('viewBox="0 0 1000 300"');
    expect(html.match(/<line /g)).toHaveLength(4);
    expect(html).toContain(`d="M0 ${yAt(35, KEY_SCALE).toFixed(1)}H1000"`);
    expect(yAt(35, KEY_SCALE).toFixed(1)).toBe("128.3");
    expect(css).toMatch(/\.grid \{[^}]*stroke-dasharray: 3 5;/);
    expect(css).toMatch(/\.goal \{[^}]*stroke-dasharray: 12 8;/);
  });

  it("dots under the smoothed line (moving average of 3), gaps lift the pen, over 60 on the top edge", () => {
    const e = FILE.keys.find((k) => k.char === "e")!;
    const plot = keySheetPlot(e, 35);
    expect(plot.line).toBe(linePath(movingAverage(e.series, 3), KEY_SCALE));
    expect(plot.dots.match(/h0/g)).toHaveLength(40);
    const c = FILE.keys.find((k) => k.char === "ç")!;
    expect(keySheetPlot(c, 35).line).toBe("");
    const gap = keySheetPlot({ series: [30, 31, null, 32, 33] }, 35);
    expect(gap.line.match(/M/g)).toHaveLength(2);
    const w = FILE.keys.find((k) => k.char === "w")!;
    const one = keySheetPlot(w, 35);
    expect(one.dots).toBe("M980.0 20.0h0");
    expect(one.line).toBe("");
    const html = render("en");
    const svg = html.indexOf("<svg");
    expect(html.indexOf('data-key-line="dots"', svg)).toBeLessThan(
      html.indexOf('data-key-line="speed"', svg),
    );
  });

  it("the SVG is an image named by one sentence; the legend names the key and the goal", () => {
    const e = FILE.keys.find((k) => k.char === "e")!;
    expect(plotSentence(e, 35, labelsOf("fr"), "fr")).toBe(
      "Touche E : de 28,0 à 41,3 MPM sur 40 jours, objectif de 35 MPM atteint.",
    );
    expect(plotSentence(e, 35, labelsOf("en"), "en")).toBe(
      "Key E: from 28.0 to 41.3 WPM over 40 days, 35 WPM goal reached.",
    );
    const c = FILE.keys.find((k) => k.char === "ç")!;
    expect(plotSentence(c, 35, labelsOf("en"), "en")).toMatch(/goal not reached yet\.$/);
    const w = FILE.keys.find((k) => k.char === "w")!;
    expect(plotSentence(w, 35, labelsOf("en"), "en")).toBe(
      "Key W: 70.0 WPM over 1 day, 35 WPM goal reached.",
    );
    const html = render("en");
    expect(html).toContain(
      'role="img" aria-label="Key E: from 28.0 to 41.3 WPM over 40 days, 35 WPM goal reached."',
    );
    expect(text(html)).toContain("speed on key E 35 WPM goal");
    expect(text(render("fr"))).toContain("vitesse sur la touche E objectif 35 MPM");
  });

  it("the live region is polite and empty until a pick", () => {
    const html = renderToStaticMarkup(
      <KeySheet keys={FILE.keys} initial="ç" goal={35} labels={labelsOf("en")} locale="en" />,
    );
    expect(html).toMatch(/<p class="sr-only" aria-live="polite" data-key-announce=""><\/p>/);
    expect(html).toContain('data-key-selected="ç"');
    expect(text(html)).toContain("speed on key Ç");
  });
});

describe("placement (#963 C6)", () => {
  const screen = (
    keyFile: KeyFile | undefined,
    fixture: keyof typeof profileFixtures = "two-weeks",
  ) =>
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

  it("after the output curve, before the attendance register; absent without key data or races", () => {
    const html = screen(keyFileFixtures.twoWeeks);
    const at = (s: string) => html.indexOf(`data-section="${s}"`);
    expect(at("key-sheet")).toBeGreaterThan(at("curve"));
    expect(at("key-sheet")).toBeLessThan(at("attendance"));
    expect(screen(keyFileFixtures.empty)).not.toContain('data-section="key-sheet"');
    expect(screen(undefined)).not.toContain('data-section="key-sheet"');
    expect(screen(keyFileFixtures.twoWeeks, "one-race")).not.toContain('data-section="key-sheet"');
  });
});
