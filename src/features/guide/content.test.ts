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

// #1001 C7: every layout/OS pair is filed for every character from published layout data (Microsoft's
// diagrams, Unicode CLDR's files of Apple's and Google's layouts, Microsoft's Alt codes, Google's accents
// menu), with the exact source URL and `verifiedBy: "docs"`; a pair no source documents is stated as such.
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
                /^numpad\d{3,4}$/.test(key) ||
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

  const keys = (
    char: string,
    layout: (typeof keyboardLayoutIds)[number],
    os: (typeof GUIDE_OSES)[number],
  ) => GUIDE_CONTENT.find((e) => e.char === char)!.pairs[layout][os].strokes;

  it("Windows, from Microsoft's layout diagrams (kbdcan, kbdca, kbdfr) and Alt codes as its page lists them", () => {
    expect(keys("é", "CSA", "windows")).toEqual([["é"]]);
    expect(keys("ê", "CSA", "windows")).toEqual([["^"], ["e"]]);
    expect(keys("€", "CSA", "windows")).toEqual([["altgr", "e"]]);
    expect(keys("œ", "CSA", "windows")).toEqual([["rctrl", "e"]]);
    expect(keys("æ", "CSA", "windows")).toEqual([["rctrl", "a"]]);
    const grave = GUIDE_CONTENT.find((e) => e.char === "è")!.pairs.CSA.windows;
    expect(!grave.undocumented && grave.alternatives).toEqual([[["altgr", "^"], ["e"]]]);
    expect(keys("«", "FR_CA", "windows")).toEqual([["«"]]);
    expect(keys("»", "FR_CA", "windows")).toEqual([["shift", "«"]]);
    expect(keys("€", "FR_CA", "windows")).toEqual([["altgr", "e"]]);
    expect(keys("ç", "FR_CA", "windows")).toEqual([["¸"], ["c"]]);
    expect(keys("ê", "AZERTY", "windows")).toEqual([["^"], ["e"]]);
    expect(keys("€", "AZERTY", "windows")).toEqual([["altgr", "e"]]);
    expect(keys("œ", "AZERTY", "windows")).toEqual([["alt", "numpad0156"]]);
    expect(keys("é", "US_QWERTY", "windows")).toEqual([["alt", "numpad130"]]);
    expect(keys("€", "US_QWERTY", "windows")).toEqual([["alt", "numpad0128"]]);
  });

  it("macOS, from the CLDR files of Apple's U.S., Canadian - CSA and French layouts", () => {
    expect(keys("ê", "US_QWERTY", "mac")).toEqual([["option", "i"], ["e"]]);
    expect(keys("è", "US_QWERTY", "mac")).toEqual([["option", "`"], ["e"]]);
    expect(keys("ç", "US_QWERTY", "mac")).toEqual([["option", "c"]]);
    expect(keys("è", "CSA", "mac")).toEqual([["è"]]);
    expect(keys("«", "CSA", "mac")).toEqual([["option", "z"]]);
    expect(keys("€", "CSA", "mac")).toEqual([["option", "4"]]);
    expect(keys("œ", "AZERTY", "mac")).toEqual([["option", "o"]]);
    expect(keys("€", "AZERTY", "mac")).toEqual([["option", "$"]]);
  });

  it("macOS Canadian French, from Apple's accent menu and Character Viewer pages (no layout file)", () => {
    expect(keys("é", "FR_CA", "mac")).toEqual([["hold", "e"], ["é"]]);
    expect(keys("ç", "FR_CA", "mac")).toEqual([["hold", "c"], ["ç"]]);
    expect(keys("œ", "FR_CA", "mac")).toEqual([["hold", "o"], ["œ"]]);
    expect(keys("æ", "FR_CA", "mac")).toEqual([["hold", "a"], ["æ"]]);
    for (const char of ["«", "»", "€"]) {
      expect(keys(char, "FR_CA", "mac"), char).toEqual([["fn", "e"], [char]]);
    }
    expect(sourcesFor(GUIDE_CONTENT, "FR_CA", ["mac"])).toEqual([
      GUIDE_SOURCES.macAccents,
      GUIDE_SOURCES.macCharacterViewer,
    ]);
  });

  it("ChromeOS, from the CLDR files of Google's Canada and France layouts, and the accents menu for US", () => {
    expect(keys("è", "FR_CA", "chromeos")).toEqual([["`"], ["e"]]);
    expect(keys("»", "FR_CA", "chromeos")).toEqual([["shift", "«"]]);
    expect(keys("€", "AZERTY", "chromeos")).toEqual([["altgr", "e"]]);
    expect(keys("ê", "US_QWERTY", "chromeos")).toEqual([["hold", "e"], ["ê"]]);
    // CSA: xkeyboard-config's ca(multix), the layout Chromium maps ChromeOS's Canadian Multilingual to
    expect(keys("é", "CSA", "chromeos")).toEqual([["é"]]);
    expect(keys("ù", "CSA", "chromeos")).toEqual([["ù"]]);
    expect(keys("ê", "CSA", "chromeos")).toEqual([["^"], ["e"]]);
    expect(keys("ë", "CSA", "chromeos")).toEqual([["shift", "^"], ["e"]]);
    expect(keys("€", "CSA", "chromeos")).toEqual([["altgr", "e"]]);
    expect(keys("«", "CSA", "chromeos")).toEqual([["altgr", "z"]]);
    expect(keys("»", "CSA", "chromeos")).toEqual([["altgr", "x"]]);
    expect(keys("œ", "CSA", "chromeos")).toEqual([["rctrl", "e"]]);
    expect(keys("æ", "CSA", "chromeos")).toEqual([["rctrl", "a"]]);
    const grave = GUIDE_CONTENT.find((e) => e.char === "à")!.pairs.CSA.chromeos;
    expect(!grave.undocumented && grave.alternatives).toEqual([[["altgr", "^"], ["a"]]]);
    for (const char of ["œ", "æ", "«", "»", "€"]) {
      expect(keys(char, "US_QWERTY", "chromeos"), char).toEqual([]);
    }
    // no Ctrl+Shift+U anywhere: Google's pages do not document it
    for (const entry of GUIDE_CONTENT) {
      for (const byOs of Object.values(entry.pairs)) {
        for (const pair of Object.values(byOs)) {
          for (const stroke of pair.strokes) expect(stroke.join("+")).not.toBe("ctrl+shift+u");
        }
      }
    }
  });

  it("every layout and OS is documented; a character with no published key is undocumented, not invented", () => {
    for (const layout of keyboardLayoutIds) {
      for (const os of GUIDE_OSES) {
        expect(pairDocumented(GUIDE_CONTENT, layout, os), `${layout} ${os}`).toBe(true);
      }
    }
    // Canadian French on macOS and CSA on ChromeOS: all 17 characters
    for (const entry of GUIDE_CONTENT) {
      expect(entry.pairs.FR_CA.mac.undocumented, entry.char).toBeFalsy();
      expect(entry.pairs.CSA.chromeos.undocumented, entry.char).toBeFalsy();
    }
    // a character a layout has no key for: Canadian French on ChromeOS has no œ æ €
    for (const char of ["œ", "æ", "€"]) expect(keys(char, "FR_CA", "chromeos"), char).toEqual([]);
  });

  it("every pair cites the exact per-layout source, never a generic index", () => {
    expect(sourcesFor(GUIDE_CONTENT, "US_QWERTY", ["mac"])).toEqual([GUIDE_SOURCES.macUs]);
    expect(sourcesFor(GUIDE_CONTENT, "CSA", ["windows"])).toEqual([GUIDE_SOURCES.windowsCsa]);
    expect(sourcesFor(GUIDE_CONTENT, "FR_CA", ["windows"])).toEqual([
      GUIDE_SOURCES.windowsFrCa,
      GUIDE_SOURCES.windowsAltCodes,
    ]);
    expect(sourcesFor(GUIDE_CONTENT, "CSA", ["chromeos"])).toEqual([GUIDE_SOURCES.chromeosCsa]);
    for (const url of Object.values(GUIDE_SOURCES)) {
      expect(url).not.toBe(
        "https://learn.microsoft.com/en-us/globalization/windows-keyboard-layouts",
      );
    }
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
