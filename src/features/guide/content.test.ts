import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE_CHARS, guideAnchor, guideHref } from "./chars";
import {
  GUIDE_CONTENT,
  GUIDE_LAYOUTS as keyboardLayoutIds,
  GUIDE_MODIFIERS,
  GUIDE_OSES,
  GUIDE_SOURCES,
  pairDocumented,
  parseKeys,
  shownCombination,
  sourcesFor,
} from "./content";

// #1001 C7: every layout/OS pair is filed for every character from the vendor's layout documentation,
// with its source URL and `verifiedBy: "docs"`; a pair the vendor does not document is stated as such.
// #999 C26: one entry per character, anchors.

const LOG = readFileSync(path.join(process.cwd(), "work/log/1001.md"), "utf8");
const guideSources = LOG.split(/^## Guide sources/m)[1]?.split(/^## /m)[0] ?? "";

const REQUIRED = [
  "é",
  "è",
  "ê",
  "ë",
  "à",
  "â",
  "ç",
  "ù",
  "û",
  "ô",
  "î",
  "ï",
  "œ",
  "æ",
  "«",
  "»",
  "€",
];

describe("guide content (#999 C26)", () => {
  it("files one entry per required character, in order, each with a unique kebab anchor", () => {
    expect(GUIDE_CONTENT.map((e) => e.char)).toEqual(REQUIRED);
    const anchors = GUIDE_CONTENT.map((e) => e.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const anchor of anchors) expect(anchor).toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect(guideAnchor("ç")).toBe("c-cedilla");
  });

  it("the deep link of a filed character, either case, is /guide#<anchor>; a plain key has none", () => {
    expect(guideHref("ç")).toBe("/guide#c-cedilla");
    expect(guideHref("É")).toBe("/guide#e-acute");
    expect(guideHref("«")).toBe("/guide#guillemet-open");
    expect(guideHref("e")).toBeNull();
    expect(guideHref("^")).toBeNull();
    expect(GUIDE_CHARS).toHaveLength(REQUIRED.length);
  });

  it("parses `+` as keys held together and `, ` as strokes in order", () => {
    expect(parseKeys("option+e, e")).toEqual([["option", "e"], ["e"]]);
    expect(parseKeys("ç")).toEqual([["ç"]]);
  });

  it("every filed stroke is non-empty and names a modifier or a single printed key or code", () => {
    for (const entry of GUIDE_CONTENT) {
      for (const [layout, byOs] of Object.entries(entry.pairs)) {
        expect(keyboardLayoutIds as readonly string[]).toContain(layout);
        for (const [os, combination] of Object.entries(byOs)) {
          expect(GUIDE_OSES as readonly string[]).toContain(os);
          if (combination.undocumented) continue;
          expect(combination.strokes.length, `${entry.char} ${layout} ${os}`).toBeGreaterThan(0);
          for (const stroke of combination.strokes) {
            expect(stroke.length).toBeGreaterThan(0);
            for (const key of stroke) {
              const ok =
                (GUIDE_MODIFIERS as readonly string[]).includes(key) ||
                /^numpad\d{4}$/.test(key) ||
                /^[0-9a-f]{2,4}$/.test(key) ||
                [...key].length === 1;
              expect(ok, `${entry.char} ${layout} ${os}: "${key}"`).toBe(true);
            }
          }
        }
      }
    }
  });
});

describe("guide from vendor documentation (#1001 C7)", () => {
  it("every character is filed for every layout and OS, each pair with its source URL and verifiedBy docs", () => {
    const sources = Object.values(GUIDE_SOURCES) as string[];
    for (const entry of GUIDE_CONTENT) {
      for (const layout of keyboardLayoutIds) {
        for (const os of GUIDE_OSES) {
          const pair = entry.pairs[layout][os];
          const where = `${entry.char} ${layout} ${os}`;
          expect(pair, where).toBeDefined();
          expect(pair.verifiedBy, where).toBe("docs");
          expect(sources, where).toContain(pair.source);
          expect(pair.source, where).toMatch(/^https:\/\//);
          if (pair.undocumented) expect(pair.strokes, where).toEqual([]);
          else expect(pair.strokes.length, where).toBeGreaterThan(0);
        }
      }
    }
  });

  it("a documented pair is shown; an undocumented one never is", () => {
    for (const entry of GUIDE_CONTENT) {
      for (const layout of keyboardLayoutIds) {
        for (const os of GUIDE_OSES) {
          const pair = entry.pairs[layout][os];
          expect(shownCombination(entry, layout, os)).toBe(pair.undocumented ? null : pair);
        }
      }
    }
  });

  it("the vendors' own combinations: Windows layouts, Apple's Option keys, Google's Unicode entry", () => {
    const keys = (
      char: string,
      layout: (typeof keyboardLayoutIds)[number],
      os: (typeof GUIDE_OSES)[number],
    ) => GUIDE_CONTENT.find((e) => e.char === char)!.pairs[layout][os].strokes;
    expect(keys("é", "CSA", "windows")).toEqual([["é"]]);
    expect(keys("ê", "AZERTY", "windows")).toEqual([["^"], ["e"]]);
    expect(keys("ç", "FR_CA", "windows")).toEqual([["¸"], ["c"]]);
    expect(keys("€", "AZERTY", "windows")).toEqual([["altgr", "e"]]);
    expect(keys("é", "US_QWERTY", "windows")).toEqual([["alt", "numpad0233"]]);
    expect(keys("ê", "US_QWERTY", "mac")).toEqual([["option", "i"], ["e"]]);
    expect(keys("ç", "US_QWERTY", "mac")).toEqual([["option", "c"]]);
    expect(keys("œ", "AZERTY", "chromeos")).toEqual([["ctrl", "shift", "u"], ["153"], ["space"]]);
  });

  it("macOS outside the U.S. input source is undocumented (Apple publishes no chart), stated not invented", () => {
    for (const layout of ["CSA", "FR_CA", "AZERTY"] as const) {
      expect(pairDocumented(GUIDE_CONTENT, layout, "mac"), layout).toBe(false);
      expect(pairDocumented(GUIDE_CONTENT, layout, "windows"), layout).toBe(true);
      expect(pairDocumented(GUIDE_CONTENT, layout, "chromeos"), layout).toBe(true);
    }
    expect(pairDocumented(GUIDE_CONTENT, "US_QWERTY", "mac")).toBe(true);
  });

  it("the sources a layout cites, per system", () => {
    expect(sourcesFor(GUIDE_CONTENT, "US_QWERTY", ["mac"])).toEqual([
      GUIDE_SOURCES.macAccents,
      GUIDE_SOURCES.macViewer,
    ]);
    expect(sourcesFor(GUIDE_CONTENT, "CSA", ["mac"])).toEqual([]);
  });

  it('work/log/1001.md "Guide sources" lists every source and every layout/OS pair', () => {
    for (const url of Object.values(GUIDE_SOURCES)) expect(guideSources, url).toContain(url);
    for (const layout of keyboardLayoutIds) {
      for (const os of GUIDE_OSES) {
        expect(guideSources, `${layout} / ${os}`).toMatch(
          new RegExp(`\\| ${layout} \\| ${os} \\|`),
        );
      }
    }
  });
});
