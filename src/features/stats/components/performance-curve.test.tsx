import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { buildProfile, type ResultRow } from "../view/profile";
import { PROFILE_FIXTURE_NOW, profileFixtures } from "../view/profile-fixtures";
import { CurveFrame, PerformanceCurve } from "./performance-curve";
import { ProfileScreen, profileLabels } from "./profile-screen";

// Contract of #933 C2-C5: the output curve section of the Personnel file (Profil.dc.html,
// COURBE DE RENDEMENT), drawn from Profile.progress.series.

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const css = read("src/features/stats/components/performance-curve.module.css");
const NBSP = " ";

/** `n` races, one a day, the reference's own synthetic shape (31 WPM rising, 94.6 % rising). */
function rows(n: number): ResultRow[] {
  return Array.from({ length: n }, (_, i) => ({
    createdAt: new Date(PROFILE_FIXTURE_NOW.getTime() - (n - i) * 3_600_000),
    cleanWpm: 31 + i * 0.3 + Math.sin(i / 3.2) * 1.8,
    accuracy: Math.min(0.998, (94.6 + i * 0.045 + Math.cos(i / 5) * 0.8) / 100),
    language: "FR",
    durationMs: 60_000,
    place: 2,
  }));
}
const profileOf = (n: number) => buildProfile(rows(n), PROFILE_FIXTURE_NOW);
const pointsOf = (n: number) =>
  profileOf(n).progress.series.map((p) => ({ cleanWpm: p.cleanWpm, accuracy: p.accuracy }));

function screen(n: number | keyof typeof profileFixtures, lang: "en" | "fr" = "en") {
  const profile = typeof n === "number" ? profileOf(n) : profileFixtures[n];
  return renderToStaticMarkup(
    <ProfileScreen
      profile={profile}
      viewer={{ name: "DOCKET-829", isGuest: false }}
      since={null}
      stage={{ clerkSrc: null, picture: <svg /> }}
      labels={profileLabels(lang === "en" ? en : fr)}
      locale={lang}
      links={{ play: "/#play", settings: "/settings", signUp: "/sign-up" }}
    />,
  );
}

function frame(n: number, smoothing = 3, lang: "en" | "fr" = "en") {
  return renderToStaticMarkup(
    <CurveFrame
      points={pointsOf(n)}
      labels={(lang === "en" ? en : fr).profile.curve}
      locale={lang}
      smoothing={smoothing}
    />,
  );
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
const attr = (html: string, name: string, marker: string) => {
  const tag = html.match(new RegExp(`<[^>]*${marker}[^>]*>`))?.[0] ?? "";
  return tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
};
const svgName = (html: string) => html.match(/<svg[^>]*>/)![0].match(/aria-label="([^"]*)"/)?.[1];
const pathOf = (html: string, line: string) => attr(html, "d", `data-curve-line="${line}"`);
const allPaths = (html: string) => [...html.matchAll(/<path d="([^"]*)"/g)].map((m) => m[1]);

