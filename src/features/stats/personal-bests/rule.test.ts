import { describe, expect, it } from "vitest";
import { bestKeyOf, isPersonalBest, LENGTH_BUCKETS, lengthOf } from "./rule";

// #999 C41: one pure personal-best rule. Clean WPM only (ADR 0016), counted results only, never flagged.

const counted = { isBot: false, suspicious: false, status: "FINISHED", cleanWpm: 50 };

describe("isPersonalBest", () => {
  it("a first counted result is a best; a strictly faster one beats it; a tie or a slower one does not", () => {
    expect(isPersonalBest(counted, null)).toBe(true);
    expect(isPersonalBest(counted, { cleanWpm: 49.9 })).toBe(true);
    expect(isPersonalBest(counted, { cleanWpm: 50 })).toBe(false);
    expect(isPersonalBest(counted, { cleanWpm: 60 })).toBe(false);
  });

  it("a timed-out desk counts (as countedWhere); other statuses do not", () => {
    expect(isPersonalBest({ ...counted, status: "TIMED_OUT" }, null)).toBe(true);
    for (const status of ["REASSIGNED", "ASLEEP", "EXPIRED", "LINE_CUT"]) {
      expect(isPersonalBest({ ...counted, status }, null), status).toBe(false);
    }
  });

  it("never from a flagged result or a bot, whatever its speed", () => {
    expect(isPersonalBest({ ...counted, suspicious: true, cleanWpm: 300 }, null)).toBe(false);
    expect(isPersonalBest({ ...counted, isBot: true, cleanWpm: 300 }, { cleanWpm: 1 })).toBe(false);
  });

  it("reads clean WPM only: zero, negative or non-finite speeds set nothing", () => {
    for (const cleanWpm of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isPersonalBest({ ...counted, cleanWpm }, null), String(cleanWpm)).toBe(false);
    }
    // the candidate type has no other speed: wpm / rawWpm / adjustedWpm cannot be passed in its place
    const withOthers = { ...counted, cleanWpm: 30, wpm: 90, adjustedWpm: 90 };
    expect(isPersonalBest(withOthers, { cleanWpm: 40 })).toBe(false);
  });
});

describe("bestKeyOf / lengthOf", () => {
  it("keys a best by language, text type and length bucket", () => {
    expect(bestKeyOf({ textLanguage: "FR", textWordCount: 20, textType: "sentences" })).toEqual({
      language: "FR",
      textType: "SENTENCES",
      length: "SHORT",
    });
    expect(
      bestKeyOf({ textLanguage: "EN", textWordCount: 80, textType: "special-characters" }),
    ).toEqual({ language: "EN", textType: "SPECIAL_CHARACTERS", length: "LONG" });
    expect(bestKeyOf({ textLanguage: "EN", textWordCount: 40, textType: "words" }).textType).toBe(
      "WORDS",
    );
  });

  it("buckets by word count: <= 25 short, <= 60 medium, above long", () => {
    expect([10, 25, 26, 60, 61, 500].map(lengthOf)).toEqual([
      "SHORT",
      "SHORT",
      "MEDIUM",
      "MEDIUM",
      "LONG",
      "LONG",
    ]);
    expect(LENGTH_BUCKETS.map((b) => b.length)).toEqual(["SHORT", "MEDIUM", "LONG"]);
  });
});
