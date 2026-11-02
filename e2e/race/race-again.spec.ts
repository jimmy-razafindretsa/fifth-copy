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

// Contract of #143 C4 and C5 over the race server playwright.config.ts starts: Race again. Host and one
// guest, Block mode and a 10-word text (`setHostSettings`), untimed: both type the whole strip, so the
// race ends all-finished. Both open the Dawn report, press RACE AGAIN and land in the waiting room of the
// same lobby with both rows (the ended room waited for them, #143). The host's START runs race 2 with a
// new race id and race 1's settings (10 words, Block mode); its Dawn report ranks both.

const RACE_PATH = /\/race\/([0-9a-f-]{36})$/;
const input = (page: Page) => page.getByRole("textbox", { name: "Text to type" });
const ended = (page: Page) => page.locator('[data-seat-status] [data-finished="ended"]');
const stripText = async (page: Page) =>
  (await page.locator("[data-telex] [data-state]").allTextContents()).join("");
const words = (text: string) => text.trim().split(/\s+/).length;

test.describe("#143 Race again", () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project");

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  /** Both pages at GO of one race: 10 words, Block mode; both type it whole and reach RACE OVER. */
  async function raceOnce(pages: Page[]) {
    for (const p of pages) {
      await expect(phaseOf(p)).toHaveAttribute("data-phase", "running", {
        timeout: scaled(10_000),
      });
      await expect(input(p)).toHaveAttribute("data-mode", "block");
    }
    const texts = await Promise.all(pages.map(stripText));
    for (const text of texts) expect(words(text)).toBe(10);
    await Promise.all(pages.map((p, i) => p.keyboard.type(texts[i]!, { delay: 40 })));
    for (const p of pages) await expect(ended(p)).toBeVisible({ timeout: scaled(20_000) });
  }

  /** Opens the Dawn report of `raceId` from the RACE OVER docket and waits for both ranked rows. */
  async function dawnReport(page: Page, raceId: string) {
    const link = page.getByRole("link", { name: "DAWN REPORT →" });
    await expect(link).toHaveAttribute("href", `/results/${raceId}`);
    await link.click();
    await expect(page).toHaveURL(`/results/${raceId}`);
    await expect(page.locator("[data-ranking] tbody tr")).toHaveCount(2, {
      timeout: scaled(15_000),
    });
  }

  test("C4 C5: both race, read the Dawn report, RACE AGAIN, and the host starts race 2", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(120_000));
    const room = await hostRoom(browser, opened, { before: recordRaceTokens });
    const { host, code, lobbyId } = room;
    await setHostSettings(host, { errorMode: "block", wordCount: 10, timerS: null });
    await page.goto(`/race/${lobbyId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^SEAT VIEW · DESK \d{2}$/);
    await expect(startButton(host)).toBeEnabled();

    // race 1
    await warmRace(host, lobbyId);
    await startButton(host).click();
    await expect(host).toHaveURL(RACE_PATH);
    const raceId1 = RACE_PATH.exec(host.url())![1]!;
    await raceOnce([host, page]);
    for (const p of [host, page]) await dawnReport(p, raceId1);

    // C4: RACE AGAIN, the 7.1 stamp, back to the waiting room of the same lobby
    for (const p of [host, page]) {
      const again = p.getByRole("link", { name: "RACE AGAIN", exact: true });
      await expect(again).toHaveAttribute("href", `/lobby/${code}`);
      expect((await again.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await again.click();
      await expect(p).toHaveURL(`/lobby/${code}`);
    }
    for (const p of [host, page]) {
      await expect(
        p.getByRole("list", { name: "Typists in the room" }).getByRole("listitem"),
      ).toHaveCount(2, { timeout: scaled(10_000) });
    }
    await expect(startButton(host)).toBeEnabled();

    // C5: race 2 in the same room, new race id, race 1's settings
    await startButton(host).click();
    for (const p of [host, page]) await expect(p).toHaveURL(RACE_PATH, { timeout: scaled(10_000) });
    const raceId2 = RACE_PATH.exec(host.url())![1]!;
    expect(raceId2).not.toBe(raceId1);
    expect(RACE_PATH.exec(page.url())![1]).toBe(raceId2);
    await raceOnce([host, page]);
    await dawnReport(host, raceId2);
  });
});
