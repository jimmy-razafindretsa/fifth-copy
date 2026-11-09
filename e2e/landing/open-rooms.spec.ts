import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { createLobby } from "../race/helpers";
import { ACTION_WAIT, HYDRATION_WAIT, scaled } from "../timeouts";

// Contract of #807: the landing's open-rooms docket (bible 14.1 "Open rooms docket", 7.4). Parallel
// workers open public rooms too, so every assertion targets this test's own room code.

const docket = (page: Page) => page.locator("section[data-open-rooms]");
const joinLink = (page: Page, code: string) =>
  docket(page).getByRole("link", { name: `Join room ${code}`, exact: true });
const roll = (page: Page) => page.getByRole("list", { name: "Typists in the room" });
/** Human rows of the waiting-room roll (a bot row carries the ink BOT tag). */
const typistRows = (page: Page) =>
  roll(page)
    .getByRole("listitem")
    .filter({ hasNot: page.getByText("BOT", { exact: true }) });
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** Loads the landing and waits for the docket to leave its skeleton (the query answered). */
async function landing(page: Page) {
  await page.goto("/");
  await expect(docket(page)).toBeVisible();
  await expect(docket(page).locator("[aria-busy='true']")).toHaveCount(0, {
    timeout: ACTION_WAIT,
  });
}

/** Opens a public room with QUICK RACE once the landing is hydrated (landing.spec.ts `ready`). */
async function quickRace(page: Page): Promise<string> {
  await page.goto("/");
  await expect(page.locator("section#play video[aria-hidden='true']")).toHaveAttribute(
    "data-feed",
    /^(armed|near)$/,
    { timeout: HYDRATION_WAIT },
  );
  await page.locator("section#play").getByRole("button", { name: "QUICK RACE" }).click();
  await page.waitForURL(/\/lobby\/[A-Z]{3}-\d{4}$/, { timeout: ACTION_WAIT });
  // seated: the roll shows the host, so the race server has the room
  await expect(typistRows(page)).toHaveCount(1, { timeout: ACTION_WAIT });
  return /\/lobby\/([A-Z]{3}-\d{4})$/.exec(new URL(page.url()).pathname)![1]!;
}

async function freshContext(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  return { context, page: await context.newPage() };
}

test.describe("open rooms docket (#807)", () => {
  test.beforeEach(() => test.slow());

  test("C1 a visitor sees a public room, follows JOIN → and both rolls show two typists", async ({
    page,
    browser,
  }) => {
    const code = await quickRace(page);
    const b = await freshContext(browser);
    await landing(b.page);
    await expect(docket(b.page).getByRole("heading", { level: 2 })).toHaveText("OPEN ROOMS");
    await expect(docket(b.page).getByText("LIVE", { exact: true })).toBeVisible();
    const link = joinLink(b.page, code);
    await expect(link).toHaveText("JOIN →");
    await expect(link).toHaveAttribute("href", `/lobby/${code}`);
    const row = link.locator("xpath=ancestor::li");
    await expect(row).toContainText(code);
    await expect(row).toContainText(/1 TYPIST · \d+ BOTS?/);

    await link.click();
    await b.page.waitForURL(`**/lobby/${code}`, { timeout: ACTION_WAIT });
    await expect(typistRows(b.page)).toHaveCount(2, { timeout: ACTION_WAIT });
    await expect(typistRows(page)).toHaveCount(2, { timeout: scaled(2_000) });
    await b.context.close();
  });

  test("C3 a private room is never listed", async ({ page, browser }) => {
    const code = await createLobby(page);
    await expect(typistRows(page)).toHaveCount(1, { timeout: ACTION_WAIT });
    const b = await freshContext(browser);
    await landing(b.page);
    await expect(joinLink(b.page, code)).toHaveCount(0);
    await expect(docket(b.page)).not.toContainText(code);
    await b.context.close();
  });

  test("C4 once the host leaves and the room closes, a reload no longer lists it", async ({
    browser,
  }) => {
    const a = await freshContext(browser);
    const code = await quickRace(a.page);
    const b = await freshContext(browser);
    await landing(b.page);
    await expect(joinLink(b.page, code)).toBeVisible();

    // the last human's socket closes: the race server closes the waiting room (#145)
    await a.context.close();
    await expect(async () => {
      await landing(b.page);
      await expect(joinLink(b.page, code)).toHaveCount(0, { timeout: scaled(500) });
    }).toPass({ timeout: ACTION_WAIT });
    await b.context.close();
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`C6 ${scheme}: no axe violation with a populated docket, no horizontal scroll, 44px JOIN`, async ({
      page,
      browser,
    }) => {
      const code = await quickRace(page);
      const b = await freshContext(browser);
      await b.page.setViewportSize(page.viewportSize()!);
      if (scheme === "dark") {
        // the landing opens on paper whatever the OS (bible 3.2): Night shift is the saved choice
        await b.page.emulateMedia({ colorScheme: "dark" });
        await b.context.addCookies([
          { name: "theme", value: "dark", url: test.info().project.use.baseURL! },
        ]);
      }
      await landing(b.page);
      if (scheme === "dark")
        await expect(b.page.locator("html")).toHaveAttribute("data-theme", "dark");
      const link = joinLink(b.page, code);
      await link.scrollIntoViewIfNeeded();
      await expect(link).toBeVisible();
      await expectNoA11yViolations(b.page);
      expect(await overflow(b.page)).toBeLessThanOrEqual(0);

      const box = await link.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      if (page.viewportSize()!.width <= 375) {
        // full width: the docket spans the hero's actions column
        const [own, column] = await docket(b.page).evaluate((el) => [
          el.getBoundingClientRect().width,
          el.parentElement!.getBoundingClientRect().width,
        ]);
        expect(Math.abs(own! - column!)).toBeLessThanOrEqual(1);
      }
      await b.context.close();
    });
  }
});
