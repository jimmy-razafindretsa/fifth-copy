import type { PrivacySection } from "./types";

/**
 * Plain-language helpers shared by the conduct-rules test (#91) and the privacy-page test (#76): pure, no
 * dependency. Sentences split after `.`, `!` or `?` followed by a space, so the texts never abbreviate with a
 * period ("article 32", never "s. 32").
 */

/** Wording that reads like a contract, in English and French: never used in the player-facing texts. */
export const LEGALESE: readonly RegExp[] = [
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

export const sentences = (paragraph: string) =>
  paragraph
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

export const words = (text: string) => text.split(/\s+/).filter(Boolean);

/** Every string a reader sees in the sections: headings, paragraphs and list items. */
export const allText = (sections: readonly PrivacySection[]) =>
  sections.flatMap((s) => [s.heading, ...s.paragraphs, ...(s.list ?? [])]);
