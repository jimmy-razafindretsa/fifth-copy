import type { Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "./fixtures";

/**
 * #28 reduced motion: one setting (`prefers-reduced-motion` or `<html data-motion="reduce">`) drives the
 * `--motion-*` tokens (CSS) and `useReducedMotion` / `MotionSafe` (script). Exercised on the /design
 * "Motion" demo. The shared fixture fails every test on a console error, so a hydration warning fails too.
 */
const box = (page: Page) => page.locator("[data-motion-demo]");
const safe = (page: Page) => page.locator("[data-motion-safe]");

async function motion(page: Page) {
  return page.evaluate(() => {
    const demo = getComputedStyle(document.querySelector("[data-motion-demo]")!);
    const button = getComputedStyle(document.querySelector("main button")!);
    const spinner = getComputedStyle(
      document.querySelector("main [role=status][aria-label=Loading]")!,
    );
    return {
      demo: demo.animationDuration,
      demoName: demo.animationName,
      button: button.transitionDuration,
      spinner: spinner.animationName,
      scroll: getComputedStyle(document.documentElement).scrollBehavior,
    };
  });
}

/** Resolves once React has hydrated `main` (the hook subscribes on mount). */
async function hydrated(page: Page) {
  await page.waitForFunction(() =>
    [...document.querySelectorAll("main *")].some((el) =>
      Object.keys(el).some((k) => k.startsWith("__reactFiber")),
    ),
  );
}

/**
 * Sets `data-motion="reduce"` on `<html>` after hydration. The settings card (#66) will render it on the
 * server like `data-theme`; a client script editing `<html>` before hydration would itself be a mismatch.
 */
async function reduceByAttribute(page: Page) {
  await hydrated(page);
  await page.evaluate(() => document.documentElement.setAttribute("data-motion", "reduce"));
}

test.describe("reduced motion (#28)", () => {
  test("C6 motion on: the demo pulses on --motion-duration-base and MotionSafe shows its children", async ({
    page,
  }) => {
    await page.goto("/design");
    await expect(page.getByRole("heading", { level: 2, name: "Motion" })).toBeVisible();
    await expect(safe(page)).toHaveText("Motion on");
    const m = await motion(page);
    expect(m.demo).toBe("0.2s");
    expect(m.demoName).not.toBe("none");
    expect(m.button).toBe("0.12s");
    expect(m.spinner).toBe("spin");
  });

  // The hook reads false on the server and true on this client: the case a naive hook would break.
  test("C2 C3 C4 C6 reduce via the media query: durations 0s, spins off, fallback, no hydration error", async ({
    page,
    pageErrors,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/design");
    await expect(safe(page)).toHaveText("Motion reduced");
    const m = await motion(page);
    expect(m.demo).toBe("0s");
    expect(m.button).toBe("0s");
    expect(m.spinner).toBe("none");
    expect(m.scroll).toBe("auto");
    await expectNoA11yViolations(page);
    expect(pageErrors.filter((e) => /hydrat/i.test(e))).toEqual([]);
  });

  test("C2 C4 C6 reduce via data-motion: durations 0s, spins off, fallback shown", async ({
    page,
  }) => {
    await page.goto("/design");
    await reduceByAttribute(page);
    await expect(safe(page)).toHaveText("Motion reduced");
    const m = await motion(page);
    expect(m.demo).toBe("0s");
    expect(m.button).toBe("0s");
    expect(m.spinner).toBe("none");
    expect(m.scroll).toBe("auto");
    await expectNoA11yViolations(page);
  });

  test("C3 updates live when the attribute or the media query changes", async ({ page }) => {
    await page.goto("/design");
    await expect(safe(page)).toHaveText("Motion on");
    await hydrated(page);

    await page.evaluate(() => document.documentElement.setAttribute("data-motion", "reduce"));
    await expect(safe(page)).toHaveText("Motion reduced");
    await expect(box(page)).toHaveCSS("animation-duration", "0s");

    await page.evaluate(() => document.documentElement.removeAttribute("data-motion"));
    await expect(safe(page)).toHaveText("Motion on");
    await expect(box(page)).toHaveCSS("animation-duration", "0.2s");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(safe(page)).toHaveText("Motion reduced");
    await expect(box(page)).toHaveCSS("animation-duration", "0s");

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(safe(page)).toHaveText("Motion on");
  });

  test("C6 the landing stops its keyframes under data-motion too", async ({ page }) => {
    await page.goto("/");
    await reduceByAttribute(page);
    const animated = await page.evaluate(() =>
      [...document.querySelectorAll("main *")]
        .map((el) => getComputedStyle(el))
        .filter((s) => s.animationName !== "none" && parseFloat(s.animationDuration) > 0)
        .map((s) => s.animationName),
    );
    expect(animated).toEqual([]);
  });
});
