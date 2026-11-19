import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { censusFixtures } from "../view/census-fixtures";
import { keyFileFixtures } from "../view/key-file-fixtures";
import { buildProfile, type Profile } from "../view/profile";
import { profileFixtures, PROFILE_FIXTURE_NOW } from "../view/profile-fixtures";
import { stageView } from "@/components/ui";
import {
  PROFILE_SECTIONS,
  type ProfileKeyboard,
  ProfileScreen,
  profileLabels,
  type ProfileScreenProps,
} from "./profile-screen";

// The keyboard layouts are identity's, read through its barrel (server-only at runtime: these mocks stand in).
vi.mock("@/env", () => ({ env: { NODE_ENV: "test", AUTH_SECRET: "a".repeat(32) } }));
vi.mock("@/server/db", () => ({ db: {} }));
const { keyboardLayoutIds, layouts, numberRows } = await import("@/features/identity");

// #932 C4-C8: the Personnel file screen, drawn from a Profile and the viewer's identity.
const SINCE = new Date("2023-05-24T16:00:00Z");
const LINKS = { play: "/#play", settings: "/settings", signUp: "/sign-up" };
const ACCOUNT = { name: "DOCKET-829", isGuest: false };
const GUEST = { name: "GUEST-4417", isGuest: true };
const css = readFileSync(
  path.join(process.cwd(), "src/features/stats/components/profile.module.css"),
  "utf8",
);

function render(
  profile: Profile,
  over: Partial<ProfileScreenProps> & { lang?: "en" | "fr" } = {},
): string {
  const { lang = "en", ...rest } = over;
  return renderToStaticMarkup(
    <ProfileScreen
      profile={profile}
      viewer={ACCOUNT}
      since={SINCE}
      stage={{ clerkSrc: null, picture: <svg data-picture="" /> }}
      labels={profileLabels(lang === "en" ? en : fr)}
      locale={lang}
      links={LINKS}
      {...rest}
    />,
  );
}

/** The text of an element's children, tags stripped. */
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
/** The inner HTML of the first element carrying `attr`. */
function el(html: string, attr: string): string {
  const at = html.indexOf(attr);
  expect(at, attr).toBeGreaterThanOrEqual(0);
  const open = html.lastIndexOf("<", at);
  const tag = html.slice(open + 1).match(/^\w+/)?.[0] ?? "div";
  let depth = 0;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "g");
  re.lastIndex = open;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(html.indexOf(">", open) + 1, m.index);
  }
  throw new Error(`unclosed ${attr}`);
}
const cell = (html: string, key: string) => text(el(html, `data-figure="${key}"`));

const one = profileFixtures["one-race"];
const full = profileFixtures["two-weeks"];
const blank = profileFixtures["brand-new"];

