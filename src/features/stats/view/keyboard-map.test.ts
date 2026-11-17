import { describe, expect, it, vi } from "vitest";
import type { CharCount } from "./key-file";
import { keyFileFixtures } from "./key-file-fixtures";
import {
  BOARD_UNITS,
  circleSize,
  coreSize,
  KEYBOARD_ROWS,
  keyboardMapOf,
  ROW_PADS,
  rowPercent,
} from "./keyboard-map";

// Contract of #324 C2 (and the sizes of C4): `keyboardMapOf(byChar, layout)` maps the key file's
// per-character counts onto a layout's four rows. The layouts are identity's (the single layout module),
// read through its barrel, which is server-only at runtime: these mocks stand in for the env and db.
vi.mock("@/env", () => ({ env: { NODE_ENV: "test", AUTH_SECRET: "a".repeat(32) } }));
vi.mock("@/server/db", () => ({ db: {} }));
const { keyboardLayoutIds, layouts, numberRows } = await import("@/features/identity");

const keysOf = (id: (typeof keyboardLayoutIds)[number]) => ({
  number: numberRows[id],
  letters: layouts[id],
});

/** e most struck (147, 3 errors), a few others; `ù` is on CSA and AZERTY only; the space is no key. */
const BY_CHAR: Record<string, CharCount> = {
  e: { hits: 147, errors: 3 },
  a: { hits: 76, errors: 0 },
  s: { hits: 79, errors: 2 },
  "1": { hits: 10, errors: 1 },
  ";": { hits: 20, errors: 0 },
  ù: { hits: 30, errors: 6 },
  "&": { hits: 4, errors: 0 },
  " ": { hits: 500, errors: 10 },
  é: { hits: 0, errors: 0 },
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("keyboardMapOf (#324 C2)", () => {
  for (const id of keyboardLayoutIds) {
    it(`${id}: four rows in order, the layout's caps upper case, shares that add up to 100 %`, () => {
      const map = keyboardMapOf(BY_CHAR, keysOf(id));
      expect(map.rows.map((r) => r.id)).toEqual([...KEYBOARD_ROWS]);
      expect(map.rows.map((r) => r.pad)).toEqual(KEYBOARD_ROWS.map((r) => ROW_PADS[r]));
      expect(map.rows[0]!.keys.map((k) => k.char)).toEqual([...numberRows[id]]);
      for (const [i, row] of layouts[id].entries()) {
        expect(map.rows[i + 1]!.keys.map((k) => k.char)).toEqual([...row]);
        expect(map.rows[i + 1]!.keys.map((k) => k.cap)).toEqual(row.map((c) => c.toUpperCase()));
      }
      expect(sum(map.rows.map((r) => r.share))).toBeCloseTo(1, 10);
      expect(sum(map.rows.flatMap((r) => r.keys.map((k) => k.ofStrokes)))).toBeCloseTo(1, 10);

      // only the layout's keys count: the strokes total is theirs, the space and absent keys nowhere
      const onLayout = new Set([...numberRows[id], ...layouts[id].flat()]);
      const total = sum(
        Object.entries(BY_CHAR).flatMap(([c, n]) => (onLayout.has(c) ? n.hits : 0)),
      );
      const e = map.rows.flatMap((r) => r.keys).find((k) => k.char === "e")!;
      expect(e).toMatchObject({ cap: "E", typed: true, share: 1, errorRate: 3 / 147 });
      expect(e.ofStrokes).toBeCloseTo(147 / total, 10);

      // a key with no stroke is untyped: no share, no error rate
      const k = map.rows.flatMap((r) => r.keys).find((x) => x.char === "k")!;
      expect(k).toMatchObject({ typed: false, share: 0, ofStrokes: 0, errorRate: null });
    });
  }

  it("a key absent from a layout does not count in its rows: ù on CSA, not on US QWERTY", () => {
    const csa = keyboardMapOf(BY_CHAR, keysOf("CSA"));
    const us = keyboardMapOf(BY_CHAR, keysOf("US_QWERTY"));
    const csaTotal = 147 + 76 + 79 + 10 + 20 + 30;
    const usTotal = 147 + 76 + 79 + 10 + 20;
    expect(csa.rows[3]!.share).toBeCloseTo(30 / csaTotal, 10);
    expect(us.rows[3]!.share).toBe(0);
    expect(us.rows[2]!.share).toBeCloseTo((76 + 79 + 20) / usTotal, 10);
    expect(us.rows[0]!.share).toBeCloseTo(10 / usTotal, 10);
    // AZERTY: `&` is on its number row; `1` is not (shifted)
    const azerty = keyboardMapOf(BY_CHAR, keysOf("AZERTY"));
    const amp = azerty.rows[0]!.keys.find((x) => x.char === "&")!;
    expect(amp.typed).toBe(true);
    expect(azerty.rows[0]!.keys[0]!.cap).toBe("²");
    expect(azerty.rows[1]!.keys[0]!.cap).toBe("A");
  });

  it("the row shares print as whole percents, the reference's rounding", () => {
    const map = keyboardMapOf(BY_CHAR, keysOf("CSA"));
    const total = 147 + 76 + 79 + 10 + 20 + 30;
    expect(map.rows.map((r) => rowPercent(r.share))).toEqual([
      Math.round((10 / total) * 100),
      Math.round((147 / total) * 100),
      Math.round(((76 + 79 + 20) / total) * 100),
      Math.round((30 / total) * 100),
    ]);
  });

  it("no stroke on the layout: every key untyped, every share 0", () => {
    const map = keyboardMapOf({ " ": { hits: 9, errors: 0 } }, keysOf("FR_CA"));
    for (const row of map.rows) {
      expect(row.share).toBe(0);
      for (const key of row.keys) expect(key.typed).toBe(false);
    }
  });

  it("the key unit: one fourteenth of the board, or the widest row's when it is wider", () => {
    expect(keyboardMapOf(BY_CHAR, keysOf("CSA")).unit).toBeCloseTo(100 / BOARD_UNITS, 10);
    expect(keyboardMapOf(BY_CHAR, keysOf("AZERTY")).unit).toBeCloseTo(100 / BOARD_UNITS, 10);
    // US QWERTY and Canadian French end their top row with a thirteenth key: 1.5 + 13 units
    expect(keyboardMapOf(BY_CHAR, keysOf("US_QWERTY")).unit).toBeCloseTo(100 / 14.5, 10);
    expect(keyboardMapOf(BY_CHAR, keysOf("FR_CA")).unit).toBeCloseTo(100 / 14.5, 10);
  });

  it("reads the key file fixture's byChar", () => {
    const map = keyboardMapOf(keyFileFixtures.twoWeeks.byChar, keysOf("CSA"));
    const e = map.rows[1]!.keys.find((k) => k.char === "e")!;
    expect(e.share).toBe(1);
    expect(map.rows[0]!.keys.every((k) => !k.typed)).toBe(true);
  });
});

describe("circle and core sizes (#324 C4)", () => {
  it("circle: sqrt(share) x 140 %, whole", () => {
    expect(circleSize(1)).toBe(140);
    expect(circleSize(0.25)).toBe(70);
    expect(circleSize(76 / 147)).toBe(Math.round(Math.sqrt(76 / 147) * 140));
    expect(circleSize(0)).toBe(0);
  });

  it("core: min(100, sqrt(errorRate / 0.12) x 100) %, whole; none without a rate", () => {
    expect(coreSize(0.03)).toBe(50);
    expect(coreSize(0.12)).toBe(100);
    expect(coreSize(0.5)).toBe(100);
    expect(coreSize(0)).toBe(0);
    expect(coreSize(null)).toBe(0);
  });
});
