import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { type Census, type CensusDistribution, censusOf } from "../view/census";
import { CENSUS_FIXTURE_POPULATION, censusFixtures } from "../view/census-fixtures";
import { CENSUS_KEYS, type CensusChoice, censusPlot } from "../view/census-plot";
import { profileFixtures } from "../view/profile-fixtures";
import { CensusSlot } from "./census-slot";
import { ProfileScreen, profileLabels } from "./profile-screen";
import { CensusSection, TypistCensus } from "./typist-census";

// Contract of #967 C1-C6: the `Ta place au Ministère` section of the Personnel file (Profil.dc.html,
// RECENSEMENT DES DACTYLOS), drawn from the `Census` of #966 (ADR 0023).

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const css = read("src/features/stats/components/census.module.css");
const NBSP = "\u00a0";
const catalogs = { en, fr } as const;
type Lang = keyof typeof catalogs;

const middle = censusFixtures.middle!;

function section(
  census: Census | null = middle,
  choice: CensusChoice = { mode: "speed", metric: "average" },
  lang: Lang = "en",
) {
  return renderToStaticMarkup(
    <CensusSection
      census={census}
      labels={catalogs[lang].profile.census}
      locale={lang}
      id="profile-census"
      heading="h2"
      choice={choice}
    />,
  );
}

/** The visible and spoken text: tags out, entities back, no-break spaces as spaces. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(new RegExp(NBSP, "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
const sentenceOf = (html: string) =>
  text(html.match(/<p[^>]*data-census-sentence[^>]*>(.*?)<\/p>/)![1]!);
const plotName = (html: string) =>
  html
    .match(/role="img" aria-label="([^"]*)"/)![1]!
    .replace(/&#x27;/g, "'")
    .replace(new RegExp(NBSP, "g"), " ");

/** A distribution with the viewer at `position` (0..1) on the speed scale, the reference's bell. */
function at(position: number): Census {
  const bars = Array.from({ length: 60 }, (_, i) => Math.exp(-(((i - 25) / 9) ** 2)));
  const tallest = Math.max(...bars);
  const total = bars.reduce((a, b) => a + b, 0);
  let sum = 0;
  const d: CensusDistribution = {
    min: 0,
    max: 150,
    bars: bars.map((b) => Math.round((b / tallest) * 1000) / 1000),
    cumulative: bars.map((b) => Math.round(((sum += b) / total) * 1000) / 1000),
    value: Math.round(position * 1500) / 10,
    position,
    percentile: 42.5,
  };
  return { averageSpeed: d, bestSpeed: d, averageAccuracy: d, bestAccuracy: d };
}

describe("TypistCensus C1: section head and tabs", () => {
  it("kicker, h2 and the two tabs, speed pressed in the server render, in both languages", () => {
    for (const [lang, kicker, title, tabs] of [
      ["en", "TYPIST CENSUS", "Your place at the Ministry", ["SPEED", "ACCURACY"]],
      ["fr", "RECENSEMENT DES DACTYLOS", "Ta place au Ministère", ["VITESSE", "PRÉCISION"]],
    ] as const) {
      const html = renderToStaticMarkup(
        <TypistCensus
          census={middle}
          labels={catalogs[lang].profile.census}
          locale={lang}
          id="c"
          heading="h2"
        />,
      );
      expect(html).toContain(`>${kicker}</p>`);
      expect(html).toContain(`<h2 id="c"`);
      expect(html).toContain(`>${title}</h2>`);
      expect(html).toContain(`aria-labelledby="c"`);
      const buttons = [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([^<]*)</g)];
      expect(buttons.map((b) => [b[2], b[1]])).toEqual([
        [tabs[0], "true"],
        [tabs[1], "false"],
        [lang === "en" ? "AVERAGE" : "MOYENNE", "true"],
        [lang === "en" ? "BEST" : "MEILLEURE", "false"],
      ]);
      expect(html).toContain('data-census="averageSpeed"');
    }
  });

  it("tabs and toggle buttons are at least 44px tall, label type", () => {
    for (const rule of [".tab {", ".option {"]) {
      const block = css.slice(css.indexOf(rule), css.indexOf("}", css.indexOf(rule)));
      expect(block).toContain("min-height: 44px");
      expect(block).toContain("@apply type-label");
    }
  });
});

