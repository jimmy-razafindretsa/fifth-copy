import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BOT_LEVEL_WPM, BOT_LEVELS } from "@fifth-copy/engine";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { rankFor } from "../view/rank";
import { profileFixtures } from "../view/profile-fixtures";
import { spokenRank } from "@/i18n/format";
import { GradeLadder } from "./grade-ladder";
import { ProfileScreen, profileLabels } from "./profile-screen";

// #337 C1-C4: the grade ladder under the hero's four figures.
const labelsOf = (lang: "en" | "fr") => {
  const t = lang === "en" ? en : fr;
  return { ...t.profile.ladder, ranks: t.landing.clerk.ranks };
};

function render(meanWpm: number | null, lang: "en" | "fr" = "en"): string {
  return renderToStaticMarkup(
    <GradeLadder
      step={rankFor(meanWpm)}
      meanWpm={meanWpm}
      labels={labelsOf(lang)}
      locale={lang}
      id="profile-ladder"
    />,
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
const line = (html: string) => text(html.match(/data-ladder-line="">(.*?)<\/span>/)?.[1] ?? "");
const chips = (html: string) =>
  [...html.matchAll(/<li data-grade="(\w+)" data-state="(\w+)"([^>]*)>(.*?)<\/li>/g)].map((m) => ({
    level: m[1],
    state: m[2],
    attrs: m[3] ?? "",
    body: m[4] ?? "",
  }));
const bar = (html: string) => html.match(/<div role="progressbar"[^>]*>/)?.[0] ?? "";

/** A mean inside each grade, read from the engine's scale (no literal threshold). */
const insideEach = BOT_LEVELS.map((level, i) =>
  i === 0 ? BOT_LEVEL_WPM[BOT_LEVELS[1]!] / 2 : BOT_LEVEL_WPM[level] + 1,
);

describe("GradeLadder head row (C1)", () => {
  it("the label left, the mean to one decimal, the next threshold and grade right", () => {
    const fr1 = render(51.4, "fr");
    expect(fr1).toContain("ÉCHELLE DES GRADES · SELON TA MOYENNE");
    expect(line(fr1)).toBe("51,4 / 70 MPM → COMMISSAIRE");
    const en1 = render(51.4);
    expect(en1).toContain("GRADE LADDER · BY YOUR AVERAGE");
    expect(line(en1)).toBe("51.4 / 70 WPM → COMMISSAR");
  });

  it("at the top grade the line is TOP GRADE / GRADE MAXIMAL", () => {
    expect(line(render(95))).toBe("TOP GRADE");
    expect(line(render(95, "fr"))).toBe("GRADE MAXIMAL");
  });
});

describe("GradeLadder chips (C2)", () => {
  it.each(BOT_LEVELS.map((level, i) => [level, i] as const))(
    "%s current: passed before, current on red, ahead after, five in scale order",
    (level, index) => {
      const html = render(insideEach[index]!);
      const list = chips(html);
      expect(list.map((c) => c.level)).toEqual([...BOT_LEVELS]);
      list.forEach((c, i) =>
        expect(c.state).toBe(i < index ? "passed" : i === index ? "current" : "ahead"),
      );
      const current = list.filter((c) => c.attrs.includes('aria-current="true"'));
      expect(current.map((c) => c.level)).toEqual([level]);
      expect(rankFor(insideEach[index]!).rank).toBe(level);
    },
  );

  it("names come from the catalogs' rank list; the current one reads its name and current grade", () => {
    const html = render(51.4);
    expect(chips(html).map((c) => text(c.body).replace(/Officer, current grade$/, ""))).toEqual([
      ...en.landing.clerk.ranks,
    ]);
    expect(html).toContain('<span class="sr-only">Officer, current grade</span>');
    expect(render(51.4, "fr")).toContain('<span class="sr-only">Officier, grade actuel</span>');
  });

  it("an ordered list named by the label", () => {
    expect(render(51.4)).toMatch(/<span id="profile-ladder">GRADE LADDER/);
    expect(render(51.4)).toMatch(/<ol [^>]*aria-labelledby="profile-ladder"/);
  });

  it("the last chip keeps its distinct (double ink) rule only while ahead", () => {
    const top = (html: string) => chips(html).at(-1)!.attrs;
    expect(top(render(51.4))).toMatch(/class="[^"]*gradeTop/);
    expect(top(render(95))).not.toMatch(/gradeTop/);
  });

  it("spoken rank names keep only the first capital", () => {
    expect(spokenRank("HÉROS DE LA PAPERASSE", "fr")).toBe("Héros de la paperasse");
    expect(spokenRank("HERO OF PAPERWORK", "en")).toBe("Hero of paperwork");
  });
});

describe("GradeLadder bar (C3)", () => {
  it("a named progressbar filled to progress", () => {
    const html = render(51.4);
    const pct = Math.round(rankFor(51.4).progress * 100);
    expect(bar(html)).toContain('aria-label="Progress to Commissar"');
    expect(bar(html)).toContain('aria-valuemin="0"');
    expect(bar(html)).toContain('aria-valuemax="100"');
    expect(bar(html)).toContain(`aria-valuenow="${pct}"`);
    expect(html).toContain(`style="width:${pct}%"`);
  });

  it("full at the top grade", () => {
    const html = render(95, "fr");
    expect(bar(html)).toContain('aria-label="Grade maximal atteint"');
    expect(bar(html)).toContain('aria-valuenow="100"');
    expect(html).toContain('style="width:100%"');
  });
});

describe("GradeLadder on the file (C4)", () => {
  const screen = (
    profile = profileFixtures["two-weeks"],
    isGuest = false,
    lang: "en" | "fr" = "en",
  ) =>
    renderToStaticMarkup(
      <ProfileScreen
        profile={profile}
        viewer={{ name: isGuest ? "GUEST-4417" : "DOCKET-829", isGuest }}
        since={null}
        stage={{ clerkSrc: null, picture: <svg /> }}
        labels={profileLabels(lang === "en" ? en : fr)}
        locale={lang}
        links={{ play: "/#play", settings: "/settings", signUp: "/sign-up" }}
      />,
    );

  it("one scale: the grade comes from rankFor(profile.service.meanWpm)", () => {
    const profile = profileFixtures["two-weeks"];
    const html = screen(profile);
    expect(html).toContain(`data-ladder="" data-grade="${rankFor(profile.service.meanWpm).rank}"`);
  });

  it("no counted race reads Recruit at 0", () => {
    const blank = profileFixtures["brand-new"];
    const fr1 = screen(blank, false, "fr");
    expect(line(fr1)).toBe("0,0 / 35 MPM → COMMIS");
    expect(chips(fr1)[0]!.attrs).toContain('aria-current="true"');
    expect(line(screen(blank))).toBe("0.0 / 35 WPM → CLERK");
  });

  it("a guest sees the ladder on their own file", () => {
    expect(screen(profileFixtures["two-weeks"], true)).toContain("data-ladder=");
  });

  it("no threshold literal in the component or the catalogs' ladder strings", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/features/stats/components/grade-ladder.tsx"),
      "utf8",
    );
    for (const wpm of Object.values(BOT_LEVEL_WPM).filter((n) => n > 0)) {
      expect(src).not.toMatch(new RegExp(`\\b${wpm}\\b`));
    }
    for (const t of [en, fr]) expect(JSON.stringify(t.profile.ladder)).not.toMatch(/\d/);
  });
});
