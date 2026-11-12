import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { privacyContentFor } from "./index";
import { allText, LEGALESE, sentences, words } from "./plain-language";
import { privacyEn } from "./privacy.en";
import { privacyFr } from "./privacy.fr";
import { PRIVACY_UPDATED, type PrivacySection } from "./types";

// Card #76 C1-C3. The privacy page text (/privacy), French first, for players aged 12 to 17. Every fact comes
// from docs/privacy and the ADRs; the fact checks below read those files so the page and its sources cannot
// drift apart silently.

const SECTION_IDS = [
  "collect",
  "why",
  "retention",
  "avatars",
  "delete",
  "responsible",
  "cookies",
  "third-parties",
  "rules",
];
const MAX_AVERAGE_WORDS_PER_SENTENCE = 18;
const MAX_WORDS_PER_SENTENCE = 30;
const MAX_SENTENCES_PER_PARAGRAPH = 3;
const MAX_HEADING_CHARS = 48;

const doc = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const section = (sections: readonly PrivacySection[], id: string) => {
  const found = sections.find((s) => s.id === id);
  if (!found) throw new Error(`no section ${id}`);
  return [found.heading, ...found.paragraphs, ...(found.list ?? [])].join(" ");
};

const locales = [
  ["fr", privacyFr],
  ["en", privacyEn],
] as const;