describe("ProfileScreen hero (C4)", () => {
  it("kicker with the file number, the only h1 with the honorific and a full stop, the service line", () => {
    const fr1 = render(full, { lang: "fr" });
    expect(fr1).toContain("DOSSIER DU PERSONNEL · N° 829");
    expect(fr1.match(/<h1/g)).toHaveLength(1);
    expect(text(el(fr1, 'id="profile-name"'))).toBe("Camarade DOCKET-829.");
    expect(fr1).toContain(
      "En service depuis le 24 mai 2023. Tape en français et en anglais, accents compris.",
    );
    const en1 = render(full);
    expect(en1).toContain("PERSONNEL FILE · № 829");
    expect(en1).toContain(
      "In service since May 24, 2023. Types in French and English, accents included.",
    );
  });

  it("no digits at the end of the name: no number; one language: that language only; none: no sentence", () => {
    const html = render(one, { viewer: { name: "Olga", isGuest: false } });
    expect(html).toContain(">PERSONNEL FILE<");
    expect(html).toContain("In service since May 24, 2023. Types in French, accents included.");
    const en = buildProfile(
      [
        {
          createdAt: PROFILE_FIXTURE_NOW,
          cleanWpm: 30,
          accuracy: 0.9,
          language: "EN",
          durationMs: 1,
          place: 3,
        },
      ],
      PROFILE_FIXTURE_NOW,
    );
    expect(render(en, { lang: "fr" })).toContain(
      "En service depuis le 24 mai 2023. Tape en anglais.",
    );
    expect(text(render(blank))).toContain("In service since May 24, 2023.");
    expect(text(render(blank))).not.toContain("Types in");
  });

  it("an account carries the still red FILE / VERIFIED stamp; a guest the GUEST tag and the sign-up prompt", () => {
    const account = render(full);
    expect(account).toMatch(
      /data-stamp-tone="red"[^>]*data-stamp-size="sm"[^>]*data-stamp-angle="6"/,
    );
    expect(account).toContain('data-stamp-still=""');
    expect(text(account)).toContain("FILEVERIFIED");
    expect(account).not.toContain("data-guest-tag");
    expect(account).not.toContain("data-prompt");

    const guest = render(full, { viewer: GUEST, lang: "fr" });
    expect(guest).not.toContain("VÉRIFIÉ");
    expect(text(el(guest, "data-guest-tag"))).toBe("INVITÉ");
    expect(guest).toMatch(/<a href="\/sign-up"[^>]*>OUVRIR UN DOSSIER →<\/a>/);
    expect(guest).toContain("N° 4417");
  });

  it("identity lost: UNASSIGNED, no number, no stamp, tag or prompt", () => {
    const html = render(blank, { viewer: null, since: null, lang: "fr" });
    expect(text(el(html, 'id="profile-name"'))).toBe("NON ASSIGNÉ.");
    expect(html).toContain(">DOSSIER DU PERSONNEL<");
    expect(html).not.toMatch(/data-stamp-tone="red"[^>]*data-stamp-size="sm"/);
    expect(html).not.toContain("data-guest-tag");
    expect(html).not.toContain("En service");
  });

  it("the stage: ID PICTURE, three still stars, the picture (clerk only with an outfit and WebGL2)", () => {
    const html = render(full, { lang: "fr" });
    expect(html).toContain("PHOTO D&#x27;IDENTITÉ");
    expect(html.match(/data-star-still=""/g)).toHaveLength(3);
    expect(html).toContain('data-stage-view="picture"');
    expect(html).toContain("data-picture");
    expect(stageView({ clerkSrc: "/3d/clerk.html", still: false, webgl: true })).toBe("clerk");
    expect(stageView({ clerkSrc: "/3d/clerk.html", still: false, webgl: false })).toBe("picture");
    expect(stageView({ clerkSrc: "/3d/clerk.html", still: false, webgl: null })).toBe("picture");
    expect(stageView({ clerkSrc: "/3d/clerk.html", still: true, webgl: true })).toBe("picture");
    expect(stageView({ clerkSrc: null, still: false, webgl: true })).toBe("picture");
  });

  it("level 3 (a /design specimen) renders no h1", () => {
    const html = render(full, { level: 3 });
    expect(html).not.toContain("<h1");
    expect(html).toMatch(/<h3 id="profile-name"/);
    expect(html).toMatch(/<h4 id="profile-service"/);
  });

  it("the hero grid and stage follow the reference", () => {
    expect(css).toContain(
      "grid-template-columns: repeat(auto-fit, minmax(min(100%, 440px), 1fr));",
    );
    expect(css).toContain("min-height: 460px;");
    expect(css).toContain("inset: 60px 12% 40px;");
    expect(css).toContain("font-size: clamp(40px, 5.6vw, 76px);");
    expect(css).toContain("max-width: 12ch;");
  });
});

