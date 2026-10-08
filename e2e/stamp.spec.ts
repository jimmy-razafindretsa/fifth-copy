import type { Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "./fixtures";

/**
 * #26 Stamp slam (C3) and reduced motion (C4), on the /design "Stamps" replay demo: `data-stamp-settled`
 * counts `onSettled` for the current mount, Replay remounts the stamp by key. Timing test: rerun it
 * alone before blaming the stamp when the machine is loaded (#600).
 */
const demo = (page: Page) => page.locator("[data-stamp-demo]");
const stamp = (page: Page) => demo(page).locator("[data-stamp-tone]");
const replay = (page: Page) => demo(page).getByRole("button", { name: "Replay" });

/** Resolves once React has hydrated `main` (as e2e/motion.spec.ts). */
async function hydrated(page: Page) {
  await page.waitForFunction(() =>
    [...document.querySelectorAll("main *")].some((el) =>
      Object.keys(el).some((k) => k.startsWith("__reactFiber")),
    ),
  );
}

async function slam(page: Page) {
  return stamp(page).evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      name: s.animationName,
      duration: s.animationDuration,
      delay: s.animationDelay,
      iterations: s.animationIterationCount,
      transform: s.transform,
    };
  });
}

/** Clicks Replay in the page and resolves with the ms until the new mount reports `onSettled`. */
async function replayAndTime(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const box = document.querySelector<HTMLElement>("[data-stamp-demo]")!;
        const button = [...box.querySelectorAll("button")].find((b) => b.textContent === "Replay")!;
        const run = box.dataset.stampRun;
        let t0 = 0;
        const observer = new MutationObserver(() => {
          if (box.dataset.stampRun !== run && box.dataset.stampSettled === "1") {
            observer.disconnect();
            resolve(performance.now() - t0);
          }
        });
        observer.observe(box, { attributes: true });
        setTimeout(() => reject(new Error("onSettled never fired")), 3000);
        t0 = performance.now();
        button.click();
      }),
  );
}

/** onSettled fired exactly once for this mount, and nothing more arrives later. */
async function settledOnce(page: Page) {
  await expect(demo(page)).toHaveAttribute("data-stamp-settled", "1");
  await page.waitForTimeout(600);
  await expect(demo(page)).toHaveAttribute("data-stamp-settled", "1");
}

test.describe("#26 stamp slam", () => {
  test("C3 fcSlam over --motion-duration-slam (0.35s), once; onSettled once; entrance under 450ms", async ({
    page,
  }) => {
    await page.goto("/design");
    await hydrated(page);
    const m = await slam(page);
    expect(m.name).toMatch(/fcSlam$/);
    expect(m.duration).toBe("0.35s");
    expect(m.delay).toBe("0s");
    expect(m.iterations).toBe("1");
    // the server-rendered first mount settles too, even when it landed before hydration
    await settledOnce(page);

    const elapsed = await replayAndTime(page);
    expect(elapsed).toBeLessThan(450);
    expect(elapsed).toBeGreaterThanOrEqual(300);
    await settledOnce(page);
    // settled on its angle: the auto angle of the "overtake" seed, crooked by at least 2 degrees
    const angle = Number(await stamp(page).getAttribute("data-stamp-angle"));
    expect(Math.abs(angle)).toBeGreaterThanOrEqual(2);
    expect(Math.abs(angle)).toBeLessThanOrEqual(6);
    const { transform } = await slam(page);
    const [a, b] = transform.match(/-?[\d.e-]+/g)!.map(Number);
    expect(Math.atan2(b!, a!) * (180 / Math.PI)).toBeCloseTo(angle, 1);
  });

  test("C4 prefers-reduced-motion: no animation, onSettled still once per mount", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/design");
    await hydrated(page);
    const m = await slam(page);
    expect(m.name).toBe("none");
    expect(m.transform).not.toBe("none");
    await settledOnce(page);
    await replay(page).click();
    await expect(demo(page)).toHaveAttribute("data-stamp-run", "1");
    expect((await slam(page)).name).toBe("none");
    await settledOnce(page);
    await expectNoA11yViolations(page);
  });

  test('C4 <html data-motion="reduce">: no animation, onSettled still once per mount', async ({
    page,
  }) => {
    await page.goto("/design");
    await hydrated(page);
    await page.evaluate(() => document.documentElement.setAttribute("data-motion", "reduce"));
    await expect(stamp(page)).toHaveCSS("animation-name", "none");
    await settledOnce(page);
    await replay(page).click();
    await expect(demo(page)).toHaveAttribute("data-stamp-run", "1");
    expect((await slam(page)).name).toBe("none");
    await settledOnce(page);
  });

  test("C1 the lg stamp fits a 375px phone without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/design");
    await stamp(page).scrollIntoViewIfNeeded();
    const box = await stamp(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
});
