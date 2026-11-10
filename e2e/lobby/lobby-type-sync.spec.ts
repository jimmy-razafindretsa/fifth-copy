import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { LOBBY_PATH, closeOpenPublicLobbies, createLobby, joinAsGuest } from "../race/helpers";
import { ACTION_WAIT, HYDRATION_WAIT, scaled } from "../timeouts";

// Contract of #815 C7 over the race server playwright.config.ts starts: the host's LOBBY toggle
// (`setLobbyType`) reaches the room through `POST /internal/rooms/type`; the room broadcasts its
// settings and reviews the automatic start (#814): PRIVATE drops STARTS IN, PUBLIC arms it. Public
// rooms, so @matchmaking (desktop, alone, in order).

const COUNTING = /^STARTS IN (\d+) S$/;
const status = (page: Page) => page.locator("dt", { hasText: /^STATUS$/ }).locator("+ dd");
const notice = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const settingsDocket = (page: Page) => page.getByRole("region", { name: "RACE SETTINGS" });
const segment = (page: Page, row: string, name: string) =>
  settingsDocket(page)
    .getByRole("group", { name: row, exact: true })
    .getByRole("button", { name, exact: true });

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

/** The host files PUBLIC or PRIVATE and the toggle settles on it (the action answered ok). */
async function fileLobbyType(page: Page, type: "PUBLIC" | "PRIVATE") {
  await segment(page, "LOBBY", type).click();
  await expect(segment(page, "LOBBY", type)).toHaveAttribute("aria-pressed", "true", {
    timeout: scaled(5_000),
  });
}

test.describe("#815 lobby visibility reaches the race server @matchmaking", () => {
  test.describe.configure({ mode: "serial" });

  const opened: BrowserContext[] = [];
  test.beforeEach(async () => {
    test.slow();
    await closeOpenPublicLobbies();
  });
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  test("C7a a quick-race room filed PRIVATE stops counting on both pages; PUBLIC again counts down", async ({
    page,
    browser,
  }) => {
    const code = await quickRace(page);
    await expect(status(page)).toHaveText(COUNTING, { timeout: scaled(10_000) });
    const b = await joinAsGuest(browser, code);
    opened.push(b.context);
    await expect(status(b.page)).toHaveText(COUNTING, { timeout: scaled(5_000) });

    await segment(page, "LOBBY", "PRIVATE").click();
    for (const p of [page, b.page])
      await expect(status(p)).toHaveText("WAITING", { timeout: scaled(2_000) });
    await expect(notice(b.page, "WAITING FOR THE HOST")).toBeVisible({ timeout: scaled(2_000) });
    await expect(notice(b.page, "AUTOMATIC START")).toHaveCount(0);
    await expect(segment(page, "LOBBY", "PRIVATE")).toHaveAttribute("aria-pressed", "true");

    await segment(page, "LOBBY", "PUBLIC").click();
    for (const p of [page, b.page])
      await expect(status(p)).toHaveText(COUNTING, { timeout: scaled(2_000) });
    await expect(notice(b.page, "AUTOMATIC START")).toBeVisible();
  });

  test("C7b a private room with one bot filed PUBLIC shows STARTS IN on the host's page", async ({
    page,
  }) => {
    await createLobby(page);
    await settingsDocket(page).getByRole("button", { name: "ADD A BOT", exact: true }).click();
    await expect(settingsDocket(page).locator('[data-setting^="bots."]')).toHaveCount(1, {
      timeout: scaled(2_000),
    });
    await expect(status(page)).toHaveText("WAITING");

    await segment(page, "LOBBY", "PUBLIC").click();
    await expect(status(page)).toHaveText(COUNTING, { timeout: scaled(2_000) });
    await fileLobbyType(page, "PUBLIC");
  });
});
