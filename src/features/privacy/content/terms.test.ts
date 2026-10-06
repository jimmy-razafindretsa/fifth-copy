import { describe, expect, it } from "vitest";
import { termsEn } from "./terms.en";
import { termsFr } from "./terms.fr";
import { TERMS_UPDATED, type PrivacySection } from "./types";

// Card #91 C2. Conduct rules shown on /privacy#rules (rendering: #80). Bible 2: short declarative sentences,
// 1-3 sentences per paragraph, "tu" form in French. Plain language is checked mechanically below.

const REQUIRED_IDS = ["usernames", "avatars", "fair-play", "consequences"];
const MAX_SENTENCES_PER_PARAGRAPH = 3;
const MAX_WORDS_PER_SENTENCE = 30;
const MAX_WORDS_PER_LIST_ITEM = 20;
const MAX_HEADING_CHARS = 48;

const LEGALESE = [
  /\bhereby\b/i,
  /\bherein(after)?\b/i,
  /\bthereof\b/i,
  /\bwhereas\b/i,
  /\bnotwithstanding\b/i,
  /\baforementioned\b/i,
  /\bpursuant\b/i,
  /\bshall\b/i,
  /\bci-après\b/i,
  /\bnonobstant\b/i,
  /\bsusmentionnée?s?\b/i,
  /\battendu que\b/i,
  /\bledit\b|\bladite\b|\blesdit(e)?s\b/i,
];

const sentences = (paragraph: string) =>
  paragraph
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
const words = (text: string) => text.split(/\s+/).filter(Boolean);
const allText = (sections: readonly PrivacySection[]) =>
  sections.flatMap((s) => [s.heading, ...s.paragraphs, ...(s.list ?? [])]);

const locales = [
  ["fr", termsFr],
  ["en", termsEn],
] as const;

describe("conduct rules: parity (C2)", () => {
  it("both languages export the same section ids in the same order", () => {
    expect(termsFr.map((s) => s.id)).toEqual(termsEn.map((s) => s.id));
  });

  it("contain the required sections", () => {
    for (const [, terms] of locales) {
      const ids = terms.map((s) => s.id);
      for (const id of REQUIRED_IDS) expect(ids, id).toContain(id);
    }
  });

  it("ids are unique, kebab-case and usable as anchors", () => {
    const ids = termsEn.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it("each section has the same shape in both languages", () => {
    termsFr.forEach((fr, i) => {
      const en = termsEn[i]!;
      expect(fr.paragraphs.length, fr.id).toBe(en.paragraphs.length);
      expect(fr.list?.length ?? 0, fr.id).toBe(en.list?.length ?? 0);
    });
  });

  it("carries an ISO update date", () => {
    expect(TERMS_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe.each(locales)("conduct rules: plain language (%s)", (locale, terms) => {
  it("has short headings and at least one paragraph per section", () => {
    for (const s of terms) {
      expect(s.heading.trim().length, s.id).toBeGreaterThan(0);
      expect(s.heading.length, s.id).toBeLessThanOrEqual(MAX_HEADING_CHARS);
      expect(s.paragraphs.length, s.id).toBeGreaterThan(0);
    }
  });

  it(`keeps paragraphs to ${MAX_SENTENCES_PER_PARAGRAPH} sentences of at most ${MAX_WORDS_PER_SENTENCE} words`, () => {
    for (const s of terms) {
      for (const p of s.paragraphs) {
        const ss = sentences(p);
        expect(ss.length, `${s.id}: ${p}`).toBeLessThanOrEqual(MAX_SENTENCES_PER_PARAGRAPH);
        for (const sentence of ss) {
          expect(words(sentence).length, `${s.id}: ${sentence}`).toBeLessThanOrEqual(
            MAX_WORDS_PER_SENTENCE,
          );
        }
      }
    }
  });

  it(`keeps list items to ${MAX_WORDS_PER_LIST_ITEM} words`, () => {
    for (const s of terms) {
      for (const item of s.list ?? []) {
        expect(words(item).length, `${s.id}: ${item}`).toBeLessThanOrEqual(MAX_WORDS_PER_LIST_ITEM);
      }
    }
  });

  it("uses no legalese", () => {
    for (const text of allText(terms)) {
      for (const pattern of LEGALESE) expect(text, String(pattern)).not.toMatch(pattern);
    }
  });

  it("has no empty strings or stray whitespace", () => {
    for (const text of allText(terms)) expect(text).toBe(text.trim());
  });

  if (locale === "fr") {
    it('speaks to the player with "tu" (bible 2)', () => {
      for (const text of allText(terms)) expect(text).not.toMatch(/\bvous\b|\bvotre\b|\bvos\b/i);
    });
  }
});
