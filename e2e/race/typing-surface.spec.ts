import type { Locator, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";

/**
 * #558 typing surface on /design#race-typing: the telex strip, the typed sheet and the typewriter keyboard
 * in six race states (C2, C3, C4, C5). Runs in every viewport project (mobile, tablet, desktop).
 */
const RED = "rgb(184, 29, 36)";
const PAPER = "rgb(241, 232, 214)";
const CHROME = "rgb(111, 115, 108)";
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

  test("C5 the reduced-motion specimen is still without any global setting", async ({ page }) => {
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

  test("C4 the keyboard: presentational keys, no button, hidden chrome; the jam reads red", async ({
    page,
  }) => {
    await ready(page);
    const racing = specimen(page, "racing").locator("[data-typewriter]");
    await expect(racing).toHaveAttribute("aria-hidden", "true");
    await expect(racing.locator('[data-key][role="presentation"]')).toHaveCount(40);
    await expect(racing.locator("button, img")).toHaveCount(0);
    await expect(racing.locator('[data-part="spool"]')).toHaveCount(2);
    await expect(racing.locator('[data-part="plate"]')).toHaveText("FIFTH COPY · MODEL 5");
    await expect(racing.locator('[data-pressed="true"]')).toHaveAttribute("data-key", "m");

    const ring = (kb: Locator) =>
      kb.locator('[data-key="q"]').evaluate((el) => getComputedStyle(el).borderTopColor);
    const bar = (kb: Locator) =>
      kb.locator('[data-part="keybar"]').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await ring(racing)).toBe(CHROME);
    expect(await bar(racing)).toBe(CHROME);

    const jammed = specimen(page, "block-jammed").locator("[data-typewriter]");
    await expect(jammed).toHaveAttribute("data-jammed", "true");
    expect(await ring(jammed)).toBe(RED);
    expect(await bar(jammed)).toBe(RED);
    await expect(jammed.locator('[data-part="jam"]')).toHaveCount(1);
    const wrongKey = jammed.locator('[data-wrong="true"]');
    await expect(wrongKey).toHaveAttribute("data-key", "a");
    expect(await wrongKey.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(RED);
    await expect(
      specimen(page, "finished").locator('[data-typewriter] [data-disabled="true"]'),
    ).toHaveCount(40);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`C5 the section is axe-clean and fits the page (${scheme})`, async ({ page }) => {
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
