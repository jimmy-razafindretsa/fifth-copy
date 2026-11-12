import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { scaled } from "../timeouts";
import {
  SEAT_HUD,
  hostRoom,
  joinAsGuest,
  phaseOf,
  recordRaceTokens,
  setHostSettings,
  startButton,
  warmRace,
} from "../race/helpers";

// Contract of #876 C6 over the race server playwright.config.ts starts: the host only watches. The host
// files WATCHES on its HOST row; guests A and B join and see two typists and THE HOST IS WATCHING; the
// host's START runs the race; A and B type the whole 10-word strip (Block mode, untimed) while the host's
// seat view shows both rivals on the race card and no desk to type at. The host's Dawn report offers
// RACE AGAIN (#143 for a host without a desk), back to the waiting room with START enabled and the
// toggle still on WATCHES.

const RACE_PATH = /\/race\/([0-9a-f-]{36})$/;
const input = (page: Page) => page.getByRole("textbox", { name: "Text to type" });
const ended = (page: Page) => page.locator('[data-seat-status] [data-finished="ended"]');
const stripText = async (page: Page) =>
  (await page.locator("[data-telex] [data-state]").allTextContents()).join("");
const roll = (page: Page) => page.getByRole("list", { name: "Typists in the room" });
const hostRow = (page: Page, name: "TYPES" | "WATCHES") =>
  page
    .getByRole("region", { name: "RACE SETTINGS" })
    .getByRole("group", { name: "HOST", exact: true })
    .getByRole("button", { name, exact: true });
const watchingNotice = (page: Page) =>
  page.getByRole("status").filter({ hasText: "THE HOST IS WATCHING" });

test.describe("#876 the host watches", () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project");

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  test("C6 the host watches: A and B race, the host's seat view has no desk, RACE AGAIN keeps WATCHES", async ({
    browser,
  }) => {
    test.setTimeout(scaled(150_000));
    const { host, code, lobbyId } = await hostRoom(browser, opened, { before: recordRaceTokens });
    await setHostSettings(host, { errorMode: "block", wordCount: 10, timerS: null });

    // the host files WATCHES: its row leaves the roll
    await hostRow(host, "WATCHES").click();
    await expect(hostRow(host, "WATCHES")).toHaveAttribute("aria-pressed", "true", {
      timeout: scaled(5_000),
    });
    await expect(roll(host).getByRole("listitem")).toHaveCount(0, { timeout: scaled(5_000) });
    await expect(watchingNotice(host)).toBeVisible();

    // A and B join: two typists and the notice
    const guests: Page[] = [];
    for (let i = 0; i < 2; i++) {
      const { context, page } = await joinAsGuest(browser, code);
      opened.push(context);
      guests.push(page);
    }
    for (const p of [host, ...guests]) {
      await expect(roll(p).getByRole("listitem")).toHaveCount(2, { timeout: scaled(10_000) });
      await expect(watchingNotice(p)).toBeVisible();
    }
    await expect(startButton(host)).toBeEnabled();

    // START: the guests race, the host watches
    await warmRace(host, lobbyId);
    await startButton(host).click();
    for (const p of [host, ...guests])
      await expect(p).toHaveURL(RACE_PATH, { timeout: scaled(10_000) });
    const raceId = RACE_PATH.exec(host.url())![1]!;
    for (const p of guests) expect(RACE_PATH.exec(p.url())![1]).toBe(raceId);

    for (const p of guests) {
      await expect(phaseOf(p)).toHaveAttribute("data-phase", "running", {
        timeout: scaled(10_000),
      });
      await expect(input(p)).toHaveAttribute("data-mode", "block");
    }
    await expect(phaseOf(host)).toHaveAttribute("data-phase", "running", {
      timeout: scaled(10_000),
    });
    // the host's seat view: no desk (SEAT VIEW alone), both rivals on the race card, nothing to type
    await expect(host.getByRole("heading", { level: 1 })).toHaveText(/^SEAT VIEW$/);
    const card = SEAT_HUD.raceCard(host);
    await expect(card.locator("[data-tick]")).toHaveCount(2);
    await expect(card.locator("[data-tick][data-you]")).toHaveCount(0);
    await expect(input(host)).toBeDisabled();
    await expect(host.locator("[data-telex] [data-state]")).toHaveCount(0);

    const texts = await Promise.all(guests.map(stripText));
    for (const text of texts) expect(text.trim().split(/\s+/)).toHaveLength(10);
    await Promise.all(guests.map((p, i) => p.keyboard.type(texts[i]!, { delay: 40 })));
    for (const p of [host, ...guests])
      await expect(ended(p)).toBeVisible({ timeout: scaled(20_000) });

    // the host's Dawn report ranks the two guests and offers RACE AGAIN
    const link = host.getByRole("link", { name: "DAWN REPORT →" });
    await expect(link).toHaveAttribute("href", `/results/${raceId}`);
    await link.click();
    await expect(host).toHaveURL(`/results/${raceId}`);
    await expect(host.locator("[data-ranking] tbody tr")).toHaveCount(2, {
      timeout: scaled(15_000),
    });
    const again = host.getByRole("link", { name: "RACE AGAIN", exact: true });
    await expect(again).toHaveAttribute("href", `/lobby/${code}`);
    await again.click();
    await expect(host).toHaveURL(`/lobby/${code}`);

    // back in the waiting room: the guests' desks wait (#143), START enabled, still WATCHES
    await expect(roll(host).getByRole("listitem")).toHaveCount(2, { timeout: scaled(10_000) });
    await expect(hostRow(host, "WATCHES")).toHaveAttribute("aria-pressed", "true");
    await expect(watchingNotice(host)).toBeVisible();
    await expect(startButton(host)).toBeEnabled();
  });
});