describe("section head and order (C2)", () => {
  it("kicker, h2 and intro in both languages", () => {
    const fr1 = text(screen(40, "fr"));
    expect(fr1).toContain("COURBE DE RENDEMENT");
    expect(fr1).toContain("Vitesse au fil des courses");
    expect(fr1).toContain(
      "Tes 40 dernières courses. La ligne pointillée donne la tendance générale.",
    );
    const en1 = text(screen(40));
    expect(en1).toContain("OUTPUT CURVE");
    expect(en1).toContain("Speed race after race");
    expect(en1).toContain("Your last 40 races. The dashed line shows the overall trend.");
    expect(screen(40)).toMatch(/<h2[^>]*id="profile-curve"[^>]*>Speed race after race<\/h2>/);
  });

  it("fewer than 40: the count on file; more: the 40 latest", () => {
    expect(text(screen(12, "fr"))).toContain("Tes 12 dernières courses.");
    expect(text(screen(55))).toContain("Your last 40 races.");
    expect(screen(55)).toContain('data-curve-count="40"');
  });

  it("draws the races in race order, left to right", () => {
    const html = frame(12, 0);
    const xs = [...pathOf(html, "speed")!.matchAll(/[ML]([\d.]+) /g)].map((m) => Number(m[1]));
    expect(xs).toHaveLength(12);
    expect(xs[0]).toBe(20);
    expect(xs[11]).toBe(980);
    xs.slice(1).forEach((x, i) => expect(x).toBeGreaterThan(xs[i]!));
    // k = 0: the smoothed line goes through the points, oldest first (31 WPM is the first race)
    const points = pointsOf(12);
    expect(points[0]!.cleanWpm).toBeLessThan(points[11]!.cleanWpm);
  });

  it("sits after the service record, from three races; under three the blank block stands in", () => {
    const html = screen("two-weeks");
    expect(html.indexOf('id="profile-service"')).toBeLessThan(html.indexOf('id="profile-curve"'));
    expect(screen("early")).toContain('data-section="curve"');
    expect(screen("early")).not.toContain("data-blank");
    expect(screen("one-race")).not.toContain('data-section="curve"');
    expect(screen("brand-new")).not.toContain('data-section="curve"');
  });
});

describe("the plot (C3)", () => {
  it("one inline SVG 1000 x 300 with four dashed grid lines", () => {
    const html = frame(40);
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html).toContain('viewBox="0 0 1000 300"');
    expect(html.match(/<line /g)).toHaveLength(4);
    for (const y of [20, 85, 150, 215]) expect(html).toContain(`y1="${y}" y2="${y}"`);
    expect(css).toMatch(/\.grid \{[^}]*stroke-dasharray: 3 5/);
    expect(css).toMatch(
      /\.plot \{[^}]*border-left: 2px solid var\(--color-fg\);[^}]*border-bottom: 2px solid var\(--color-fg\)/,
    );
  });

  it("ticks: speed whole numbers left, accuracy right with the locale's decimal", () => {
    expect(frame(40, 3, "fr")).toContain(`100${NBSP}%</span>`);
    expect(text(frame(40, 3, "fr"))).toContain("100 % 97,5 95 92,5 90 %");
    expect(text(frame(40))).toContain("100% 97.5 95 92.5 90%");
    expect(text(frame(40))).toMatch(/^(\d+ ){5}/);
  });

  it("each series: a path of round dots under its smoothed line, then the trend", () => {
    const html = frame(40);
    const order = [...html.matchAll(/<path[^>]*class="([^"]*)"/g)].map((m) => m[1]);
    expect(order).toHaveLength(5);
    expect(order[0]).toMatch(/accuracyDots/);
    expect(order[1]).toMatch(/accuracyLine/);
    expect(order[2]).toMatch(/speedDots/);
    expect(order[3]).toMatch(/speedLine/);
    expect(order[4]).toMatch(/trend/);
    expect(allPaths(html)[0]!.match(/h0/g)).toHaveLength(40);
    expect(allPaths(html)[2]!.match(/h0/g)).toHaveLength(40);
  });

  it("strokes as the reference, kept when the plot stretches; no animation", () => {
    const rule = (name: string) => css.match(new RegExp(`\\.${name} \\{([^}]*)\\}`))![1];
    expect(rule("speedDots")).toMatch(/stroke-width: 10px;[\s\S]*opacity: 0\.35/);
    expect(rule("speedLine")).toMatch(/stroke-width: 3\.5px/);
    expect(rule("accuracyDots")).toMatch(/stroke-width: 9px;[\s\S]*opacity: 0\.3;/);
    expect(rule("accuracyLine")).toMatch(/stroke-width: 3px/);
    expect(rule("trend")).toMatch(/stroke-width: 2px;[\s\S]*stroke-dasharray: 10 7/);
    expect(rule("dots")).toMatch(/stroke-linecap: round/);
    expect(css).toMatch(/\.svg \* \{\s*vector-effect: non-scaling-stroke;/);
    expect(css).not.toMatch(/animation|transition/);
  });

  it("no chart library", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    const charts = /chart|d3|recharts|visx|nivo|victory|plotly|echarts|apexcharts/i;
    expect(Object.keys(pkg.dependencies).filter((d) => charts.test(d))).toEqual([]);
    expect(read("src/features/stats/components/performance-curve.tsx")).not.toMatch(
      /<canvas|getContext/,
    );
  });
});

