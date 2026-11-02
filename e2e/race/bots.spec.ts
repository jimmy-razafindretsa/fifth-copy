import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { scaled } from "../timeouts";
import {
  hostRoom,
  phaseOf,
  recordRaceTokens,
  setHostSettings,
  startButton,
  warmRace,
} from "./helpers";

// Contract of #366 C7 over the race server playwright.config.ts starts: bots type on the server. The
// host seats one Clerk bot (`setHostSettings`), Block mode, a 20-word untimed text. START counts the
// bot (host alone + bot = 2 desks). The host types the strip whole and finishes first; the race ends
// only when the bot (35 WPM, real ms: never fast-clocked) finishes too, all-finished. The Dawn report
// ranks two rows, the bot's with the BOT tag and a WPM between 25 and 45.

const RACE_PATH = /\/race\/([0-9a-f-]{36})$/;
const input = (page: Page) => page.getByRole("textbox", { name: "Text to type" });
const ended = (page: Page) => page.locator('[data-seat-status] [data-finished="ended"]');
const stripText = async (page: Page) =>
  (await page.locator("[data-telex] [data-state]").allTextContents()).join("");

test.describe("#366 bots as server race participants", () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project");

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  test("C7: host alone with a Clerk bot races a Block text to the Dawn report", async ({
    browser,
  }) => {
    test.setTimeout(scaled(120_000));
    const { host, lobbyId } = await hostRoom(browser, opened, { before: recordRaceTokens });
    const settings = await setHostSettings(host, {
      errorMode: "block",
      wordCount: 20,
      timerS: null,
      bots: [{ level: "clerk" }],
    });
    expect(settings.bots).toEqual([{ level: "clerk" }]);
    // The lobby's START counts the bot: the host alone with one bot may start.
    await expect(host.getByRole("list", { name: "Typists in the room" }).getByRole("listitem"))
      .toHaveCount(2, { timeout: scaled(10_000) });
    await expect(startButton(host)).toBeEnabled({ timeout: scaled(10_000) });

    await warmRace(host, lobbyId);
    await startButton(host).click();
    await expect(host).toHaveURL(RACE_PATH);
    const raceId = RACE_PATH.exec(host.url())![1]!;
    await expect(phaseOf(host)).toHaveAttribute("data-phase", "running", {
      timeout: scaled(10_000),
    });
    await expect(input(host)).toHaveAttribute("data-mode", "block");
    const text = await stripText(host);
    expect(text.trim().split(/\s+/)).toHaveLength(20);
    // Fast and exact: the host finishes well before a 35 WPM bot.
    await host.keyboard.type(text, { delay: 30 });
    // The race goes on until the bot finishes too (all-finished): about 20-40 s of real time.
    await expect(ended(host)).toBeVisible({ timeout: scaled(75_000) });

    const link = host.getByRole("link", { name: "DAWN REPORT →" });
    await expect(link).toHaveAttribute("href", `/results/${raceId}`);
    await link.click();
    await expect(host).toHaveURL(`/results/${raceId}`);
    const rows = host.locator("[data-ranking] tbody tr");
    await expect(rows).toHaveCount(2, { timeout: scaled(15_000) });
    const bot = rows.filter({ has: host.locator('[data-col="name"]', { hasText: "BOT" }) });
    await expect(bot).toHaveCount(1);
    await expect(bot).toHaveAttribute("data-status", /finished/i);
    await expect(bot).toHaveAttribute("data-place", "02");
    const wpm = Number((await bot.locator('[data-col="wpm"]').textContent())!.trim());
    expect(wpm).toBeGreaterThanOrEqual(25);
    expect(wpm).toBeLessThanOrEqual(45);
    await expect(rows.filter({ hasNot: host.locator('[data-col="name"]', { hasText: "BOT" }) }))
      .toHaveAttribute("data-place", "01");
  });
});
