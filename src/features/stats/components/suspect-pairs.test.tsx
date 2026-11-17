import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { type KeyFile, type KeyFilePair, PAIR_LIMIT } from "../view/key-file";
import { keyFileFixtures } from "../view/key-file-fixtures";
import { profileFixtures } from "../view/profile-fixtures";
import { ProfileScreen, profileLabels } from "./profile-screen";
import { pairCells, SuspectPairs } from "./suspect-pairs";

// #965 C1-C5: the suspect letter pairs ("Combinaisons suspectes", bible 14.3).
const root = process.cwd();
const css = readFileSync(
  path.join(root, "src/features/stats/components/suspect-pairs.module.css"),
  "utf8",
);
const profileCss = readFileSync(
  path.join(root, "src/features/stats/components/profile.module.css"),
  "utf8",
);
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** Six pairs, weakest first as `keyFileOf` orders them; `ét` has no timed hit. */
const PAIRS: KeyFilePair[] = [
  { pair: "on", errorRate: 0.064, wpm: 31.2 },
  { pair: "ét", errorRate: 0.048, wpm: null },
  { pair: "qu", errorRate: 0.032, wpm: 27.6 },
  { pair: "ai", errorRate: 0.016, wpm: 46 },
  { pair: "es", errorRate: 0.008, wpm: 52.4 },
  { pair: "re", errorRate: 0, wpm: 50 },
];

/** The figures carry no-break spaces between number and unit; compare them as plain spaces. */
const sp = (s: string | undefined) => s?.replace(/\u00a0/g, " ");

const render = (lang: "fr" | "en", pairs: readonly KeyFilePair[] = PAIRS) =>
  renderToStaticMarkup(
    <SuspectPairs
      pairs={pairs}
      labels={profileLabels(lang === "en" ? en : fr).suspectPairs}
      locale={lang}
      id="sp"
      heading="h2"
    />,
  );

const items = (html: string) =>
  html
    .split("<li")
    .slice(1)
    .map((li) => li.split("</li>")[0]!);