describe("controls (C4)", () => {
  it("LISSAGE: a native range 0..8, step 1, at 3 on the server render, its value beside it", () => {
    const html = renderToStaticMarkup(
      <PerformanceCurve points={pointsOf(40)} labels={fr.profile.curve} locale="fr" />,
    );
    const input = html.match(/<input[^>]*>/)![0];
    expect(input).toContain('type="range"');
    expect(input).toContain('min="0"');
    expect(input).toContain('max="8"');
    expect(input).toContain('step="1"');
    expect(input).toContain('value="3"');
    const id = input.match(/id="([^"]+)"/)![1];
    expect(html).toContain(`<label for="${id}">LISSAGE</label>`);
    expect(text(html)).toContain("LISSAGE 3");
    expect(css).toMatch(/\.slider \{[^}]*width: 180px;[^}]*min-height: 44px/);
    expect(text(frame(40, 3))).toContain("SMOOTHING 3");
  });

  it("a new width redraws both smoothed lines; dots and trend stay", () => {
    const a = frame(40, 3);
    const b = frame(40, 7);
    expect(pathOf(b, "speed")).not.toBe(pathOf(a, "speed"));
    expect(pathOf(b, "accuracy")).not.toBe(pathOf(a, "accuracy"));
    expect(pathOf(b, "trend")).toBe(pathOf(a, "trend"));
    expect(allPaths(b)[0]).toBe(allPaths(a)[0]);
    expect(allPaths(b)[2]).toBe(allPaths(a)[2]);
  });

  it("the legend in both languages", () => {
    expect(text(frame(40, 3, "fr"))).toContain(
      "vitesse (MPM, gauche) précision (%, droite) tendance",
    );
    expect(text(frame(40))).toContain("speed (WPM, left) accuracy (%, right) trend");
  });
});

describe("told apart without colour (C5)", () => {
  it("each smoothed line ends with its unit", () => {
    const fr1 = frame(40, 3, "fr");
    const ends = [...fr1.matchAll(/<span[^>]*data-curve-end=""[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(ends).toEqual(["MPM", "%"]);
    // placed at the latest point (x 980 of 1000)
    expect(fr1).toMatch(/left:98%[^"]*"[^>]*data-curve-end/);
    expect([...frame(40).matchAll(/data-curve-end=""[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual([
      "WPM",
      "%",
    ]);
  });

  it("the SVG is an image named by one sentence: count, smoothed speed and accuracy, trend", () => {
    const fr1 = frame(40, 3, "fr");
    expect(fr1).toMatch(/<svg[^>]*role="img"/);
    expect(svgName(fr1)).toMatch(
      /^40 courses : vitesse de \d+,\d à \d+,\d MPM, précision de \d+,\d à \d+,\d %, tendance à la hausse\.$/,
    );
    expect(svgName(frame(40))).toMatch(
      /^40 races: speed from \d+\.\d to \d+\.\d WPM, accuracy from \d+\.\d to \d+\.\d%, trending up\.$/,
    );
  });

  it("under six races: no trend line, no trend in the name, legend or intro", () => {
    const html = frame(4);
    expect(pathOf(html, "trend")).toBeUndefined();
    expect(svgName(html)).toMatch(/^4 races: .*%\.$/);
    expect(text(html)).not.toContain("trend");
    expect(text(screen(4))).toContain("Your last 4 races.");
    expect(text(screen(4))).not.toContain("dashed line");
  });
});
