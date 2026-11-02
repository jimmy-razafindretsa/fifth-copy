import { describe, expect, it } from "vitest";
import { analyseTrace } from "../anticheat/analyse";
import { charsOf } from "../text/chars";
import { wordsOf } from "../text/overlay";
import { wordCount } from "../text/word-count";
import { botProfile } from "./profile";
import { cv, drive, mean, MODES, SEEDS, type Run } from "./testing/drive";
import { FIXTURE_EN, FIXTURE_FR } from "./testing/fixture";
import { BOT_LEVELS, type BotLanguage, type BotLevel } from "./types";

// #361 C2 (rhythm) and C3 (burst and pause), errors off for the measure.
const SETTINGS = MODES[0]!;
const TEXTS = [
  ["fr", FIXTURE_FR],
  ["en", FIXTURE_EN],
] as const satisfies readonly (readonly [BotLanguage, string])[];

const runs = new Map<string, Run[]>();
function runsOf(level: BotLevel, language: BotLanguage, text: string): Run[] {
  const key = `${level}:${language}`;
  let r = runs.get(key);
  if (!r) {
    const profile = { ...botProfile(level), errorRate: 0 };
    r = SEEDS.map((seed) => drive(profile, text, SETTINGS, seed, language));
    runs.set(key, r);
  }
  return r;
}

const CASES = BOT_LEVELS.flatMap((level) => TEXTS.map(([lang, text]) => [level, lang, text] as const));

/** C3's slow words, stated independently of the model: nine letters or more, or a rare letter. */
const RARE = { fr: /[kwxyz]/, en: /[jqxz]/ } as const;
const isSlow = (word: string, lang: BotLanguage) => [...word].length >= 9 || RARE[lang].test(word);

const letters = (word: string) => word.toLowerCase().replace(/[^\p{L}]/gu, "");

/** Index of the word each character belongs to (-1 for the spaces). */
function wordIndexOf(text: string): number[] {
  const out: number[] = [];
  let w = 0;
  for (const ch of charsOf(text)) {
    if (ch === " ") {
      out.push(-1);
      w += 1;
    } else out.push(w);
  }
  return out;
}

describe("fixtures", () => {
  it.each(TEXTS)("%s fixture has 200 words", (_lang, text) => {
    expect(wordCount(text)).toBe(200);
  });
});

describe("rhythm (C2)", () => {
  it.each(CASES)("%s (%s): CV >= 0.25, no run of five equal delays, WPM within 15 %", (level, lang, text) => {
    const target = botProfile(level).targetWpm;
    for (const [s, run] of runsOf(level, lang, text).entries()) {
      expect(run.state.status, `seed ${SEEDS[s]}`).toBe("finished");
      const delays = run.keys.slice(1).map((k) => k.delayMs);
      expect(cv(delays), `seed ${SEEDS[s]}`).toBeGreaterThanOrEqual(0.25);
      for (let i = 4; i < delays.length; i++) {
        const window = delays.slice(i - 4, i + 1);
        expect(new Set(window).size, `seed ${SEEDS[s]} at ${i}`).toBeGreaterThan(1);
      }
      const minutes = run.state.finishedAt! / 60_000;
      const wpm = text.length / 5 / minutes;
      expect(Math.abs(wpm - target) / target, `seed ${SEEDS[s]} wpm ${wpm}`).toBeLessThanOrEqual(0.15);
    }
  });

  it.each(CASES)("%s (%s): every trace passes the anti-cheat analysis", (level, lang, text) => {
    for (const run of runsOf(level, lang, text)) {
      const { cursor, correct, errors } = run.state;
      const flags = analyseTrace({
        keystrokes: run.trace,
        text,
        settings: SETTINGS,
        recorded: { cursor, correct, errors },
        timingAnomalies: 0,
      });
      expect(flags).toEqual([]);
    }
  });
});

describe("burst and pause (C3)", () => {
  it.each(CASES)("%s (%s): common words are typed faster than long or rare-letter words", (level, lang, text) => {
    const words = wordsOf(text).map(letters);
    const freq = new Map<string, number>();
    for (const w of words) if (w) freq.set(w, (freq.get(w) ?? 0) + 1);
    // The fixture's 100 most frequent words (ties: shorter, then alphabetical).
    const common = new Set(
      [...freq.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))
        .slice(0, 100)
        .map(([w]) => w),
    );
    const slow = new Set(words.filter((w) => w && isSlow(w, lang)));
    for (const w of slow) common.delete(w); // disjoint sets: a slow word is never counted as common
    const wordAt = wordIndexOf(text);
    const fast: number[] = [];
    const slower: number[] = [];
    for (const run of runsOf(level, lang, text)) {
      for (const k of run.keys) {
        const w = wordAt[k.cursor]!;
        if (w < 0) continue;
        const word = words[w]!;
        if (common.has(word)) fast.push(k.delayMs);
        else if (slow.has(word)) slower.push(k.delayMs);
      }
    }
    expect(slow.size).toBeGreaterThan(10);
    expect(mean(fast)).toBeLessThan(mean(slower));
  });
});