describe("TypistCensus C2: the sentence", () => {
  const cases = {
    en: {
      averageSpeed: "average speed",
      bestSpeed: "best speed",
      averageAccuracy: "average accuracy",
      bestAccuracy: "best accuracy",
    },
    fr: {
      averageSpeed: "vitesse moyenne",
      bestSpeed: "meilleure vitesse",
      averageAccuracy: "précision moyenne",
      bestAccuracy: "meilleure précision",
    },
  } as const;

  it("names the four subjects in both languages, the percentile in the page's one-decimal form", () => {
    for (const lang of ["en", "fr"] as const) {
      for (const mode of ["speed", "accuracy"] as const) {
        for (const metric of ["average", "best"] as const) {
          const key = CENSUS_KEYS[mode][metric];
          const pct = middle[key].percentile!.toFixed(1);
          const html = section(middle, { mode, metric }, lang);
          const expected =
            lang === "en"
              ? `Your ${cases.en[key]} beats that of ${pct} % of the Ministry's comrades.`
              : `Ta ${cases.fr[key]} dépasse celle de ${pct.replace(".", ",")} % des camarades du Ministère.`;
          expect(sentenceOf(html)).toBe(expected);
        }
      }
    }
  });

  it("the reference's figure: 87,4 % set off in red", () => {
    const census = { ...at(0.25) };
    census.averageSpeed = { ...census.averageSpeed, percentile: 87.4 };
    const html = section(census, undefined, "fr");
    expect(sentenceOf(html)).toBe(
      "Ta vitesse moyenne dépasse celle de 87,4 % des camarades du Ministère.",
    );
    expect(html).toMatch(/<span[^>]*data-census-percentile="">87,4\u00a0%<\/span>/);
    const block = css.slice(css.indexOf(".percentile {"));
    expect(block.slice(0, block.indexOf("}"))).toContain("background: var(--color-primary)");
  });
});