describe("ProfileScreen tubes (C5)", () => {
  const tubes = (html: string) =>
    [...html.matchAll(/data-tube=""[^>]*>([^<]*)</g)].map((m) => m[1]);

  it("mean WPM and best rounded, mean accuracy one decimal in the locale, medals = wins", () => {
    const s = full.service;
    const html = render(full, { lang: "fr" });
    expect(tubes(html)).toEqual([
      String(Math.round(s.meanWpm ?? 0)),
      String(Math.round(s.bestWpm ?? 0)),
      ((s.meanAccuracy ?? 0) * 100).toFixed(1).replace(".", ","),
      String(s.wins).padStart(2, "0"),
    ]);
    expect(tubes(render(one))).toEqual(["42", "42", "94.7", "01"]);
  });

  it("no race: --, --, --, 00; the group is named and reads in words, glyphs hidden", () => {
    const html = render(blank);
    expect(tubes(html)).toEqual(["--", "--", "--", "00"]);
    expect(html).toContain('role="group" aria-label="Your figures"');
    expect(html).toContain('<span class="sr-only">AVG WPM: none</span>');
    expect(html).toContain('<span class="sr-only">MEDALS: 00</span>');
    expect(css).toContain("grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));");
  });
});

describe("ProfileScreen band and tabs (C6)", () => {
  it("the band is hidden, static, with the file number and red stars", () => {
    const html = render(full, { lang: "fr" });
    const band = el(html, "data-band");
    expect(html).toMatch(/aria-hidden="true" data-band=""/);
    expect(text(band)).toContain(
      "CONFIDENTIEL ★ DOSSIER N° 829 ★ CHAQUE FRAPPE EST ARCHIVÉE ★ LE MAJOR A PRIS DES NOTES",
    );
    expect(css).toMatch(/transform: rotate\(-1\.4deg\)/);
    expect(css).toMatch(/border-top: 7px solid var\(--color-primary\)/);
    expect(css).not.toMatch(/\.band[^{]*\{[^}]*animation/);
  });

  it("the tabs: a nav, the current one aria-current, the other a link to /settings, 44px", () => {
    const html = render(full, { lang: "fr" });
    expect(html).toMatch(/<nav aria-label="Sections du dossier"/);
    expect(html).toMatch(/aria-current="page"[^>]*>01 · STATISTIQUES</);
    expect(html).toMatch(/<a href="\/settings"[^>]*>02 · RÉGLAGES DU DOSSIER</);
    expect(css).toMatch(/\.tab \{[^}]*min-height: 44px/);
  });
});

describe("ProfileScreen service record (C7)", () => {
  it("twelve cells in order (#951: four more fill the grid), each equal to its service field, best speed the one red figure", () => {
    const html = render(one, { lang: "fr" });
    const keys = [...html.matchAll(/data-figure="(\w+)"/g)].map((m) => m[1]);
    expect(keys).toEqual([
      "totalTime",
      "races",
      "bestSpeed",
      "averageSpeed",
      "bestAccuracy",
      "averageAccuracy",
      "wins",
      "podiums",
      "keystrokes",
      "errors",
      "sabotagesSent",
      "sabotagesReceived",
    ]);
    expect(cell(html, "totalTime")).toBe("TEMPS TOTAL00:00:47");
    expect(cell(html, "races")).toBe("COURSES1");
    expect(cell(html, "bestSpeed")).toBe("MEILLEURE VITESSE42,3 MPM");
    expect(cell(html, "bestAccuracy")).toBe("PRÉCISION MAX94,7 %");
    expect(cell(html, "wins")).toBe("VICTOIRES1 1RE PLACE");
    expect(cell(html, "podiums")).toBe("PODIUMS1 TOP 3");
    expect(html.match(/figureRed/g)).toHaveLength(1);
    expect(el(html, 'data-figure="bestSpeed"')).toContain("figureRed");
    expect(cell(render(one), "bestSpeed")).toBe("BEST SPEED42.3 WPM");
  });

  it("long service: hours past 24 stay in hh:mm:ss", () => {
    const p = { ...full, service: { ...full.service, totalMs: (14 * 3600 + 32 * 60 + 8) * 1000 } };
    expect(cell(render(p), "totalTime")).toBe("TOTAL TIME14:32:08");
  });

  it("no race: every cell reads — with no unit", () => {
    const html = render(blank);
    for (const key of ["totalTime", "races", "bestSpeed", "wins", "podiums"])
      expect(text(el(html, `data-figure="${key}"`)).endsWith("—")).toBe(true);
    const grid = html.slice(html.indexOf("<dl"), html.indexOf("</dl>"));
    expect(grid).not.toContain("WPM");
    expect(grid).not.toContain("TOP 3");
    expect(grid).not.toContain("%");
  });
});

describe("ProfileScreen blank block (C8)", () => {
  it("0 races: the stamp, the kicker, nothing on you, the sentence and QUICK RACE to the play section", () => {
    const html = render(blank, { lang: "fr" });
    const block = el(html, "data-blank");
    expect(text(block)).toContain("DONNÉESINSUFFISANTES");
    expect(block).toContain("DOSSIER VIERGE");
    expect(text(block)).toContain("Le Ministère n'a rien sur toi.");
    expect(text(block)).toContain(
      "Termine trois courses et les graphiques apparaîtront ici : vitesse, précision, touches faibles, registre de présence.",
    );
    expect(block).toMatch(/<a href="\/#play"[^>]*>COURSE RAPIDE<\/a>/);
    expect(block).toMatch(/data-stamp-size="lg"[^>]*data-stamp-angle="-6"/);
  });

  it("1 or 2 races: almost nothing; 3 or more: no block", () => {
    expect(text(render(one))).toContain("The Ministry has almost nothing on you.");
    expect(render(profileFixtures.early)).not.toContain("data-blank");
    expect(render(full)).not.toContain("data-blank");
  });

  it("no state shows NaN, null, undefined or an empty figure", () => {
    for (const profile of [blank, one, profileFixtures.early, full])
      for (const viewer of [ACCOUNT, GUEST, null])
        for (const lang of ["en", "fr"] as const) {
          const html = render(profile, { viewer, lang });
          expect(text(html)).not.toMatch(/NaN|null|undefined/);
          expect(html).not.toMatch(/<dd[^>]*><\/dd>/);
        }
  });
});

describe("profileLabels", () => {
  it("fr and en carry the same profile keys", () => {
    const keys = (o: object, p = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === "object" && v !== null && !Array.isArray(v)
          ? keys(v, `${p}${k}.`)
          : [`${p}${k}`],
      );
    expect(keys(profileLabels(fr)).sort()).toEqual(keys(profileLabels(en)).sort());
  });
});

// #970 C1, C2: the whole file in the reference's order (Profil.dc.html top to bottom, bible 14.3), its
// heading levels, and the blank file's sentence (the reference's line 138).
const KEYBOARD: ProfileKeyboard = {
  initial: "CSA",
  layouts: keyboardLayoutIds.map((id) => ({
    id,
    keys: { number: numberRows[id], letters: layouts[id] },
  })),
};

/** The whole file, every section present: the census read awaited (it streams in its own boundary). */
async function renderAll(
  lang: "en" | "fr",
  over: Partial<ProfileScreenProps> = {},
): Promise<string> {
  const { prelude } = await prerender(
    <ProfileScreen
      profile={full}
      viewer={ACCOUNT}
      since={SINCE}
      stage={{ clerkSrc: null, picture: <svg data-picture="" /> }}
      labels={profileLabels(lang === "en" ? en : fr)}
      locale={lang}
      links={LINKS}
      census={async () => censusFixtures.middle!}
      keyFile={keyFileFixtures.twoWeeks}
      keyboard={KEYBOARD}
      {...over}
    />,
    // the census boundary inline, where it streams in (a large boundary is otherwise outlined to the end)
    { progressiveChunkSize: Number.POSITIVE_INFINITY },
  );
  let html = "";
  const decoder = new TextDecoder();
  const reader = prelude.getReader();
  for (let r = await reader.read(); !r.done; r = await reader.read())
    html += decoder.decode(r.value, { stream: true });
  return html + decoder.decode();
}

const markers = (html: string) => [...html.matchAll(/data-section="([^"]+)"/g)].map((m) => m[1]);
const headingLevels = (html: string) =>
  [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));

