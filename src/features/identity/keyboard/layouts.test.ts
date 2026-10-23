import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { keyboardLayoutIds, layouts, type KeyboardLayoutId } from "./layouts";

// Contract of #224 C1 (and #66 C5, which verifies against this module): the four keyboard layouts a
// student picks from (R179) as data, three rows of keys each, in the `rows` shape of the typing machine
// (bible 7.7a: "a layout is data"). The French layouts carry é, è and ç; US QWERTY none of them.
const ACCENTS = ["é", "è", "ç"];

describe("keyboard layouts (#224 C1)", () => {
  it("lists the four ids, one layout each, nothing else", () => {
    expect(keyboardLayoutIds).toEqual(["CSA", "FR_CA", "US_QWERTY", "AZERTY"]);
    expect(Object.keys(layouts).sort()).toEqual([...keyboardLayoutIds].sort());
    const id: KeyboardLayoutId = "FR_CA";
    expect(layouts[id]).toBeDefined();
  });

  for (const id of keyboardLayoutIds) {
    it(`${id}: exactly three rows of single lower-case characters, unique within the layout`, () => {
      const rows = layouts[id];
      expect(rows).toHaveLength(3);
      const keys = rows.flat();
      for (const key of keys) {
        expect(Array.from(key), JSON.stringify(key)).toHaveLength(1);
        expect(key.toLowerCase(), key).toBe(key);
        expect(key.trim(), "no space key: the space bar is the skin's").toBe(key);
      }
      expect(new Set(keys).size, "unique keys").toBe(keys.length);
      for (const row of rows) expect(row.length, "a row of keys").toBeGreaterThan(0);
    });
  }

  it("CSA and FR_CA contain é, è and ç; US QWERTY none of them", () => {
    for (const id of ["CSA", "FR_CA"] as const) {
      for (const ch of ACCENTS) expect(layouts[id].flat(), `${id} ${ch}`).toContain(ch);
    }
    for (const ch of ACCENTS) expect(layouts.US_QWERTY.flat(), ch).not.toContain(ch);
  });

  it("the four first rows are pairwise distinct: AZERTY begins a z e r t y, the others q w e r t y", () => {
    const first = keyboardLayoutIds.map((id) => layouts[id][0]!.join(" "));
    expect(new Set(first).size).toBe(keyboardLayoutIds.length);
    for (const id of keyboardLayoutIds) {
      const start = layouts[id][0]!.slice(0, 6).join(" ");
      expect(start, id).toBe(id === "AZERTY" ? "a z e r t y" : "q w e r t y");
    }
  });

  it("is pure data: no import, nothing but the ids, the type and the table", () => {
    const source = readFileSync(path.join(__dirname, "layouts.ts"), "utf8");
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\bimport\s*\(/);
    const exported = [...source.matchAll(/^export\s+(?:const|type)\s+(\w+)/gm)].map((m) => m[1]);
    expect(exported.sort()).toEqual(["KeyboardLayoutId", "keyboardLayoutIds", "layouts"]);
  });
});

describe("the identity index exports the layouts (#224 C1)", () => {
  it("re-exports keyboardLayoutIds, layouts and KeyboardLayoutId from ./keyboard/layouts", () => {
    const index = readFileSync(path.join(__dirname, "../index.ts"), "utf8");
    expect(index).toMatch(
      /export\s*\{[^}]*\bkeyboardLayoutIds\b[^}]*\blayouts\b[^}]*\btype KeyboardLayoutId\b[^}]*\}\s*from\s*"\.\/keyboard\/layouts"/,
    );
  });
});
