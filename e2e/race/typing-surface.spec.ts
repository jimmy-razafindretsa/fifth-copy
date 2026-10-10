import type { Locator, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";

/**
 * #558 typing surface on /design#race-typing: the telex strip, the typed sheet and the teleprinter skin of
 * the typing machine in six race states (C2-C7). Runs in every viewport project (mobile, tablet, desktop).
 */
const RED = "rgb(184, 29, 36)";
const PAPER = "rgb(241, 232, 214)";
const INK = "rgb(42, 36, 32)";
const METAL = "rgb(111, 115, 108)";
const DECK = "rgb(228, 214, 184)";
const STATES = [
  "before-start",
  "racing",
  "continue-wrong",
  "block-jammed",
  "finished",
  "reduced-motion",
] as const;

const specimen = (page: Page, id: (typeof STATES)[number]) =>
  page.locator(`[data-typing-state="${id}"]`);
const machine = (page: Page, id: (typeof STATES)[number]) =>
  specimen(page, id).locator("[data-machine]");

/** The computed look of a machine part (colours as rgb strings, the stem as the box-shadow). */
async function look(locator: Locator) {
  return locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      bg: s.backgroundColor,
      color: s.color,
      border: s.borderTopColor,
      borderStyle: s.borderTopStyle,
      shadow: s.boxShadow,
      translate: s.translate,
    };
  });
}

/** The vertical offset of a box-shadow like `rgb(111, 115, 108) 0px 3px 0px 0px`. */
const stem = (shadow: string) => Number(/\)\s+(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(shadow)?.[2]);

/** Resolves once every strip has placed its tape (the client effect ran: hydrated). */
async function ready(page: Page) {
  await page.goto("/design#race-typing");
  await expect(page.locator('[data-telex-ready="true"]')).toHaveCount(STATES.length);
}

async function motionOf(locator: Locator) {
  return locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      name: s.animationName,
      duration: s.animationDuration,
      timing: s.animationTimingFunction,
      iterations: s.animationIterationCount,
      bg: s.backgroundColor,
      color: s.color,
    };
  });
}

const next = (scope: Locator) => scope.locator('[data-state="next"]');
const last = (scope: Locator) => scope.locator('[data-last="true"]');

/** Both the strip and the sheet of a specimen show the solid caret cell and no pop. */
async function expectStill(scope: Locator) {
  for (const part of ["[data-telex]", "[data-sheet]"]) {
    const caret = await motionOf(next(scope.locator(part)));
    expect(caret.name, `${part} caret`).toBe("none");
    expect(caret.bg, `${part} caret`).toBe(RED);
    expect(caret.color, `${part} caret`).toBe(PAPER);
    expect((await motionOf(last(scope.locator(part)))).name, `${part} pop`).toBe("none");
  }
  const scroll = await scope
    .locator("[data-telex-ready]")
    .evaluate((el) => getComputedStyle(el).scrollBehavior);
  expect(scroll).toBe("auto");
}

