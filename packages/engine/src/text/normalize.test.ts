import { describe, expect, it } from "vitest";
import { mulberry32, pick, pickInt } from "../testing/rng";
import { isTypeable, normalizeKey, normalizeTypeable, TYPEABLE } from "./normalize";

describe("normalizeTypeable", () => {
  it.each([
    // curly quotes and apostrophes
    ["“Bonjour”", '"Bonjour"'],
    ["„Hallo‟", '"Hallo"'],
    ["l’ami", "l'ami"],
    ["‘single’", "'single'"],
    ["itʼs", "it's"],
    // dashes
    ["a–b", "a-b"],
    ["a — b", "a - b"],
    ["−" + "5", "-5"],
    // ellipsis
    ["Attendez…", "Attendez..."],
    // French guillemets kept (spec 13.2, 14; #571); their NBSP / narrow NBSP spacing -> " "
    ["« Bonjour »", "« Bonjour »"],
    ["«\u00A0Bonjour\u00A0»", "« Bonjour »"],
    ["«\u202FSalut\u202F»", "« Salut »"],
    // euro sign kept (#571)
    ["5 €", "5 €"],
    ["5\u00A0€", "5 €"],
    ["5€", "5€"],
    // curly double quotes still map to the ASCII quote
    ["“« x »”", '"« x »"'],
    ["Quoi\u00A0?", "Quoi ?"],
    ["10\u2009000", "10 000"],
    // composed vs precomposed
    ["e\u0301", "é"],
    ["caf" + "e\u0301", "café"],
    ["E\u0301té", "Été"],
    // ligatures and accents kept
    ["cœur", "cœur"],
    ["Æsop", "Æsop"],
    ["à â ç è ê ë î ï ô ù û ü ÿ", "à â ç è ê ë î ï ô ù û ü ÿ"],
    ["Ÿ", "Ÿ"],
    // control characters dropped
    ["ab\u0000c\u0007d\u007F", "abcd"],
    ["a\u200Bb", "ab"],
    ["\uFEFFstart", "start"],
    // whitespace collapsed and trimmed
    ["  deux   espaces  ", "deux espaces"],
    ["ligne\nsuivante\ttab", "ligne suivante tab"],
    ["a \u0001 b", "a b"],
    // not typeable: dropped
    ["Хаос chaos", "chaos"],
    ["", ""],
    // ASCII punctuation and symbols kept
    [
      "a+b=c; {x}[y](z) #1 @2 $3 %4 ^5 &6 *7 _8 |9 ~0 `<>/\\",
      "a+b=c; {x}[y](z) #1 @2 $3 %4 ^5 &6 *7 _8 |9 ~0 `<>/\\",
    ],
  ])("normalizeTypeable(%j) is %j", (raw, expected) => {
    expect(normalizeTypeable(raw)).toBe(expected);
  });

  it("composed U+0065 U+0301 equals precomposed U+00E9", () => {
    expect(normalizeTypeable("e\u0301")).toBe(normalizeTypeable("é"));
  });

  it("is idempotent over 1 000 random strings (whitelist plus mapped and junk characters)", () => {
    const rng = mulberry32(0x157);
    const extra = [..."“”‘’–—…«»\u00A0\u202F\u2009\n\t\u0000\u0301\u200B€"];
    const alphabet = [...TYPEABLE, ...extra, "  ", "e\u0301"];
    for (let i = 0; i < 1000; i++) {
      const len = pickInt(rng, 40);
      let s = "";
      for (let j = 0; j < len; j++) s += pick(rng, alphabet);
      const once = normalizeTypeable(s);
      expect(normalizeTypeable(once)).toBe(once);
      // BMP only: one code point is one UTF-16 unit, so text[i] indexes characters.
      expect([...once].length).toBe(once.length);
      for (const ch of once) expect(isTypeable(ch)).toBe(true);
    }
  });
});

describe("TYPEABLE / isTypeable", () => {
  it("is BMP-only and NFC-stable", () => {
    for (const ch of TYPEABLE) {
      expect(ch.length).toBe(1);
      expect(ch.normalize("NFC")).toBe(ch);
    }
  });

  it.each([
    ["a", true],
    ["Z", true],
    ["7", true],
    [" ", true],
    ["~", true],
    ["é", true],
    ["Œ", true],
    ["«", true],
    ["»", true],
    ["€", true],
    ["\u00A0", false],
    ["\u0000", false],
    ["ab", false],
    ["", false],
  ])("isTypeable(%j) is %s", (ch, ok) => {
    expect(isTypeable(ch)).toBe(ok);
  });
});

describe("normalizeKey", () => {
  it.each([
    [" ", " "],
    ["\u00A0", " "],
    ["’", "'"],
    ["e\u0301", "é"],
    ["…", "..."],
    ["\u0007", ""],
    ["€", "€"],
    ["«", "«"],
    ["»", "»"],
    ["“", '"'],
    ["Backspace", "Backspace"],
  ])("normalizeKey(%j) is %j (no trim, no collapse)", (key, expected) => {
    expect(normalizeKey(key)).toBe(expected);
  });
});
