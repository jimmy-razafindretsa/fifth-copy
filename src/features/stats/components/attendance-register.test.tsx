import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { type AttendanceRow, attendanceOf } from "../view/attendance";
import { buildProfile } from "../view/profile";
import { profileFixtures, PROFILE_FIXTURE_NOW } from "../view/profile-fixtures";
import { AttendanceRegister, dayLabel, daysLabel } from "./attendance-register";
import { ProfileScreen, profileLabels } from "./profile-screen";

// #330 C4, C5, C6 (structure, copy, contrast) and C7 (placement): the attendance register.
const root = process.cwd();
const css = readFileSync(
  path.join(root, "src/features/stats/components/attendance.module.css"),
  "utf8",
);
const tokens = readFileSync(path.join(root, "docs/design/tokens.css"), "utf8");
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const MIN = 60_000;
// Thursday November 12 2026, noon in Toronto
const NOW = new Date("2026-11-12T17:00:00Z");
const on = (day: string, minutes: number): AttendanceRow => ({
  createdAt: new Date(`${day}T15:00:00Z`),
  durationMs: minutes * MIN,
});
// a 6-day run ending today (Nov 7..12), 11.25 min on Nov 12 (75 %), 19 days in September
const ROWS: AttendanceRow[] = [
  ...Array.from({ length: 19 }, (_, i) => on(`2026-09-${String(i + 1).padStart(2, "0")}`, 20)),
  on("2026-11-07", 3),
  on("2026-11-08", 7.5),
  on("2026-11-09", 15),
  on("2026-11-10", 30),
  on("2026-11-11", 1),
  on("2026-11-12", 11.25),
];
const ATTENDANCE = attendanceOf(ROWS, NOW, 15);

const render = (lang: "fr" | "en", attendance = ATTENDANCE) =>
  renderToStaticMarkup(
    <AttendanceRegister
      attendance={attendance}
      labels={profileLabels(lang === "en" ? en : fr).attendance}
      locale={lang}
      id="att"
      heading="h2"
    />,
  );

/** The accessible text of the day cell `day` (its visible number is `aria-hidden`). */
const cell = (html: string, day: string) => {
  const part = html.split(`data-day="${day}"`)[1]!.split("</td>")[0]!;
  return text(part.replace(/<span aria-hidden="true">[^<]*<\/span>/g, "").replace(/^[^>]*>/, ""));
};
const attrs = (html: string, day: string) => html.split(`data-day="${day}"`)[1]!.split(">")[0]!;

describe("AttendanceRegister: section head (C4)", () => {
  it("French: kicker, h2 and the three 7.4 cells", () => {
    const html = render("fr");
    expect(html).toContain('<p class="');
    expect(text(html)).toMatch(/^FEUILLE DE POINTAGE Registre de présence /);
    expect(html).toMatch(/<h2 id="att"[^>]*>Registre de présence<\/h2>/);
    expect(html).toMatch(/aria-labelledby="att"/);
    const stats = html.match(/<div[^>]*data-attendance="[a-z]+"[^>]*>.*?<\/div>/g)!.map(text);
    expect(stats).toEqual(["SÉRIE ACTUELLE 6 JOURS", "RECORD 19 JOURS", "JOURS ACTIFS 25 / 73"]);
  });

  it("English, and the singular", () => {
    const html = render("en");
    expect(text(html)).toMatch(/^TIME SHEET Attendance register /);
    const stats = html.match(/<div[^>]*data-attendance="[a-z]+"[^>]*>.*?<\/div>/g)!.map(text);
    expect(stats).toEqual(["CURRENT STREAK 6 DAYS", "BEST 19 DAYS", "ACTIVE DAYS 25 / 73"]);
    const labels = { fr: fr.profile.attendance, en: en.profile.attendance };
    expect(daysLabel(1, labels.fr, "fr")).toBe("1 JOUR");
    expect(daysLabel(1, labels.en, "en")).toBe("1 DAY");
    expect(daysLabel(0, labels.fr, "fr")).toBe("0 JOUR");
    expect(daysLabel(0, labels.en, "en")).toBe("0 DAYS");
  });
});