test.describe("#558 typing surface", () => {
  test("C3 the caret blinks fcCaret 1.05s steps(1) and the last typed char pops with fcPop 0.18s", async ({
    page,
  }) => {
    await ready(page);
    for (const part of ["[data-telex]", "[data-sheet]"]) {
      const scope = specimen(page, "racing").locator(part);
      const caret = await motionOf(next(scope));
      expect(caret.name, part).toMatch(/fcCaret/);
      expect(caret.duration, part).toBe("1.05s");
      expect(caret.timing, part).toBe("steps(1)");
      expect(caret.iterations, part).toBe("infinite");
      const pop = await motionOf(last(scope));
      expect(pop.name, part).toMatch(/fcPop/);
      expect(pop.duration, part).toBe("0.18s");
    }
    const scroll = await specimen(page, "racing")
      .locator("[data-telex-ready]")
      .evaluate((el) => getComputedStyle(el).scrollBehavior);
    expect(scroll).toBe("smooth");
  });

  test("C3 C2 prefers-reduced-motion: a solid red cell, no pop, the tape jumps", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await ready(page);
    await expectStill(specimen(page, "racing"));
  });

  test('C3 C2 <html data-motion="reduce">: a solid red cell, no pop, the tape jumps', async ({
    page,
  }) => {
    await ready(page);
    await page.evaluate(() => document.documentElement.setAttribute("data-motion", "reduce"));
    await expectStill(specimen(page, "racing"));
  });

  test("C7 the reduced-motion specimen is still without any global setting", async ({ page }) => {
    await ready(page);
    await expect(specimen(page, "reduced-motion")).toHaveAttribute("data-motion", "reduce");
    await expectStill(specimen(page, "reduced-motion"));
  });

  test("C3 a Continue-mode slip is red on the tape and struck with an x on the sheet", async ({
    page,
  }) => {
    await ready(page);
    const scope = specimen(page, "continue-wrong");
    const sheet = scope.locator('[data-sheet] [data-state="wrong"]');
    await expect(sheet).toHaveCount(2);
    for (const i of [0, 1]) {
      const look = await sheet.nth(i).evaluate((el) => ({
        color: getComputedStyle(el).color,
        over: getComputedStyle(el, "::after").content,
        overColor: getComputedStyle(el, "::after").color,
      }));
      expect(look).toEqual({ color: RED, over: '"×"', overColor: RED });
    }
    const tape = scope.locator('[data-telex] [data-state="wrong"]');
    await expect(tape).toHaveCount(2);
    expect(await tape.first().evaluate((el) => getComputedStyle(el).color)).toBe(RED);
  });

  test("C3 the sheet holds only the typed part and the caret cell", async ({ page }) => {
    await ready(page);
    const racing = specimen(page, "racing").locator("[data-sheet]");
    await expect(racing.locator('[data-state="remaining"]')).toHaveCount(0);
    await expect(racing.locator('[data-state="next"]')).toHaveCount(1);
    const finished = specimen(page, "finished").locator("[data-sheet]");
    await expect(finished.locator('[data-state="next"]')).toHaveCount(0);
    await expect(finished.locator('[data-state="done"]')).toHaveCount(86);
  });

  test("C2 the strip cannot be selected and keeps the next char inside its visible box", async ({
    page,
  }) => {
    await ready(page);
    for (const id of STATES) {
      const strip = specimen(page, id).locator("[data-telex]");
      expect(await strip.evaluate((el) => getComputedStyle(el).userSelect), id).toBe("none");
      const inside = await strip.locator("[data-telex-ready]").evaluate((vp) => {
        const tape = vp.firstElementChild!;
        const focus = tape.querySelector('[data-state="next"]') ?? tape.lastElementChild ?? tape;
        const v = vp.getBoundingClientRect();
        const f = focus.getBoundingClientRect();
        return {
          left: f.left >= v.left - 0.5,
          right: f.right <= v.right + 0.5,
          scrolled: vp.scrollLeft,
        };
      });
      expect([inside.left, inside.right], `${id} scrollLeft=${inside.scrolled}`).toEqual([
        true,
        true,
      ]);
    }
  });

  test("C4 C5 the teleprinter: one skin root, presentational keys, its parts in machine widths", async ({
    page,
  }) => {
    await ready(page);
    const racing = machine(page, "racing");
    await expect(racing).toHaveAttribute("aria-hidden", "true");
    await expect(racing).toHaveAttribute("data-skin", "teleprinter");
    await expect(racing.locator('[data-key][role="presentation"]')).toHaveCount(41);
    await expect(racing.locator('[data-key=" "]')).toHaveCount(1);
    await expect(racing.locator("button, img, canvas")).toHaveCount(0);
    for (const part of ["panel", "slot", "reel", "plate", "dial", "deck"]) {
      await expect(racing.locator(`[data-part="${part}"]`), part).toHaveCount(1);
    }
    await expect(racing.locator('[data-part="plate"]')).toHaveText("FIFTH COPY · MODEL 5");
    await expect(racing.locator('[data-part="jam"]')).toHaveCount(0);

    // E4 at 1280 x 800: 620 wide, panel 64, slot 400, deck about 190; narrower columns scale it whole
    const box = async (sel: string) => (await racing.locator(sel).boundingBox())!;
    const width = (await box('[data-part="panel"]')).width;
    const u = width / 620;
    const viewport = page.viewportSize()!;
    if (viewport.width >= 1280) expect(width).toBeCloseTo(620, 0);
    expect((await box('[data-part="panel"]')).height / u).toBeCloseTo(64, 0);
    expect((await box('[data-part="slot"]')).width / u).toBeCloseTo(400, 0);
    const deck = (await box('[data-part="deck"]')).height / u;
    expect(deck).toBeGreaterThan(180);
    expect(deck).toBeLessThan(210);
  });

  test("C6 the key states and the jam paint from attributes only", async ({ page }) => {
    await ready(page);
    const racing = machine(page, "racing");

    // at rest: ink cap, paper legend, ink outline, a metal stem under the cap
    const rest = await look(racing.locator('[data-key="q"]'));
    expect([rest.bg, rest.color, rest.border, rest.borderStyle]).toEqual([
      INK,
      PAPER,
      INK,
      "solid",
    ]);
    expect(rest.shadow).toContain(METAL);
    expect(rest.translate).toBe("none");

    // pressed: the cap one step down onto its stem (translated, the stem offset shrinks)
    const pressed = racing.locator('[data-pressed="true"]');
    await expect(pressed).toHaveCount(1);
    await expect(pressed).toHaveAttribute("data-key", "m");
    const down = await look(pressed);
    expect(down.translate).not.toBe("none");
    expect(stem(down.shadow)).toBeLessThan(stem(rest.shadow));
    expect(down.bg).toBe(INK);

    // wrong: that one cap red with a paper legend, never the deck
    const slip = machine(page, "continue-wrong");
    const wrong = slip.locator('[data-wrong="true"]');
    await expect(wrong).toHaveCount(1);
    await expect(wrong).toHaveAttribute("data-key", "b");
    const red = await look(wrong);
    expect([red.bg, red.color]).toEqual([RED, PAPER]);
    expect((await look(slip.locator('[data-part="deck"]'))).bg).toBe(DECK);

    // disabled (finished): a dashed metal outline, the deck showing through, a muted legend
    const done = machine(page, "finished");
    await expect(done.locator('[data-disabled="true"]')).toHaveCount(41);
    const off = await look(done.locator('[data-key="q"]'));
    expect([off.bg, off.border, off.borderStyle]).toEqual(["rgba(0, 0, 0, 0)", METAL, "dashed"]);
    expect(off.color).not.toBe(PAPER);
    expect(off.color).not.toBe(INK);
    expect((await look(done.locator('[data-key=" "]'))).borderStyle).toBe("dashed");

    // jam (Block): key outlines, the space bar and the slot red, plus the X; caps and panel unchanged
    const jam = machine(page, "block-jammed");
    await expect(jam).toHaveAttribute("data-jammed", "true");
    await expect(racing).not.toHaveAttribute("data-jammed", /.*/);
    const jammedKey = await look(jam.locator('[data-key="q"]'));
    expect([jammedKey.border, jammedKey.bg]).toEqual([RED, INK]);
    expect((await look(jam.locator('[data-key=" "]'))).bg).toBe(RED);
    expect((await look(jam.locator('[data-part="slot"]'))).bg).toBe(RED);
    expect((await look(jam.locator('[data-part="panel"]'))).bg).toBe(PAPER);
    await expect(jam.locator('[data-part="jam"]')).toHaveCount(1);
    await expect(jam.locator('[data-part="jam"] line')).toHaveCount(2);
    expect(
      await jam
        .locator('[data-part="jam"] line')
        .first()
        .evaluate((el) => getComputedStyle(el).stroke),
    ).toBe(RED);
    // the same parts at rest
    expect((await look(racing.locator('[data-key=" "]'))).bg).toBe(INK);
    expect((await look(racing.locator('[data-part="slot"]'))).bg).toBe(INK);
  });

  test("C7 the sheet rises out of the slot: the machine paints over its bottom edge", async ({
    page,
  }) => {
    await ready(page);
    for (const id of STATES) {
      const scope = specimen(page, id);
      await scope.locator('[data-part="slot"]').scrollIntoViewIfNeeded();
      const sheet = (await scope.locator("[data-sheet]").boundingBox())!;
      const slot = (await scope.locator('[data-part="slot"]').boundingBox())!;
      expect(sheet.x, id).toBeGreaterThanOrEqual(slot.x);
      expect(sheet.x + sheet.width, id).toBeLessThanOrEqual(slot.x + slot.width);
      expect(sheet.y + sheet.height, id).toBeGreaterThan(slot.y + slot.height);
      const onTop = await page.evaluate(
        ({ x, y }) => !!document.elementFromPoint(x, y)?.closest("[data-machine]"),
        { x: sheet.x + sheet.width / 2, y: sheet.y + sheet.height - 2 },
      );
      expect(onTop, id).toBe(true);
    }
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`C7 the section is axe-clean and fits the page (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await ready(page);
      await expect(page.getByRole("heading", { level: 2, name: "Typing surface" })).toBeVisible();
      await expect(page.getByRole("group", { name: /^Text to type/ })).toHaveCount(STATES.length);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow).toBe(false);
      await expectNoA11yViolations(page);
    });
  }
});
