import type { BrowserContext, Page } from "@playwright/test";
import { ACTION_WAIT, HYDRATION_WAIT } from "../timeouts";
import { expect, expectNoA11yViolations, test } from "../fixtures";

// Contract of #57 (design bible 7.3 ink tone, 7.4 docket): right after a merge the next render shows the
// ink FILED stamp and "N races and your stats were carried into your Personnel file", read from the
// one-shot `fc_merged` cookie, which is gone once the page has rendered. The merge callers (#39, #40,
// #50) set the cookie through `flashMerge`; here the cookie is planted the way they leave it.
const COOKIE = "fc_merged";

async function plant(context: BrowserContext, value: string, locale?: "fr") {
  const url = test.info().project.use.baseURL!;
  await context.addCookies([
    { name: COOKIE, value, url },
    ...(locale ? [{ name: "locale", value: locale, url }] : []),
  ]);
}

async function flashCookie(context: BrowserContext) {
  return (await context.cookies()).find((c) => c.name === COOKIE);
}

const docket = (page: Page, name = "FILED") => page.getByRole("region", { name, exact: true });

test.describe("merge confirmation stamp (#57)", () => {
  test("C1 shows the carried races once, then the cookie is cleared", async ({ page, context }) => {
    await plant(context, "3");
    await page.goto("/");
    const stamp = docket(page);
    await expect(stamp).toBeVisible({ timeout: HYDRATION_WAIT });
    await expect(stamp).toContainText(
      "3 races and your stats were carried into your Personnel file.",
    );
    await expect(stamp).toContainText("3 RACES CARRIED");
    await expect.poll(() => flashCookie(context), { timeout: HYDRATION_WAIT }).toBeUndefined();

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(docket(page)).toHaveCount(0);
  });

  test("C1 plural forms for 0 and 1, and the French catalog", async ({ page, context }) => {
    await plant(context, "1");
    await page.goto("/");
    await expect(docket(page)).toContainText(
      "1 race and your stats were carried into your Personnel file.",
      { timeout: HYDRATION_WAIT },
    );
    await expect.poll(() => flashCookie(context), { timeout: HYDRATION_WAIT }).toBeUndefined();

    await plant(context, "0");
    await page.goto("/");
    await expect(docket(page)).toContainText(
      "0 races and your stats were carried into your Personnel file.",
      { timeout: HYDRATION_WAIT },
    );
    await expect.poll(() => flashCookie(context), { timeout: HYDRATION_WAIT }).toBeUndefined();

    await plant(context, "4", "fr");
    await page.goto("/");
    const fr = docket(page, "CLASSÉ");
    await expect(fr).toContainText(
      "4 courses et tes statistiques ont été versées à ton dossier du personnel.",
      { timeout: HYDRATION_WAIT },
    );
    await expect(fr).toContainText("4 COURSES REPORTÉES");
  });

  test("C1 DISMISS closes the docket by keyboard", async ({ page, context }) => {
    await plant(context, "2");
    await page.goto("/");
    const stamp = docket(page);
    await expect(stamp).toBeVisible({ timeout: HYDRATION_WAIT });
    await expect.poll(() => flashCookie(context), { timeout: HYDRATION_WAIT }).toBeUndefined();
    const dismiss = stamp.getByRole("button", { name: "DISMISS", exact: true });
    await dismiss.focus();
    await page.keyboard.press("Enter");
    await expect(docket(page)).toHaveCount(0, { timeout: ACTION_WAIT });
  });

  test("C2 the ink Stamp primitive slams in, and stays still under reduced motion", async ({
    page,
    context,
  }) => {
    await plant(context, "5");
    await page.goto("/");
    const stamp = docket(page).locator("[data-stamp-tone]");
    await expect(stamp).toHaveAttribute("data-stamp-tone", "ink", { timeout: HYDRATION_WAIT });
    const angle = Number(await stamp.getAttribute("data-stamp-angle"));
    expect(Math.abs(angle)).toBeGreaterThanOrEqual(2);
    expect(Math.abs(angle)).toBeLessThanOrEqual(6);
    expect(await stamp.evaluate((el) => getComputedStyle(el).animationName)).toContain("fcSlam");
    await expectNoA11yViolations(page);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await plant(context, "5");
    await page.goto("/");
    const still = docket(page).locator("[data-stamp-tone]");
    await expect(still).toBeVisible({ timeout: HYDRATION_WAIT });
    expect(await still.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  });
});
