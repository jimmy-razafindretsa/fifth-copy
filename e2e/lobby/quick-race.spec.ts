import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import {
  LOBBY_PATH,
  closeOpenPublicLobbies,
  lobbyIdOf,
  phaseOf,
  recordRaceTokens,
  setHostSettings,
  startButton,
  warmRace,
} from "../race/helpers";
import { ACTION_WAIT, HYDRATION_WAIT, scaled } from "../timeouts";

// Contract of #128 C5 and C6 over the race server playwright.config.ts starts. QUICK RACE seats a
// visitor in any open public room, so these tests carry @matchmaking: they run in the `matchmaking`
// project, alone and in order, after the viewport projects; each starts with no open public room.
// Owner decision 2026-11-04: a new room seats 3 to 5 bots (random), so the bot count is read, not fixed.

const RACE_PATH = /\/race\/([0-9a-f-]{36})$/;
const roll = (page: Page) => page.getByRole("list", { name: "Typists in the room" });
const rows = (page: Page) => roll(page).getByRole("listitem");
const botRows = (page: Page) => rows(page).filter({ has: page.getByText("BOT", { exact: true }) });
const humanRows = (page: Page) =>
  rows(page).filter({ hasNot: page.getByText("BOT", { exact: true }) });
const typists = (page: Page) => page.locator("dt", { hasText: "TYPISTS" }).locator("+ dd");
const kicker = (page: Page) =>
  page.locator('section[aria-labelledby="lobby-heading"] > div').first();
const stripText = async (page: Page) =>
  (await page.locator("[data-telex] [data-state]").allTextContents()).join("");
const ended = (page: Page) => page.locator('[data-seat-status] [data-finished="ended"]');

/** A visitor on the hydrated landing presses the hero's QUICK RACE; returns the room code it lands in. */
async function quickRace(page: Page): Promise<string> {
  await page.goto("/");
  await expect(page.locator("section#play video[aria-hidden='true']")).toHaveAttribute(
    "data-feed",
    /^(armed|near)$/,
    { timeout: HYDRATION_WAIT },
  );
  const play = page.locator("section#play");
  // the bots fallback stays beside it (C4, R64)
  await expect(play.getByRole("button", { name: "PRACTISE VS BOTS", exact: true })).toBeVisible();
  await play.getByRole("button", { name: "QUICK RACE", exact: true }).click();
  await page.waitForURL((url) => LOBBY_PATH.test(url.pathname), { timeout: ACTION_WAIT });
  return LOBBY_PATH.exec(new URL(page.url()).pathname)![1]!;
}

test.describe("#128 quick race matchmaking @matchmaking", () => {
  test.describe.configure({ mode: "serial" });

  const opened: BrowserContext[] = [];
  test.beforeEach(async () => {
    test.slow();
    await closeOpenPublicLobbies();
  });
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  test("C5 A opens a public room as HOST with its bots; B's QUICK RACE lands in the same room", async ({
    page,
    browser,
  }) => {
    const code = await quickRace(page);
    await expect(rows(page).first()).toBeVisible({ timeout: ACTION_WAIT });
    await expect(humanRows(page)).toHaveCount(1, { timeout: ACTION_WAIT });
    await expect(humanRows(page).first().getByText("HOST", { exact: true })).toBeVisible();
    await expect(humanRows(page).first().getByText("YOU", { exact: true })).toBeVisible();
    await expect(kicker(page)).toHaveText("WAITING ROOM · PUBLIC RACE");
    await expect
      .poll(() => botRows(page).count(), { timeout: ACTION_WAIT })
      .toBeGreaterThanOrEqual(3);
    const bots = await botRows(page).count();
    expect(bots).toBeLessThanOrEqual(5);
    await expect(typists(page)).toHaveText(`${1 + bots} / 30`);

    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    opened.push(context);
    const b = await context.newPage();
    expect(await quickRace(b)).toBe(code);

    for (const p of [page, b]) {
      await expect(humanRows(p)).toHaveCount(2, { timeout: scaled(2_000) });
      await expect(botRows(p)).toHaveCount(bots, { timeout: scaled(2_000) });
      await expect(typists(p)).toHaveText(`${2 + bots} / 30`, { timeout: scaled(2_000) });
    }
    await expect(kicker(b)).toHaveText("WAITING ROOM · PUBLIC RACE");
    await expect(humanRows(b).filter({ hasText: "HOST" })).toHaveCount(1);
  });

  test("C6 R212 a fresh guest: QUICK RACE, START against the bots, type to the end, Dawn report row", async ({
    page,
  }) => {
    test.setTimeout(scaled(180_000));
    await recordRaceTokens(page);
    const code = await quickRace(page);
    await expect(humanRows(page)).toHaveCount(1, { timeout: ACTION_WAIT });
    await expect
      .poll(() => botRows(page).count(), { timeout: ACTION_WAIT })
      .toBeGreaterThanOrEqual(3);
    // A short text, so the 20 to 50 WPM bots finish in seconds (the bots stay QUICK RACE's fill).
    await setHostSettings(page, { wordCount: 10, timerS: null });
    // bots count toward the two desks START needs
    await expect(startButton(page)).toBeEnabled({ timeout: ACTION_WAIT });

    await warmRace(page, await lobbyIdOf(code));
    await startButton(page).click();
    await expect(page).toHaveURL(RACE_PATH, { timeout: scaled(15_000) });
    const raceId = RACE_PATH.exec(page.url())![1]!;
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", {
      timeout: scaled(20_000),
    });

    await page.keyboard.type(await stripText(page), { delay: 30 });
    await expect(ended(page)).toBeVisible({ timeout: scaled(90_000) });
    await page.getByRole("link", { name: "DAWN REPORT →" }).click();
    await expect(page).toHaveURL(`/results/${raceId}`);

    const ranking = page.locator("[data-ranking]");
    await expect(ranking.locator("caption")).toHaveText("FORM 5-R · RANKING", {
      timeout: scaled(15_000),
    });
    const mine = ranking.locator('tbody tr[data-you="true"]');
    await expect(mine).toHaveCount(1, { timeout: scaled(15_000) });
    await expect(mine.locator('[data-col="place"]')).toHaveText(/^\d+$/);
    await expect(mine.locator('[data-col="wpm"]')).toHaveText(/^\d+$/);
    await expect(mine.locator('[data-col="accuracy"]')).toHaveText(/^\d+(\.\d+)? %$/);
  });
});
