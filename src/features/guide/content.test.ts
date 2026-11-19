import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE_CHARS, guideAnchor, guideHref } from "./chars";
import {
  GUIDE_CONTENT,
  GUIDE_LAYOUTS as keyboardLayoutIds,
  GUIDE_MODIFIERS,
  GUIDE_OSES,
  pairVerified,
  parseKeys,
  shownCombination,
  withChecks,
} from "./content";

// #999 C27: a combination is shown only when a real-machine check in work/log/999.md verifies it; every
// other layout/OS pair renders the empty state, never a guess. C26: one entry per character, anchors.

const LOG = readFileSync(path.join(process.cwd(), "work/log/999.md"), "utf8");

/** The "Guide checks" table of the log: `| G1 | CSA | windows | 2026-11-20 | <machine> | é è |`. */
function logChecks(): Map<string, { layout: string; os: string; date: string; chars: string[] }> {
  const start = LOG.indexOf("## Guide checks");
  expect(start, "work/log/999.md has a `## Guide checks` section").toBeGreaterThanOrEqual(0);
  const section = LOG.slice(start).split(/\n## /)[0]!;
  const rows = new Map<string, { layout: string; os: string; date: string; chars: string[] }>();
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    // a row: | id | layout | os | date | machine | characters |
    if (cells.length < 8 || !/^G\d+$/.test(cells[1]!)) continue;
    rows.set(cells[1]!, {
      layout: cells[2]!,
      os: cells[3]!,
      date: cells[4]!,
      chars: cells[6]!.split(/\s+/).filter(Boolean),
    });
  }
  return rows;
}

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
        for (const [os, combination] of Object.entries(byOs ?? {})) {
          expect(GUIDE_OSES as readonly string[]).toContain(os);
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

describe("guide verification (#999 C27)", () => {
  it("every shown combination cites a Guide checks row of work/log/999.md for its own pair and char", () => {
    const checks = logChecks();
    for (const entry of GUIDE_CONTENT) {
      for (const layout of keyboardLayoutIds) {
        for (const os of GUIDE_OSES) {
          const shown = shownCombination(entry, layout, os);
          if (!shown) continue;
          const row = checks.get(shown.check!);
          expect(
            row,
            `${entry.char} ${layout} ${os}: check ${shown.check} in the log`,
          ).toBeDefined();
          expect(row!.layout).toBe(layout);
          expect(row!.os).toBe(os);
          expect(row!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(row!.chars).toContain(entry.char);
        }
      }
    }
  });

  it("a candidate (no check) is never shown: its pair reads the empty state", () => {
    for (const entry of GUIDE_CONTENT) {
      for (const layout of keyboardLayoutIds) {
        for (const os of GUIDE_OSES) {
          const filed = entry.pairs[layout]?.[os];
          if (filed && filed.check === null) {
            expect(shownCombination(entry, layout, os)).toBeNull();
          }
        }
      }
    }
  });

  it("a check id turns exactly its own pair on, with the keys the machine typed", () => {
    const entry = GUIDE_CONTENT.find((e) => e.char === "ç")!;
    const pairs = withChecks(entry.pairs, "ç", {
      ç: {
        CSA: { windows: { check: "G1" } },
        US_QWERTY: { mac: { check: "G2", keys: "option+c" } },
      },
    });
    const checked = { ...entry, pairs };
    expect(shownCombination(checked, "CSA", "windows")).toEqual({ strokes: [["ç"]], check: "G1" });
    expect(shownCombination(checked, "US_QWERTY", "mac")).toEqual({
      strokes: [["option", "c"]],
      check: "G2",
    });
    expect(shownCombination(checked, "CSA", "mac")).toBeNull();
    expect(pairVerified([checked], "CSA", "windows")).toBe(true);
    expect(pairVerified([checked], "AZERTY", "windows")).toBe(false);
  });

  it("the log lists every unverified pair for the owner to check", () => {
    for (const layout of keyboardLayoutIds) {
      for (const os of GUIDE_OSES) {
        if (pairVerified(GUIDE_CONTENT, layout, os)) continue;
        expect(LOG, `${layout} / ${os} listed as unverified`).toMatch(
          new RegExp(`\\| ${layout} \\| ${os} \\| unverified`),
        );
      }
    }
  });
});