describe("TypistCensus C3: the plot", () => {
  it("60 bars, ink left of the viewer and muted right; the curve drawn over them", () => {
    const html = section(at(0.4));
    const bars = [...html.matchAll(/data-census-bar="(beaten|ahead)"/g)].map((m) => m[1]);
    expect(bars).toHaveLength(60);
    expect(bars.filter((b) => b === "beaten")).toHaveLength(24);
    expect(bars.slice(0, 24).every((b) => b === "beaten")).toBe(true);
    expect(bars.slice(24).every((b) => b === "ahead")).toBe(true);
    expect(html.indexOf("<svg")).toBeGreaterThan(html.lastIndexOf("data-census-bar"));
    expect(html).toMatch(/<path d="M10\.0 [\d.]+L20\.0/);
    const curve = css.slice(css.indexOf(".curve path {"));
    expect(curve.slice(0, curve.indexOf("}"))).toContain("stroke-width: 2.5px");
    expect(curve.slice(0, curve.indexOf("}"))).toContain("stroke: var(--color-rival)");
  });

  it("marker at 10 %: tag on its right; at 90 %: on its left", () => {
    const left = section(at(0.1));
    expect(left).toMatch(
      /data-census-marker="" style="left:10\.00%"|style="left:10\.00%" data-census-marker/,
    );
    expect(left).toContain('data-census-tag="right"');
    expect(text(left)).toContain("YOU · 15.0 WPM");
    const right = section(at(0.9), undefined, "fr");
    expect(right).toContain("left:90.00%");
    expect(right).toContain('data-census-tag="left"');
    expect(text(right)).toContain("TOI · 135,0 MPM");
  });

  it("ticks 0 to 150 MPM, or 80 % to 100 %, in the locale", () => {
    const ticks = (html: string) =>
      [...html.match(/data-census-ticks="">(.*?)<\/div>/)![1]!.matchAll(/<span>([^<]*)</g)].map(
        (m) => m[1]!.replace(NBSP, " "),
      );
    expect(ticks(section(middle, undefined, "fr"))).toEqual([
      "0",
      "37,5",
      "75",
      "112,5",
      "150 MPM",
    ]);
    expect(ticks(section(middle, undefined, "en"))).toEqual([
      "0",
      "37.5",
      "75",
      "112.5",
      "150 WPM",
    ]);
    expect(ticks(section(middle, { mode: "accuracy", metric: "best" }, "fr"))).toEqual([
      "80 %",
      "85 %",
      "90 %",
      "95 %",
      "100 %",
    ]);
    expect(text(section(middle, { mode: "accuracy", metric: "best" }, "en"))).toContain(
      "YOU · 96.1 %",
    );
  });
});

describe("TypistCensus C4: toggle, legend and redraw", () => {
  it("the toggle and the legend in both languages", () => {
    expect(text(section(middle, undefined, "en"))).toContain(
      "AVERAGE BEST comrades you beat those ahead of you cumulative share",
    );
    expect(text(section(middle, undefined, "fr"))).toContain(
      "MOYENNE MEILLEURE camarades que tu dépasses ceux devant toi part cumulée",
    );
  });

  it("each choice draws its own distribution: sentence, bars, curve, marker and ticks change", () => {
    const draws = (["speed", "accuracy"] as const).flatMap((mode) =>
      (["average", "best"] as const).map((metric) => section(middle, { mode, metric })),
    );
    const parts = (html: string) => ({
      sentence: sentenceOf(html),
      curve: html.match(/<path d="([^"]+)"/)![1],
      marker: html.match(/left:([\d.]+%)/)![1],
      bars: [...html.matchAll(/height:([\d.]+%)/g)].map((m) => m[1]).join(),
    });
    const all = draws.map(parts);
    for (const key of ["sentence", "curve", "marker", "bars"] as const) {
      expect(new Set(all.map((p) => p[key])).size, key).toBe(4);
    }
    expect(draws[0]).toContain("150");
    expect(text(draws[2]!)).toContain("100 %");
  });

  it("the client leaf takes the whole census once: switching needs no read", () => {
    const src = read("src/features/stats/components/typist-census.tsx");
    expect(src.startsWith('"use client"')).toBe(true);
    expect(src).not.toMatch(/fetch\(|getCensus\(|"server-only"|"use server"/);
  });
});

describe("TypistCensus C5: never colour alone, never a count", () => {
  it("the plot is an img named by the sentence plus the viewer's value", () => {
    expect(plotName(section(middle, undefined, "en"))).toBe(
      `Your average speed beats that of ${middle.averageSpeed.percentile!.toFixed(1)} % of the Ministry's comrades. You: 54.2 WPM.`,
    );
    expect(plotName(section(middle, undefined, "fr"))).toBe(
      `Ta vitesse moyenne dépasse celle de ${middle.averageSpeed.percentile!.toFixed(1).replace(".", ",")} % des camarades du Ministère. Toi : 54,2 MPM.`,
    );
  });

  it("the HTML holds no number but the ticks, the percentile and the viewer's value", () => {
    for (const lang of ["en", "fr"] as const) {
      for (const mode of ["speed", "accuracy"] as const) {
        for (const metric of ["average", "best"] as const) {
          const html = section(middle, { mode, metric }, lang);
          const d = middle[CENSUS_KEYS[mode][metric]];
          const plot = censusPlot(d, mode, "", lang)!;
          // text and every attribute but the drawing (inline geometry, the path, the viewBox)
          const exposed = [
            text(html),
            ...[...html.matchAll(/ ([\w-]+)="([^"]*)"/g)]
              .filter(([, name]) => !["style", "d", "viewBox", "class"].includes(name!))
              .map(([, , value]) => value!.replace(/&#x27;/g, "'")),
          ].join(" ");
          const numbers = new Set(
            [...exposed.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(",", ".")),
          );
          const allowed = new Set(
            [...plot.ticks, plot.percentile, plot.value].flatMap((s) =>
              [...s.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(",", ".")),
            ),
          );
          for (const n of numbers) expect(allowed, `${lang} ${mode} ${metric}: ${n}`).toContain(n);
        }
      }
    }
  });
});

describe("TypistCensus C6: absent states", () => {
  const labels = en.profile.census;
  it("renders nothing under the floor or for a viewer under 3 counted races", () => {
    expect(censusFixtures.underFloor).toBeNull();
    expect(section(censusFixtures.underFloor)).toBe("");
    expect(section(censusFixtures.newcomer)).toBe("");
    expect(
      section(
        censusOf(CENSUS_FIXTURE_POPULATION, {
          averageWpm: 40,
          bestWpm: 50,
          averageAccuracy: 0.9,
          bestAccuracy: 0.95,
          races: 2,
        }),
      ),
    ).toBe("");
  });

  it("the slot renders nothing on a rejected read, and the section on a resolved one", async () => {
    const props = { labels, locale: "en" as const, id: "c", heading: "h2" as const };
    expect(
      await CensusSlot({ ...props, read: () => Promise.reject(new Error("down")) }),
    ).toBeNull();
    expect(await CensusSlot({ ...props, read: async () => null })).toBeNull();
    const el = await CensusSlot({ ...props, read: async () => middle });
    expect(renderToStaticMarkup(el!)).toContain("data-census-plot");
  });

  it("on the file: after the clean streaks and before the output curve; no read under 3 races", () => {
    let reads = 0;
    const screen = (fixture: keyof typeof profileFixtures) =>
      renderToStaticMarkup(
        <ProfileScreen
          profile={profileFixtures[fixture]}
          viewer={{ name: "DOCKET-829", isGuest: false }}
          since={null}
          stage={{ clerkSrc: null, picture: <svg /> }}
          labels={profileLabels(en)}
          locale="en"
          links={{ play: "/#play", settings: "/settings", signUp: "/sign-up" }}
          census={() => {
            reads += 1;
            return Promise.resolve(middle);
          }}
        />,
      );
    // the static render leaves the streamed slot to its (empty) fallback; the order is the source's
    screen("one-race");
    expect(reads).toBe(0);
    const src = read("src/features/stats/components/profile-screen.tsx");
    const streaks = src.indexOf("<StreaksDocket");
    const census = src.indexOf("<CensusSlot");
    const curve = src.indexOf("<PerformanceCurve");
    expect(streaks).toBeGreaterThan(0);
    expect(census).toBeGreaterThan(streaks);
    expect(curve).toBeGreaterThan(census);
    expect(src.slice(src.lastIndexOf("<Suspense", census), census)).toContain("fallback={null}");
  });
});