describe("ProfileScreen reference order (#970 C1)", () => {
  it("the column's sections are one list, in the reference's order", () => {
    expect(PROFILE_SECTIONS).toEqual([
      "service",
      "blank",
      "dockets",
      "bests",
      "census",
      "keyProgress",
      "curve",
      "keySheet",
      "keyInventory",
      "keyboardMap",
      "attendance",
      "medals",
      "archive",
    ]);
  });

  it("with every section present the file reads hero, band, tabs, service record, the docket row, then the reference's sections", async () => {
    const html = await renderAll("fr");
    expect(markers(html)).toEqual([
      "hero",
      "band",
      "tabs",
      "service",
      "streaks",
      "suspect-pairs",
      "census",
      "key-progress",
      "curve",
      "key-sheet",
      "key-inventory",
      "keyboard-map",
      "attendance",
      "archive",
    ]);
    // the grade ladder sits in the hero; the clean streaks and the suspect pairs share one row
    const hero = html.slice(
      html.indexOf('data-section="hero"'),
      html.indexOf('data-section="band"'),
    );
    expect(hero).toContain("data-ladder");
    const row = el(html, "data-docket-pair");
    expect(markers(row)).toEqual(["streaks", "suspect-pairs"]);
    // the headings the reader meets, in that order
    const titles = [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map((m) =>
      text(m[1]!).toUpperCase(),
    );
    expect(titles).toEqual([
      "ÉTAT DE SERVICE",
      "SÉRIES SANS FAUTE",
      "COMBINAISONS SUSPECTES",
      "TA PLACE AU MINISTÈRE",
      "PROGRESSION PAR TOUCHE",
      "VITESSE AU FIL DES COURSES",
      "FICHE PAR TOUCHE",
      "VITESSE, FRAPPES ET FAUTES",
      "CARTE DU CLAVIER",
      "REGISTRE DE PRÉSENCE",
      "ARCHIVES DES COURSES",
    ]);
  });

  it("one h1, and the heading levels never skip, on the page and as a /design specimen", async () => {
    for (const lang of ["en", "fr"] as const) {
      const page = headingLevels(await renderAll(lang));
      expect(page.filter((l) => l === 1)).toHaveLength(1);
      expect(page[0]).toBe(1);
      for (let i = 1; i < page.length; i += 1)
        expect(page[i]!, `heading ${i}`).toBeLessThanOrEqual(page[i - 1]! + 1);
      const specimen = headingLevels(await renderAll(lang, { level: 3 }));
      expect(specimen).not.toContain(1);
      expect(specimen[0]).toBe(3);
      for (let i = 1; i < specimen.length; i += 1)
        expect(specimen[i]!).toBeLessThanOrEqual(specimen[i - 1]! + 1);
    }
  });

  it("under three races: hero, band, tabs, the service record, then the blank block and nothing else", async () => {
    for (const profile of [blank, one]) {
      const html = await renderAll("en", { profile });
      expect(markers(html)).toEqual(["hero", "band", "tabs", "service", "blank"]);
    }
  });
});

describe("ProfileScreen blank file sentence (#970 C2)", () => {
  it("the reference's sentence, in French and English, at 0, 1 and 2 races", () => {
    const sentence = (html: string) =>
      text(el(html, "data-blank").match(/<p[^>]*blankBody[^>]*>(.*?)<\/p>/)![1]!);
    const two = buildProfile(
      [0, 1].map((i) => ({
        createdAt: new Date(PROFILE_FIXTURE_NOW.getTime() - i * 3_600_000),
        cleanWpm: 40,
        accuracy: 0.95,
        language: "FR" as const,
        durationMs: 30_000,
        place: 2,
      })),
      PROFILE_FIXTURE_NOW,
    );
    expect(two.service.races).toBe(2);
    for (const profile of [blank, one, two]) {
      expect(sentence(render(profile, { lang: "fr" }))).toBe(
        "Termine trois courses et les graphiques apparaîtront ici : vitesse, précision, touches faibles, registre de présence.",
      );
      expect(sentence(render(profile))).toBe(
        "Finish three races and the graphs will appear here: speed, accuracy, weak keys, attendance register.",
      );
    }
  });
});
