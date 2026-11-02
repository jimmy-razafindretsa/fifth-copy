import { describe, expect, it } from "vitest";
import { charsOf } from "../text/chars";
import { hesitatesBefore } from "./hesitation";
import { botProfile } from "./profile";
import { drive, mean, MODES, SEEDS } from "./testing/drive";
import { FIXTURE_EN, FIXTURE_FR } from "./testing/fixture";
import { BOT_LEVELS, type BotLanguage, type BotProfile } from "./types";

// #361 C5 (owner replan 2026-11-02): long pauses (>= 1.5x the bot's mean delay) before punctuation
// and accented characters in >= 30 % of those positions, in <= 10 % of the others; with
// `hesitation` 0, <= 10 % before punctuation and accents too. Errors off.
const SETTINGS = MODES[0]!;
const TEXTS = [
  ["fr", FIXTURE_FR],
  ["en", FIXTURE_EN],
] as const satisfies readonly (readonly [BotLanguage, string])[];

/** Stated independently of the model: not a letter, digit or space; or a non-ASCII letter. */
const isMarked = (ch: string) =>
  ch !== " " && (/[^\p{L}\p{Nd}]/u.test(ch) || /[^\x00-\x7f]/.test(ch));

function longShares(profile: BotProfile, text: string, lang: BotLanguage) {
  const chars = charsOf(text);
  let marked = 0;
  let markedLong = 0;
  let other = 0;
  let otherLong = 0;
  for (const seed of SEEDS) {
    const { keys } = drive(profile, text, SETTINGS, seed, lang);
    const threshold = 1.5 * mean(keys.map((k) => k.delayMs));
    for (const k of keys) {
      const long = k.delayMs >= threshold;
      if (isMarked(chars[k.cursor]!)) {
        marked += 1;
        markedLong += long ? 1 : 0;
      } else {
        other += 1;
        otherLong += long ? 1 : 0;
      }
    }
  }
  return { marked: markedLong / marked, other: otherLong / other, count: marked / SEEDS.length };
}

const CASES = BOT_LEVELS.flatMap((level) =>
  TEXTS.map(([lang, text]) => [level, lang, text] as const),
);

describe("hesitation (C5)", () => {
  it("the model's hesitation positions are C5's punctuation and accented characters", () => {
    for (const ch of new Set(charsOf(FIXTURE_FR + FIXTURE_EN + "«»€0123456789")))
      expect(hesitatesBefore(ch), JSON.stringify(ch)).toBe(isMarked(ch));
  });

  it.each(CASES)(
    "%s (%s): long pauses before punctuation and accents, rarely elsewhere",
    (level, lang, text) => {
      const profile = { ...botProfile(level), errorRate: 0 };
      const shares = longShares(profile, text, lang);
      expect(shares.count).toBeGreaterThan(30);
      expect(shares.marked).toBeGreaterThanOrEqual(0.3);
      expect(shares.other).toBeLessThanOrEqual(0.1);
    },
  );

  it.each(CASES)(
    "%s (%s): with hesitation 0, no more long pauses before them either",
    (level, lang, text) => {
      const profile = { ...botProfile(level), errorRate: 0, hesitation: 0 };
      const shares = longShares(profile, text, lang);
      expect(shares.marked).toBeLessThanOrEqual(0.1);
      expect(shares.other).toBeLessThanOrEqual(0.1);
    },
  );
});
