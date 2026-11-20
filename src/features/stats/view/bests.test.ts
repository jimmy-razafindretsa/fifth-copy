import { describe, expect, it } from "vitest";
import { type BestInput, bestDate, bestsView } from "./bests";
import type { LanguageStats } from "./profile";

// #999 C43: the personal bests view: its three states, the French versus English verdict, the order.
const none: LanguageStats = { races: 0, bestWpm: null, meanWpm: null };
const stats = (races: number, bestWpm: number, meanWpm: number): LanguageStats => ({
  races,
  bestWpm,
  meanWpm,
});
const best = (b: Partial<BestInput>): BestInput => ({
  language: "EN",
  textType: "SENTENCES",
  length: "SHORT",
  cleanWpm: 40,
  accuracy: 0.95,
  achievedAt: new Date("2026-11-12T15:00:00Z"),
  ...b,
});

describe("bestsView (#999 C43)", () => {
  it("none: no race and no best", () => {
    const v = bestsView([], { FR: none, EN: none });
    expect(v.state).toBe("none");
    expect(v.verdict).toBeNull();
    expect(v.rows).toEqual([]);
    expect(v.compare.map((c) => c.language)).toEqual(["FR", "EN"]);
  });

  it("one language: the verdict names the only language on file", () => {
    const v = bestsView([best({})], { FR: none, EN: stats(2, 40, 35) });
    expect(v.state).toBe("one-language");
    expect(v.verdict).toEqual({ kind: "only", language: "EN" });
  });

  it("populated: French slower, faster or even against English on the average", () => {
    const rows = [best({}), best({ language: "FR", cleanWpm: 30 })];
    expect(bestsView(rows, { FR: stats(2, 30, 28), EN: stats(3, 40, 34.5) }).verdict).toEqual({
      kind: "slower",
      diff: 6.5,
    });
    expect(bestsView(rows, { FR: stats(2, 50, 40), EN: stats(3, 40, 34) }).verdict).toEqual({
      kind: "faster",
      diff: 6,
    });
    const even = bestsView(rows, { FR: stats(2, 50, 34.02), EN: stats(3, 40, 34) });
    expect(even.state).toBe("populated");
    expect(even.verdict).toEqual({ kind: "even" });
  });

  it("rows read language, then text type, then length, in the settings' order", () => {
    const v = bestsView(
      [
        best({ language: "EN", textType: "WORDS", length: "LONG" }),
        best({ language: "EN", textType: "SENTENCES", length: "MEDIUM" }),
        best({ language: "FR", textType: "SPECIAL_CHARACTERS", length: "SHORT" }),
        best({ language: "EN", textType: "SENTENCES", length: "SHORT" }),
      ],
      { FR: stats(1, 40, 40), EN: stats(3, 40, 40) },
    );
    expect(v.rows.map((r) => `${r.language} ${r.textType} ${r.length}`)).toEqual([
      "FR SPECIAL_CHARACTERS SHORT",
      "EN SENTENCES SHORT",
      "EN SENTENCES MEDIUM",
      "EN WORDS LONG",
    ]);
  });

  it("the day a best was set reads in the stats time zone, upper case", () => {
    // 02:00 UTC on Nov 13 is still Nov 12 in Toronto
    const at = new Date("2026-11-13T02:00:00Z");
    expect(bestDate(at, "en")).toBe("NOV 12, 2026");
    expect(bestDate(at, "fr")).toMatch(/^12 NOV\.? 2026$/);
  });
});
