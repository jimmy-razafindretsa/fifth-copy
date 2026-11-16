import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import type { ArchiveEntry } from "../view/archive";
import { buildProfile, type Profile } from "../view/profile";
import { profileFixtures } from "../view/profile-fixtures";
import type { ProfileStreak } from "../view/streaks";
import { ArchiveSection, StreaksDocket } from "./profile-records";
import { ProfileScreen, profileLabels } from "./profile-screen";

// #936 C3, C4, C5 (structure): the clean streaks docket and the race archives.
const css = readFileSync(
  path.join(process.cwd(), "src/features/stats/components/profile.module.css"),
  "utf8",
);
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
const rows = (html: string, attr: string) =>
  html
    .split(attr)
    .slice(1)
    .map((part) => text(part.slice(part.indexOf(">") + 1).split("</tr>")[0]!));

const STREAKS: ProfileStreak[] = [
  { threshold: 100, best: 0, wpmDuring: null, current: 0 },
  { threshold: 98, best: 9, wpmDuring: 37.44, current: 2 },
  { threshold: 95, best: 23, wpmDuring: 36.8, current: 6 },
  { threshold: 90, best: 61, wpmDuring: 36.1, current: 0 },
];

const streaks = (lang: "en" | "fr") =>
  renderToStaticMarkup(
    <StreaksDocket
      streaks={STREAKS}
      labels={profileLabels(lang === "en" ? en : fr).streaks}
      locale={lang}
      id="s"
      heading="h2"
    />,
  );

const AT = new Date(Date.UTC(2026, 10, 12, 15, 42)).toISOString(); // 12 Nov 10:42, Toronto
const entry = (over: Partial<ArchiveEntry>): ArchiveEntry => ({
  at: AT,
  room: "KGB-4821",
  mode: "RACE",
  place: 1,
  lobbySize: 30,
  cleanWpm: 44.1,
  accuracy: 0.968,
  ...over,
});
const archive = (entries: ArchiveEntry[], lang: "en" | "fr" = "fr") =>
  renderToStaticMarkup(
    <ArchiveSection
      archive={entries}
      labels={profileLabels(lang === "en" ? en : fr).archive}
      locale={lang}
      id="a"
      heading="h2"
    />,
  );

describe("StreaksDocket (#936 C3)", () => {
  it("header and ink tag, column heads and four threshold rows in French", () => {
    const html = streaks("fr");
    expect(text(html)).toContain("SÉRIES SANS FAUTE COURSES D'AFFILÉE");
    expect(html).toMatch(/<h2 id="s"[^>]*>SÉRIES SANS FAUTE<\/h2>/);
    expect(html).toContain("<table");
    expect(html).toContain("<caption");
    expect(html.match(/<th scope="col">[^<]*<\/th>/g)?.map(text)).toEqual([
      "SEUIL",
      "RECORD",
      "MPM DURANT",
      "EN COURS",
    ]);
    expect(rows(html, "data-streak=")).toEqual([
      "≥ 100 % 0 — 0",
      "≥ 98 % 9 37,4 2",
      "≥ 95 % 23 36,8 6",
      "≥ 90 % 61 36,1 0",
    ]);
    expect(text(html)).toContain(
      "La plus longue suite de courses terminées au-dessus de chaque seuil de précision. Plus la suite est longue, plus le Major est content.",
    );
  });

  it("English copy, one decimal with a point; a current run of 0 is muted", () => {
    const html = streaks("en");
    expect(text(html)).toContain("CLEAN STREAKS RACES IN A ROW");
    expect(html.match(/<th scope="col">[^<]*<\/th>/g)?.map(text)).toEqual([
      "THRESHOLD",
      "BEST",
      "WPM DURING",
      "CURRENT",
    ]);
    expect(rows(html, "data-streak=")[1]).toBe("≥ 98 % 9 37.4 2");
    expect(text(html)).toContain(
      "Your longest run of finished races above each accuracy threshold. The longer the run, the happier the Major.",
    );
    expect(html.match(/data-muted=""/g)).toHaveLength(2);
  });

  it("the docket sits in the reference's two-column grid (480px cells, 28px gap)", () => {
    expect(css).toMatch(
      /\.pair \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 480px\), 1fr\)\);[^}]*gap: 28px;/,
    );
  });
});