describe("AttendanceRegister: months (C5)", () => {
  it("three tables captioned by the month and year, weeks from Monday", () => {
    const html = render("fr");
    expect(html.match(/<table/g)).toHaveLength(3);
    expect(html.match(/<caption[^>]*>[^<]*<\/caption>/g)!.map(text)).toEqual([
      "SEPTEMBRE 2026",
      "OCTOBRE 2026",
      "NOVEMBRE 2026",
    ]);
    const heads = html
      .split("<thead>")[1]!
      .split("</thead>")[0]!
      .match(/<span aria-hidden="true">([^<]*)<\/span>/g)!
      .map(text);
    expect(heads.join(" ")).toBe("L M M J V S D");
    expect(html).toContain('<th scope="col" abbr="lundi"');
    const enHeads = render("en").split("<thead>")[1]!.split("</thead>")[0]!;
    expect(
      enHeads
        .match(/<span aria-hidden="true">([^<]*)<\/span>/g)!
        .map(text)
        .join(" "),
    ).toBe("M T W T F S S");
    expect(render("en")).toContain("NOVEMBER 2026");
    // November 1 2026 is a Sunday: six empty cells before it in its first week
    const firstWeek = html
      .split('data-month="2026-11"')[1]!
      .split("<tbody>")[1]!
      .split("</tr>")[0]!;
    expect(firstWeek.match(/<td/g)).toHaveLength(7);
    expect(firstWeek.match(/data-day=/g)).toHaveLength(1);
  });

  it("each day's number on its level; today ringed; days after today dashed with no level", () => {
    const html = render("fr");
    expect(attrs(html, "2026-11-06")).toContain('data-level="0"');
    expect(attrs(html, "2026-11-07")).toContain('data-level="1"');
    expect(attrs(html, "2026-11-08")).toContain('data-level="2"');
    expect(attrs(html, "2026-11-12")).toContain('data-level="3"');
    expect(attrs(html, "2026-11-09")).toContain('data-level="4"');
    expect(attrs(html, "2026-11-10")).toContain('data-level="4"');
    expect(attrs(html, "2026-11-12")).toContain("data-today");
    expect(attrs(html, "2026-11-13")).toContain("data-future");
    expect(attrs(html, "2026-11-13")).not.toContain("data-level");
    expect(html.match(/data-today/g)).toHaveLength(1);
    expect(html.match(/data-future/g)).toHaveLength(18);
  });

  it("CSS: today a 2px ink rule, the future dashed and muted, no raw colour", () => {
    expect(css).toMatch(/\.today \{[^}]*outline: 2px solid var\(--color-fg\)/);
    expect(css).toMatch(/\.future \{[^}]*color: var\(--color-fg-muted\)[^}]*outline: 1px dashed/);
    expect(css).toMatch(/\.months \{[^}]*repeat\(auto-fit, minmax\(240px, 1fr\)\)/);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/#[0-9a-f]{3,8}\b|--brand-/i);
  });

  it("five tones of one hue, every number 4.5:1 or more on its tone in both themes", () => {
    const brand = (name: string) => {
      const hex = tokens.match(new RegExp(`--brand-${name}: (#[0-9A-Fa-f]{6})`))![1]!;
      return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    };
    const mix = (a: number[], b: number[], t: number) => a.map((x, i) => x * t + b[i]! * (1 - t));
    const lin = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const lum = (c: number[]) => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
    const ratio = (a: number[], b: number[]) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    const shares = [...css.matchAll(/var\(--color-primary\) (\d+)%, var\(--att-base\)/g)].map(
      (m) => Number(m[1]) / 100,
    );
    expect(shares).toEqual([0.2, 0.36, 0.52]);
    expect(css).toMatch(
      /\.level0 \{[^}]*background: var\(--att-base\);[^}]*color: var\(--color-fg\)/,
    );
    expect(css).toMatch(
      /\.level4 \{[^}]*background: var\(--color-primary\);[^}]*color: var\(--color-primary-fg\)/,
    );
    const red = brand("agit-red");
    for (const [bg, surface, ink] of [
      ["paper", "newsprint", "press-ink"],
      ["night", "night-panel", "night-ink"],
    ] as const) {
      const base = mix(brand(bg), brand(surface), 0.5);
      for (const share of [0, ...shares]) {
        expect(ratio(mix(red, base, share), brand(ink))).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio(red, brand("paper"))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("AttendanceRegister: legend and names (C6)", () => {
  it("the goal and five swatches, one per level", () => {
    const fhtml = render("fr");
    const legend = (html: string) => text(html.split("data-legend")[1]!.split("</section>")[0]!);
    expect(legend(fhtml)).toContain("OBJECTIF QUOTIDIEN (15 MIN) 0 % 25 % 50 % 75 % 100 %");
    expect(legend(render("en"))).toContain("DAILY GOAL (15 MIN) 0 % 25 % 50 % 75 % 100 %");
    const swatches = fhtml.split("data-legend")[1]!.match(/data-level="\d"/g);
    expect(swatches).toEqual([0, 1, 2, 3, 4].map((l) => `data-level="${l}"`));
  });

  it("every day is named by its figures, never by colour alone", () => {
    const fhtml = render("fr");
    const ehtml = render("en");
    expect(cell(fhtml, "2026-11-12")).toBe(
      "12 novembre (aujourd'hui) : 11 min, 75 % de l'objectif",
    );
    expect(cell(ehtml, "2026-11-12")).toBe("November 12 (today): 11 min, 75 % of the goal");
    expect(cell(fhtml, "2026-11-08")).toBe("8 novembre : 7 min, 50 % de l'objectif");
    expect(cell(fhtml, "2026-11-06")).toBe("6 novembre : aucune course");
    expect(cell(ehtml, "2026-11-06")).toBe("November 6: no race");
    expect(cell(fhtml, "2026-11-13")).toBe("13 novembre : à venir");
    expect(cell(ehtml, "2026-11-13")).toBe("November 13: still to come");
    // the goal is the register's: 11 min against 10 is 110 %
    const day = attendanceOf([on("2026-11-12", 11)], NOW, 10).months[2]!.days[11]!;
    expect(dayLabel(day, 10, en.profile.attendance, "en")).toBe(
      "November 12 (today): 11 min, 110 % of the goal",
    );
  });
});

describe("placement on the Personnel file (C7)", () => {
  const screen = (profile = profileFixtures["two-weeks"]) =>
    renderToStaticMarkup(
      <ProfileScreen
        profile={profile}
        viewer={{ name: "DOCKET-829", isGuest: false }}
        since={null}
        stage={{ clerkSrc: null, picture: null, still: true }}
        labels={profileLabels(fr)}
        locale="fr"
        links={{ play: "/#play", settings: "/settings", signUp: "/sign-up" }}
      />,
    );

  it("after the output curve, before the archives, from three counted races", () => {
    const html = screen();
    const order = [...html.matchAll(/data-section="([a-z]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["streaks", "curve", "attendance", "archive"]);
    expect(html).toMatch(/<h2 id="profile-attendance"[^>]*>Registre de présence<\/h2>/);
    expect(screen(profileFixtures.early)).toContain('data-section="attendance"');
  });

  it("absent under three races", () => {
    expect(screen(profileFixtures["one-race"])).not.toContain('data-section="attendance"');
    expect(screen(profileFixtures["brand-new"])).not.toContain('data-section="attendance"');
    expect(screen(buildProfile([], PROFILE_FIXTURE_NOW))).not.toContain("FEUILLE DE POINTAGE");
  });
});