describe("SuspectPairs (#965)", () => {
  it("C1 a 7.4 docket with the streak docket's header: the heading and the ink tag", () => {
    const html = render("fr");
    expect(html).toContain('data-section="suspect-pairs"');
    expect(html).toMatch(/<h2 id="sp" class="[^"]*docketTitle[^"]*">COMBINAISONS SUSPECTES<\/h2>/);
    expect(html).toMatch(/<span class="[^"]*inkTag[^"]*">À SURVEILLER<\/span>/);
    expect(html).toMatch(/<div class="[^"]*docket[^"]*"><div class="[^"]*docketHead/);
    const enHtml = render("en");
    expect(enHtml).toContain(">SUSPECT COMBINATIONS</h2>");
    expect(enHtml).toContain(">UNDER WATCH</span>");
  });

  it("C2 one row per pair in order: upper case, a bar against the highest rate, rate and speed", () => {
    const html = render("fr");
    const rows = items(html);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.match(/data-pair="([^"]+)"/)![1])).toEqual(PAIRS.map((p) => p.pair));
    const visible = (r: string) =>
      [...r.matchAll(/aria-hidden="true">([^<]*)</g)].map((m) => sp(m[1])).filter(Boolean);
    expect(visible(rows[0]!)).toEqual(["ON", "6,4 %", "31 MPM"]);
    expect(visible(rows[1]!)).toEqual(["ÉT", "4,8 %", "—"]);
    expect(visible(rows[2]!)).toEqual(["QU", "3,2 %", "28 MPM"]);
    const widths = rows.map((r) => r.match(/style="width:([\d.]+)%"/)![1]);
    expect(widths).toEqual(["100", "75", "50", "25", "12.5", "0"]);
    expect(visible(items(render("en"))[0]!)).toEqual(["ON", "6.4 %", "31 WPM"]);
  });

  it("C2 a list whose items read as one sentence; the bar is decorative", () => {
    const html = render("fr");
    expect(html).toMatch(/<ul class="[^"]*list[^"]*" aria-labelledby="sp">/);
    const rows = items(html);
    const sentence = (r: string) => sp(r.match(/<span class="sr-only">([^<]*)<\/span>/)![1]);
    expect(sentence(rows[0]!)).toBe("ON : 6,4 % de fautes, 31 MPM");
    expect(sentence(rows[1]!)).toBe("ÉT : 4,8 % de fautes, vitesse non mesurée");
    expect(sentence(items(render("en"))[0]!)).toBe("ON: 6.4 % errors, 31 WPM");
    // everything but the sentence is hidden from assistive tech
    for (const r of rows) {
      expect(r.match(/aria-hidden="true"/g)).toHaveLength(4);
      expect(r).toMatch(/<span class="[^"]*track[^"]*" aria-hidden="true"><span[^>]*data-pair-bar/);
    }
  });

  it("C2 the row takes a pair record: an all-clean list draws empty bars", () => {
    const labels = profileLabels(en).suspectPairs;
    expect(pairCells({ pair: "th", errorRate: 0, wpm: 40 }, 0, labels, "en").width).toBe(0);
    expect(pairCells({ pair: "th", errorRate: 0.05, wpm: 40.5 }, 0.1, labels, "en")).toMatchObject({
      name: "TH",
      rate: "5.0\u00a0%",
      speed: "41\u00a0WPM",
      width: 50,
    });
  });

  it("C3 the foot", () => {
    expect(text(render("fr").split("</ul>")[1]!)).toBe(
      "Les enchaînements où tes doigts trébuchent le plus souvent : taux de fautes et vitesse sur la paire.",
    );
    expect(text(render("en").split("</ul>")[1]!)).toBe(
      "The sequences where your fingers trip most often: error rate and speed on the pair.",
    );
  });

  it("C4 one to five pairs: that many rows", () => {
    for (let n = 1; n < PAIR_LIMIT; n += 1) {
      expect(items(render("en", PAIRS.slice(0, n)))).toHaveLength(n);
    }
  });

  it("C5 the reference's tracks and type; colours through roles, no raw hex", () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/#[0-9a-f]{3,8}\b|--brand-|--color-reward|--color-rival/i);
    expect(code).toMatch(
      /\.row \{[^}]*grid-template-columns: 72px minmax\(0, 1fr\) 70px 80px;[^}]*gap: 14px;[^}]*padding: 12px 22px;/,
    );
    expect(code).toMatch(/\.pair \{[^}]*font-size: 20px;/);
    expect(code).toMatch(
      /\.track \{[^}]*height: 10px;[^}]*background: var\(--color-surface\);[^}]*border: 1px solid var\(--color-fg\);/,
    );
    expect(code).toMatch(/\.fill \{[^}]*background: var\(--color-primary\);/);
    expect(code).toMatch(/\.speed \{\s*color: var\(--color-fg-muted\);/);
  });

  it("C5 fr and en have the same keys", () => {
    expect(Object.keys(en.profile.suspectPairs).sort()).toEqual(
      Object.keys(fr.profile.suspectPairs).sort(),
    );
  });
});

describe("ProfileScreen placement (#965 C1, C4)", () => {
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

  it("the grid's second cell, beside the streak docket, with the two-week fixture's six pairs", () => {
    const html = screen("two-weeks", keyFileFixtures.twoWeeks);
    const pairGrid = html.split("data-docket-pair")[1]!;
    const order = [...pairGrid.matchAll(/data-section="([^"]+)"/g)].map((m) => m[1]);
    expect(order.slice(0, 2)).toEqual(["streaks", "suspect-pairs"]);
    expect(html).toMatch(/<div class="[^"]*pair[^"]*" data-docket-pair="">/);
    expect(profileCss).toMatch(
      /\.pair \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 480px\), 1fr\)\);/,
    );
    const docket = html.split('data-section="suspect-pairs"')[1]!.split("</section>")[0]!;
    expect(docket.match(/<li /g)).toHaveLength(6);
    expect(docket).toContain('data-pair="qu"');
  });

  it("no qualifying pair: the docket is absent and the streak docket spans the row alone", () => {
    const none = { ...keyFileFixtures.twoWeeks, pairs: [] };
    for (const html of [screen("two-weeks", none), screen("two-weeks")]) {
      expect(html).toContain('data-section="streaks"');
      expect(html).not.toContain("suspect-pairs");
      expect(html).toContain("data-docket-pair");
    }
    expect(screen("one-race", keyFileFixtures.twoWeeks)).not.toContain("suspect-pairs");
  });
});
