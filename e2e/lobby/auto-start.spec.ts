import type { BrowserContext, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import {
  LOBBY_PATH,
  closeOpenPublicLobbies,
  createLobby,
  joinAsGuest,
  lobbyIdOf,
  phaseOf,
  recordRaceTokens,
  setHostSettings,
  startButton,
  warmRace,
} from "../race/helpers";
import { ACTION_WAIT, HYDRATION_WAIT, scaled } from "../timeouts";

// Contract of #814 C9 and C10 over the race server playwright.config.ts starts, at real durations: a
// public room (QUICK RACE) starts by itself 45 s after a human sits with another desk; the host's START
// still wins; a private room never counts down. Public rooms, so @matchmaking (alone, in order).

const RACE_PATH = /\/race\/([0-9a-f-]{36})$/;
const COUNTING = /^STARTS IN (\d+) S$/;
const status = (page: Page) => page.locator("dt", { hasText: /^STATUS$/ }).locator("+ dd");
const notice = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const figure = async (page: Page) => {
  const m = COUNTING.exec((await status(page).textContent()) ?? "");
  return m ? Number(m[1]) : null;
};
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** A visitor on the hydrated landing presses the hero's QUICK RACE; returns the room code. */
async function quickRace(page: Page): Promise<string> {
  await page.goto("/");
  await expect(page.locator("section#play video[aria-hidden='true']")).toHaveAttribute(
    "data-feed",
    /^(armed|near)$/,
    { timeout: HYDRATION_WAIT },
  );
  await page
    .locator("section#play")
    .getByRole("button", { name: "QUICK RACE", exact: true })
    .click();
  await page.waitForURL((url) => LOBBY_PATH.test(url.pathname), { timeout: ACTION_WAIT });
  return LOBBY_PATH.exec(new URL(page.url()).pathname)![1]!;
}

test.describe("#814 public room auto start @matchmaking", () => {
  test.describe.configure({ mode: "serial" });

  const opened: BrowserContext[] = [];
  test.beforeEach(async () => {
    test.slow();
    await closeOpenPublicLobbies();
  });
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  test("C9a nobody presses START: both pages count down together and reach the race", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(180_000));
    const code = await quickRace(page);
    await expect(status(page)).toHaveText(/^STARTS IN (45|44|43|42|41|40) S$/, {
      timeout: scaled(10_000),
    });
    const seatedAt = Date.now();
    await warmRace(page, await lobbyIdOf(code));
    const first = (await figure(page))!;
    await expect.poll(() => figure(page), { timeout: scaled(4_000) }).toBeLessThan(first);
    await expect(startButton(page)).toBeEnabled();
    await expect(notice(page, "WAITING FOR THE HOST")).toHaveCount(0);
    await expect(notice(page, "AUTOMATIC START")).toHaveCount(0);

    const b = await joinAsGuest(browser, code);
    opened.push(b.context);
    await expect(status(b.page)).toHaveText(COUNTING, { timeout: scaled(2_000) });
    const [fa, fb] = [await figure(page), await figure(b.page)];
    expect(Math.abs(fa! - fb!)).toBeLessThanOrEqual(2);
    await expect(notice(b.page, "AUTOMATIC START")).toBeVisible();
    await expect(notice(b.page, "WAITING FOR THE HOST")).toHaveCount(0);
    await expect(startButton(b.page)).toHaveCount(0);

    await b.page.reload();
    await expect(status(b.page)).toHaveText(COUNTING, { timeout: scaled(2_000) });

    const deadline = Math.max(1_000, scaled(60_000) - (Date.now() - seatedAt));
    await Promise.all(
      [page, b.page].map((p) => expect(p).toHaveURL(RACE_PATH, { timeout: deadline })),
    );
    expect(RACE_PATH.exec(b.page.url())![1]).toBe(RACE_PATH.exec(page.url())![1]);
    for (const p of [page, b.page]) {
      await expect(phaseOf(p)).toHaveAttribute("data-phase", /^(countdown|running)$/, {
        timeout: scaled(20_000),
      });
      await expect(phaseOf(p)).toHaveAttribute("data-phase", "running", {
        timeout: scaled(20_000),
      });
    }
  });

  test("C9b no bots drops the countdown, one bot arms it again, the host's START wins", async ({
    page,
  }) => {
    await recordRaceTokens(page);
    const code = await quickRace(page);
    await expect(status(page)).toHaveText(COUNTING, { timeout: scaled(10_000) });

    await setHostSettings(page, { bots: [] });
    await expect(status(page)).toHaveText("WAITING", { timeout: scaled(2_000) });
    await setHostSettings(page, { bots: [{ level: "clerk" }] });
    await expect(status(page)).toHaveText(COUNTING, { timeout: scaled(2_000) });

    await warmRace(page, await lobbyIdOf(code));
    await startButton(page).click();
    await expect(page).toHaveURL(RACE_PATH, { timeout: scaled(10_000) });
  });

  test("C9c a private room stays WAITING and its guest waits for the host", async ({
    page,
    browser,
  }) => {
    await recordRaceTokens(page);
    const code = await createLobby(page);
    await setHostSettings(page, { bots: [{ level: "clerk" }] });
    await expect(status(page)).toHaveText("WAITING", { timeout: ACTION_WAIT });

    const b = await joinAsGuest(browser, code);
    opened.push(b.context);
    await expect(notice(b.page, "WAITING FOR THE HOST")).toBeVisible({ timeout: ACTION_WAIT });
    for (let i = 0; i < 5; i++) {
      await expect(status(page)).toHaveText("WAITING");
      await expect(status(b.page)).toHaveText("WAITING");
      await page.waitForTimeout(scaled(1_000));
    }
    await expect(notice(b.page, "AUTOMATIC START")).toHaveCount(0);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`C10 ${scheme}: axe clean and no horizontal scroll at 375, 768 and 1280 while counting`, async ({
      page,
      browser,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const code = await quickRace(page);
      await expect(status(page)).toHaveText(COUNTING, { timeout: scaled(10_000) });
      const b = await joinAsGuest(browser, code);
      opened.push(b.context);
      await b.page.emulateMedia({ colorScheme: scheme });
      await expect(notice(b.page, "AUTOMATIC START")).toBeVisible({ timeout: scaled(2_000) });

      for (const width of [375, 768, 1280]) {
        for (const p of [page, b.page]) {
          await p.setViewportSize({ width, height: 900 });
          await expect(status(p)).toHaveText(COUNTING);
          await expectNoA11yViolations(p);
          expect(await overflow(p)).toBeLessThanOrEqual(0);
        }
      }
    });
  }
});