describe("ArchiveSection (#936 C4)", () => {
  it("kicker with the count, h2, a captioned table with the column heads, the award head read only", () => {
    const html = archive(Array.from({ length: 8 }, () => entry({})));
    expect(text(html)).toContain("ARCHIVES · 8 DERNIÈRES ENTRÉES");
    expect(html).toMatch(/<h2 id="a"[^>]*>Archives des courses<\/h2>/);
    expect(html).toContain("<caption");
    expect(html.match(/<th scope="col">.*?<\/th>/g)?.map(text)).toEqual([
      "DATE",
      "SALLE",
      "MODE",
      "RANG",
      "MPM",
      "PRÉCISION",
      "Distinction",
    ]);
    expect(html).toMatch(/<th scope="col"><span class="sr-only">Distinction<\/span><\/th>/);
    expect(html).toMatch(/role="region" aria-label="[^"]+" tabindex="0"/);
  });

  it("rows: date, room or —, mode, place / size, WPM, accuracy, the award tag", () => {
    const html = archive([
      entry({}),
      entry({ room: null, mode: "BOTS", place: 2, lobbySize: 4 }),
      entry({ mode: "PRIVATE", place: 3, lobbySize: 24 }),
      entry({ place: 4 }),
      entry({ place: null }),
    ]);
    expect(text(html)).toContain("ARCHIVES · 5 DERNIÈRES ENTRÉES");
    expect(rows(html, "data-archive-row=")).toEqual([
      "12 NOV · 10:42 KGB-4821 COURSE 1 / 30 44,1 96,8 % MÉDAILLE",
      "12 NOV · 10:42 — BOTS 2 / 4 44,1 96,8 % PODIUM",
      "12 NOV · 10:42 KGB-4821 PRIVÉE 3 / 24 44,1 96,8 % PODIUM",
      "12 NOV · 10:42 KGB-4821 COURSE 4 / 30 44,1 96,8 %",
      "12 NOV · 10:42 KGB-4821 COURSE — 44,1 96,8 %",
    ]);
    expect(html.match(/data-award="medal"/g)).toHaveLength(1);
    expect(html.match(/data-award="podium"/g)).toHaveLength(2);
  });

  it("one entry: DERNIÈRE ENTRÉE / LAST ENTRY; English modes and awards", () => {
    expect(text(archive([entry({})]))).toContain("ARCHIVES · DERNIÈRE ENTRÉE");
    const html = archive([entry({}), entry({ mode: "PRIVATE", place: 2 })], "en");
    expect(text(html)).toContain("ARCHIVES · LAST 2 ENTRIES");
    expect(html).toMatch(/>Race archives<\/h2>/);
    expect(rows(html, "data-archive-row=")).toEqual([
      "12 NOV · 10:42 KGB-4821 RACE 1 / 30 44.1 96.8 % MEDAL",
      "12 NOV · 10:42 KGB-4821 PRIVATE 2 / 30 44.1 96.8 % PODIUM",
    ]);
    expect(text(archive([entry({})], "en"))).toContain("ARCHIVES · LAST ENTRY");
  });

  it("the medal is a gold ground with ink text, the podium paper on ink; the table is 720px wide in a scrolling frame", () => {
    expect(css).toMatch(
      /\.goldTag \{[^}]*background: var\(--color-reward\);[^}]*color: var\(--color-band\);/,
    );
    expect(css).toMatch(/\.archiveFrame \{[^}]*overflow-x: auto;/);
    expect(css).toMatch(/\.archive \{[^}]*min-width: 720px;/);
  });
});

describe("ProfileScreen with streaks and archives (#936 C5)", () => {
  const render = (profile: Profile) =>
    renderToStaticMarkup(
      <ProfileScreen
        profile={profile}
        viewer={{ name: "DOCKET-829", isGuest: false }}
        since={null}
        stage={{ clerkSrc: null, picture: <svg /> }}
        labels={profileLabels(en)}
        locale="en"
        links={{ play: "/#play", settings: "/settings", signUp: "/sign-up" }}
      />,
    );

  it("from three races: service, streaks, curve, archive in that order, the archive last", () => {
    const html = render(profileFixtures.early);
    const order = [...html.matchAll(/<section aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
    expect(order.slice(-4)).toEqual([
      "profile-service",
      "profile-streaks",
      "profile-curve",
      "profile-archive",
    ]);
    expect(html.match(/data-archive-row=""/g)).toHaveLength(3);
  });

  it("under three races: neither section", () => {
    for (const p of [profileFixtures["one-race"], profileFixtures["brand-new"]]) {
      const html = render(p);
      expect(html).not.toContain('data-section="streaks"');
      expect(html).not.toContain('data-section="archive"');
    }
  });

  it("the two-week file shows eight rows with medals and podiums, no NaN or undefined", () => {
    const html = render(profileFixtures["two-weeks"]);
    expect(html.match(/data-archive-row=""/g)).toHaveLength(8);
    expect(html).not.toMatch(/NaN|undefined|null/);
    expect(buildProfile([], new Date()).streaks.map((s) => s.best)).toEqual([0, 0, 0, 0]);
  });
});
