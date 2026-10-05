import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Contract of #21: the six brand families self-hosted through next/font/google.
// next/font renames each family ('__Courier_Prime_<hash>'), and document.fonts.check() is true when
// no face matches at all, so every check first resolves the real family from its CSS variable and
// asserts that document.fonts.load() returned loaded faces.

const FAMILIES = [
  { variable: "--font-stardos", name: /Stardos.?Stencil/i, weights: ["700"] },
  { variable: "--font-oswald", name: /Oswald/i, weights: ["600", "700"] },
  { variable: "--font-plex-mono", name: /IBM.?Plex.?Mono/i, weights: ["400", "700"] },
  { variable: "--font-special-elite", name: /Special.?Elite/i, weights: ["400"] },
  { variable: "--font-courier-prime", name: /Courier.?Prime/i, weights: ["400", "700"] },
  { variable: "--font-vt323", name: /VT323/i, weights: ["400"] },
] as const;

const FRENCH = "Déjà, où est le café ?";

/** The first family name of a next/font CSS variable, quoted, e.g. `'__Oswald_1a2b3c'`. */
async function resolveFamily(page: Page, variable: string): Promise<string> {
  const value = await page.evaluate(
    (v) => getComputedStyle(document.documentElement).getPropertyValue(v),
    variable,
  );
  const first = value.split(",")[0]?.trim() ?? "";
  expect(first, `${variable} = ${value}`).toMatch(/^['"].+['"]$/);
  return first;
}

/** Loads `<weight> 16px <family>` for `text`; returns the face count, their statuses and check(). */
async function loadFace(page: Page, font: string, text: string) {
  return page.evaluate(
    async ([f, t]) => {
      await document.fonts.ready;
      const faces = await document.fonts.load(f, t);
      return {
        count: faces.length,
        statuses: faces.map((face) => face.status),
        check: document.fonts.check(f, t),
      };
    },
    [font, text] as const,
  );
}

test.describe("fonts (#21)", () => {
  test("C1 loads every family and weight from the self-hosted faces", async ({ page }) => {
    await page.goto("/design");
    for (const { variable, name, weights } of FAMILIES) {
      const family = await resolveFamily(page, variable);
      expect(family, variable).toMatch(name);
      for (const weight of weights) {
        const font = `${weight} 16px ${family}`;
        const result = await loadFace(page, font, "Fifth Copy 0412");
        expect(result.count, font).toBeGreaterThanOrEqual(1);
        expect(
          result.statuses.every((s) => s === "loaded"),
          font,
        ).toBe(true);
        expect(result.check, font).toBe(true);
      }
    }
  });

  test("C3 body copy is Courier Prime at 16px, line-height 1.55", async ({ page }) => {
    await page.goto("/design");
    const family = await resolveFamily(page, "--font-courier-prime");
    const body = await page.evaluate(() => {
      const s = getComputedStyle(document.body);
      return { fontFamily: s.fontFamily, fontSize: s.fontSize, lineHeight: s.lineHeight };
    });
    expect(body.fontFamily.split(",")[0]?.trim()).toBe(family);
    expect(body.fontSize).toBe("16px");
    expect(Number.parseFloat(body.lineHeight)).toBeCloseTo(16 * 1.55, 1);
  });

  test("C4 French accents render from the real Courier Prime face", async ({ page }) => {
    await page.goto("/design");
    const family = await resolveFamily(page, "--font-courier-prime");
    const real = await loadFace(page, `16px ${family}`, FRENCH);
    expect(real.count).toBeGreaterThanOrEqual(1);
    expect(real.statuses.every((s) => s === "loaded")).toBe(true);
    expect(real.check).toBe(true);
    // Letter of the contract (vacuous on its own, see the header comment).
    const literal = await page.evaluate(
      (t) => document.fonts.check('16px "Courier Prime"', t),
      FRENCH,
    );
    expect(literal).toBe(true);
  });

  test("C5 a cold load shifts less than 0.05 and every face uses font-display: swap", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as (PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        })[]) {
          if (!e.hadRecentInput) w.__cls += e.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto("/design", { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.05);

    const families: string[] = [];
    for (const { variable } of FAMILIES) {
      families.push((await resolveFamily(page, variable)).replace(/^['"]|['"]$/g, ""));
    }
    const faces = await page.evaluate((names) => {
      const out: { family: string; text: string }[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        for (const rule of Array.from(sheet.cssRules)) {
          if (!(rule instanceof CSSFontFaceRule)) continue;
          const family = rule.style.getPropertyValue("font-family").replace(/^['"]|['"]$/g, "");
          if (names.includes(family)) out.push({ family, text: rule.cssText });
        }
      }
      return out;
    }, families);
    for (const family of families) {
      expect(
        faces.some((f) => f.family === family),
        `@font-face for ${family}`,
      ).toBe(true);
    }
    for (const face of faces) expect(face.text, face.family).toContain("font-display: swap");
  });
});