describe("privacy page: parity (C1)", () => {
  it("both languages export the required section ids in the same order", () => {
    expect(privacyFr.map((s) => s.id)).toEqual(SECTION_IDS);
    expect(privacyEn.map((s) => s.id)).toEqual(SECTION_IDS);
  });

  it("each section has the same shape in both languages", () => {
    privacyFr.forEach((fr, i) => {
      const en = privacyEn[i]!;
      expect(fr.paragraphs.length, fr.id).toBe(en.paragraphs.length);
      expect(fr.list?.length ?? 0, fr.id).toBe(en.list?.length ?? 0);
    });
  });

  it("selects the text of the viewer's language", () => {
    expect(privacyContentFor("fr")).toBe(privacyFr);
    expect(privacyContentFor("en")).toBe(privacyEn);
  });

  it("carries an ISO update date", () => {
    expect(PRIVACY_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe.each(locales)("privacy page: plain language (%s, C2)", (locale, content) => {
  const units = content.flatMap((s) => [...s.paragraphs, ...(s.list ?? [])].flatMap(sentences));

  it(`averages at most ${MAX_AVERAGE_WORDS_PER_SENTENCE} words per sentence`, () => {
    const average = units.reduce((n, s) => n + words(s).length, 0) / units.length;
    expect(average).toBeLessThanOrEqual(MAX_AVERAGE_WORDS_PER_SENTENCE);
  });

  it(`keeps every sentence under ${MAX_WORDS_PER_SENTENCE} words and paragraphs to ${MAX_SENTENCES_PER_PARAGRAPH} sentences`, () => {
    for (const s of content) {
      for (const p of s.paragraphs) {
        expect(sentences(p).length, `${s.id}: ${p}`).toBeLessThanOrEqual(
          MAX_SENTENCES_PER_PARAGRAPH,
        );
      }
    }
    for (const sentence of units) {
      expect(words(sentence).length, sentence).toBeLessThanOrEqual(MAX_WORDS_PER_SENTENCE);
    }
  });

  it("has short headings and at least one paragraph per section", () => {
    for (const s of content) {
      expect(s.heading.length, s.id).toBeGreaterThan(0);
      expect(s.heading.length, s.id).toBeLessThanOrEqual(MAX_HEADING_CHARS);
      expect(s.paragraphs.length, s.id).toBeGreaterThan(0);
    }
  });

  it("speaks to the player in the second person in every section", () => {
    const you = locale === "fr" ? /\b(tu|toi|ton|ta|tes)\b|\bt'/i : /\b(you|your)\b/i;
    for (const s of content) expect(section(content, s.id), s.id).toMatch(you);
    if (locale === "fr") {
      for (const text of allText(content)) expect(text).not.toMatch(/\bvous\b|\bvotre\b|\bvos\b/i);
    }
  });

  it("defines every acronym in brackets the first time it appears", () => {
    const text = allText(content).join("\n");
    for (const match of text.matchAll(/\b[A-ZÀ-Ý][A-ZÀ-Ý0-9]+\b/g)) {
      const acronym = match[0];
      const first = text.indexOf(acronym);
      expect(text.slice(first - 1, first + acronym.length + 1), acronym).toBe(`(${acronym})`);
    }
  });

  it("uses no legalese, no e-mail address and no stray whitespace", () => {
    for (const text of allText(content)) {
      for (const pattern of LEGALESE) expect(text, String(pattern)).not.toMatch(pattern);
      expect(text).not.toMatch(/@/);
      expect(text).toBe(text.trim());
    }
  });
});

describe("privacy page: facts match docs/privacy (C3)", () => {
  const retention = doc("docs/privacy/retention.md");
  const deletion = doc("docs/privacy/deletion-procedure.md");
  const backups = doc("docs/privacy/backup-retention.md");

  // [period in retention.md, French, English]
  const PERIODS = [
    ["12 months (365 days)", "12 mois", "12 months"],
    [
      "Until the student deletes the account",
      "jusqu'à ce que tu le supprimes",
      "until you delete it",
    ],
    ["| 30 days after the race |", "30 jours", "30 days"],
    ["| Request logs and IP addresses | 30 days |", "30 jours", "30 days"],
    ["24 hours after the lobby closes", "24 heures", "24 hours"],
    ["1 hour after the last activity", "1 heure", "1 hour"],
    ["| Backups | 14 days", "14 jours", "14 days"],
    ["At most 1 year", "1 an", "1 year"],
  ] as const;

  it("the retention periods exist in retention.md and in both retention sections", () => {
    for (const [source, fr, en] of PERIODS) {
      expect(retention, source).toContain(source);
      expect(section(privacyFr, "retention"), fr).toContain(fr);
      expect(section(privacyEn, "retention"), en).toContain(en);
    }
  });

  it("the deletion section gives the response time and both paths of deletion-procedure.md", () => {
    expect(deletion).toContain("within 30 days");
    expect(deletion).toContain("through their teacher or school office");
    expect(backups).toContain("14 days");
    const fr = section(privacyFr, "delete");
    const en = section(privacyEn, "delete");
    expect(fr).toMatch(/30 jours/);
    expect(en).toMatch(/30 days/);
    // path 1 (now): through the teacher or the school office
    expect(fr).toMatch(/enseignant.*secrétariat/);
    expect(en).toMatch(/teacher.*school office/);
    // path 2 (#81, not delivered yet): in the settings, in the future tense (owner decision 2026-11-02)
    expect(fr).toMatch(/[Bb]ientôt.*réglages/);
    expect(en).toMatch(/[Ss]oon.*settings/);
    // what remains: backups age out in 14 days
    expect(fr).toContain("14 jours");
    expect(en).toContain("14 days");
  });

  it("the person in charge is the one of responsible.md, without an e-mail address", () => {
    const name = /\| Name \| (.+?) \|/.exec(doc("docs/privacy/responsible.md"))?.[1];
    expect(name).toBeTruthy();
    expect(section(privacyFr, "responsible")).toContain(name!);
    expect(section(privacyEn, "responsible")).toContain(name!);
    expect(section(privacyFr, "responsible")).toMatch(/enseignant/);
    expect(section(privacyEn, "responsible")).toMatch(/teacher/);
  });

  it("the data location is the one of ADR 0019 (Railway, region sfo)", () => {
    expect(doc("docs/adr/0019-railway-hosting.md")).toContain("region `sfo`");
    expect(section(privacyFr, "third-parties")).toMatch(/Railway.*États-Unis.*San Francisco/);
    expect(section(privacyEn, "third-parties")).toMatch(/Railway.*United States.*San Francisco/);
  });

  it("names GitHub, Discord and Google, the sign-in services of consent.md, with their age rule", () => {
    expect(doc("docs/privacy/consent.md")).toContain("GitHub, Discord or Google sign-in");
    for (const [content, age] of [
      [privacyFr, "13 ans"],
      [privacyEn, "13 or older"],
    ] as const) {
      const text = section(content, "third-parties");
      for (const name of ["GitHub", "Discord", "Google"]) expect(text, name).toContain(name);
      expect(text).toContain(age);
      // delivered (#49, #828): present tense, no "soon"
      expect(text).not.toMatch(/bientôt|soon/i);
    }
  });

  it("the picture audiences are those of ADR 0022 (owner, room and race mates for 24 h)", () => {
    expect(doc("docs/privacy/inventory.md")).toContain("for 24 h after that race ended");
    expect(section(privacyFr, "avatars")).toMatch(/salon ou une course.*24 heures/);
    expect(section(privacyEn, "avatars")).toMatch(/lobby or a race.*24 hours/);
  });

  it("the session cookie is delivered (#38) and lasts SESSION_MAX_AGE", () => {
    const seconds = /SESSION_MAX_AGE = ([\d_]+);/.exec(doc("src/server/auth/auth.ts"))?.[1];
    expect(seconds).toBeTruthy();
    const days = Number(seconds!.replaceAll("_", "")) / 86_400;
    const item = (content: readonly PrivacySection[], label: RegExp) =>
      content.find((s) => s.id === "cookies")!.list!.find((i) => label.test(i))!;
    expect(item(privacyFr, /^Témoin de session/)).toContain(`${days} jours`);
    expect(item(privacyEn, /^Session cookie/)).toContain(`${days} days`);
    expect(item(privacyFr, /^Témoin de session/)).not.toMatch(/bientôt/);
    expect(item(privacyEn, /^Session cookie/)).not.toMatch(/soon/i);
  });

  it("names the four cookies", () => {
    for (const content of [privacyFr, privacyEn]) {
      const text = section(content, "cookies");
      for (const name of ["fc_guest", "locale", "theme"]) expect(text, name).toContain(name);
      expect(text).toMatch(/session/i);
    }
  });
});
