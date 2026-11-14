import type { BrowserContext, Page } from "@playwright/test";
import { LANDING, expect, test } from "../fixtures";
import {
  LOBBY_PATH,
  joinAsGuest,
  lobbyIdOf,
  phaseOf,
  recordRaceTokens,
  setHostSettings,
  startButton,
  warmRace,
} from "../race/helpers";
import { HYDRATION_WAIT, scaled } from "../timeouts";

// Contract of #367 C3 and C4 over the race server playwright.config.ts starts: the landing's
// PRACTISE VS BOTS entry opens a private lobby seated with two server-side bots (clerk, officer), the
// visitor its host; START runs the race at once and the bots type on the server (ADR 0006, 0007).

const RACE_PATH = /\/race\/([0-9a-f-]{36})$/;
const roll = (page: Page) => page.getByRole("list", { name: "Typists in the room" });
const rows = (page: Page) => roll(page).getByRole("listitem");
const settingsDocket = (page: Page) => page.getByRole("region", { name: "RACE SETTINGS" });
const setting = (page: Page, label: string) =>
  settingsDocket(page)
    .locator("dt")
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator("+ dd");
const stripText = async (page: Page) =>
  (await page.locator("[data-telex] [data-state]").allTextContents()).join("");
const ended = (page: Page) => page.locator('[data-seat-status] [data-finished="ended"]');

/** A fresh visitor on the landing, hydrated (the live feed leaves `idle` only on the client), clicks the entry. */
async function practise(page: Page): Promise<string> {
  await page.goto(LANDING);
  await expect(page.locator("section#play video[aria-hidden='true']")).toHaveAttribute(
    "data-feed",
    /^(armed|near)$/,
    { timeout: HYDRATION_WAIT },
  );
  await page.getByRole("button", { name: "PRACTISE VS BOTS", exact: true }).click();
  await page.waitForURL((url) => LOBBY_PATH.test(url.pathname), { timeout: scaled(15_000) });
  return LOBBY_PATH.exec(new URL(page.url()).pathname)![1]!;
}

test.describe("#367 solo practice against bots", () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project (phones watch, bible 18)");

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  test("C3 the entry lands a fresh visitor as host of a private lobby with two bots; START enabled", async ({
    page,
    browser,
  }) => {
    const code = await practise(page);
    await expect(rows(page)).toHaveCount(3, { timeout: scaled(10_000) });
    await expect(rows(page).first().getByText("HOST", { exact: true })).toBeVisible();
    await expect(rows(page).first().getByText("YOU", { exact: true })).toBeVisible();
    await expect(rows(page).filter({ has: page.getByText("BOT", { exact: true }) })).toHaveCount(2);
    await expect(page.getByText("WAITING ROOM · PRIVATE RACE", { exact: true })).toBeVisible();
    await expect(startButton(page)).toBeEnabled({ timeout: scaled(10_000) });

    // The host's FORM 5-L holds controls in the value slots (#110, #114): the two bot sub-rows and
    // the PRIVATE segment; the same docket read-only (a guest's view) prints the rows' text.
    await expect(
      setting(page, "BOT 1").getByRole("button", { name: "CLERK", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      setting(page, "BOT 2").getByRole("button", { name: "OFFICER", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      setting(page, "LOBBY").getByRole("button", { name: "PRIVATE", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const guest = await joinAsGuest(browser, code);
    opened.push(guest.context);
    await expect(setting(guest.page, "BOTS")).toHaveText("2 BOTS · CLERK, OFFICER");
    await expect(setting(guest.page, "LOBBY")).toHaveText("PRIVATE");
  });

  test("C4 START runs the countdown, the bots type within 10 s and the Dawn report lists three desks", async ({
    page,
  }) => {
    test.setTimeout(scaled(150_000));
    await recordRaceTokens(page);
    const code = await practise(page);
    await expect(rows(page)).toHaveCount(3, { timeout: scaled(10_000) });
    // A short text, so the 35 and 55 WPM bots finish in seconds (bots stay the practice defaults).
    const settings = await setHostSettings(page, { wordCount: 10, timerS: null });
    expect(settings.bots).toEqual([{ level: "clerk" }, { level: "officer" }]);
    await expect(startButton(page)).toBeEnabled({ timeout: scaled(10_000) });

    await warmRace(page, await lobbyIdOf(code));
    await startButton(page).click();
    await expect(page).toHaveURL(RACE_PATH, { timeout: scaled(15_000) });
    const raceId = RACE_PATH.exec(page.url())![1]!;
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "countdown", {
      timeout: scaled(10_000),
    });
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", {
      timeout: scaled(10_000),
    });
    // both bots' lanes move on the race card within 10 s of GO
    const botLanes = page.locator("[data-race-card] [data-lane]:not([data-you='true'])");
    await expect
      .poll(
        async () =>
          (
            await botLanes.evaluateAll((els) =>
              els.map((el) => Number(el.getAttribute("data-desk-progress") ?? 0)),
            )
          ).filter((p) => p > 0).length,
        { timeout: scaled(10_000) },
      )
      .toBe(2);

    await page.keyboard.type(await stripText(page), { delay: 30 });
    await expect(ended(page)).toBeVisible({ timeout: scaled(75_000) });
    const link = page.getByRole("link", { name: "DAWN REPORT →" });
    await link.click();
    await expect(page).toHaveURL(`/results/${raceId}`);
    const ranking = page.locator("[data-ranking] tbody tr");
    await expect(ranking).toHaveCount(3, { timeout: scaled(15_000) });
    await expect(
      ranking.filter({ has: page.locator('[data-col="name"]', { hasText: "BOT" }) }),
    ).toHaveCount(2);
  });
});
