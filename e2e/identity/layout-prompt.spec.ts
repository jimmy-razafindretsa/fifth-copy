import type { BrowserContext, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { HYDRATION_WAIT } from "../timeouts";

// #70 C1, C2: the first-race keyboard prompt on a lobby page. Tagged @layout-prompt: every other spec
// keeps it snoozed (e2e/fixtures.ts).

const LOBBY_PATH = /^\/lobby\/[A-HJ-NP-Z]{3}-[0-9]{4}$/;
const TITLE = "WHICH KEYBOARD IS ON YOUR DESK?";

const prompt = (page: Page) => page.getByRole("dialog", { name: TITLE });

/** A fresh guest creates a private race and lands in its lobby (no layout on file yet). */
async function openLobby(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: "CREATE PRIVATE RACE", exact: true }).click();
  await page.waitForURL((url) => LOBBY_PATH.test(url.pathname));
  return new URL(page.url()).pathname;
}

/** The same guest (cookies) in a new browser session (fresh sessionStorage). */
async function newSession(context: BrowserContext, page: Page): Promise<Page> {
  const state = await context.storageState();
  const next = await page
    .context()
    .browser()!
    .newContext({ baseURL: test.info().project.use.baseURL, storageState: { cookies: state.cookies, origins: [] } });
  return next.newPage();
}

test.describe("#70 first-race keyboard layout prompt", { tag: "@layout-prompt" }, () => {
  test("C1 choosing a layout files it and the prompt never reopens", async ({ page }) => {
    const lobby = await openLobby(page);
    const dialog = prompt(page);
    await expect(dialog).toBeVisible({ timeout: HYDRATION_WAIT });
    await expect(dialog.getByRole("radio")).toHaveCount(4);
    await dialog.locator("label").filter({ hasText: "AZERTY" }).click();
    await expect(dialog).toBeHidden();

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);

    // filed: settings reads it back
    await page.goto("/settings");
    await expect(page.getByRole("radio", { name: "AZERTY", exact: true })).toBeChecked();
    await page.goto(lobby);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);
  });

  test("C1 ask me later closes it for the session; a new session asks again", async ({
    page,
    context,
  }) => {
    const lobby = await openLobby(page);
    const dialog = prompt(page);
    await expect(dialog).toBeVisible({ timeout: HYDRATION_WAIT });
    await dialog.getByRole("button", { name: "ASK ME LATER" }).click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => sessionStorage.getItem("fc_layout_prompt"))).toBe("later");

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(prompt(page)).toBeHidden();

    const again = await newSession(context, page);
    try {
      await again.goto(lobby);
      await expect(prompt(again)).toBeVisible({ timeout: HYDRATION_WAIT });
    } finally {
      await again.context().close();
    }
  });

  test("C2 labelled, focus kept inside, Escape is ask me later, focus back on the page", async ({
    page,
  }) => {
    await openLobby(page);
    const dialog = prompt(page);
    await expect(dialog).toBeVisible({ timeout: HYDRATION_WAIT });
    await expect(dialog).toHaveAttribute("aria-describedby", /.+/);
    await expectNoA11yViolations(page);

    const inside = () =>
      page.evaluate(() => !!document.activeElement?.closest('dialog[data-dialog="layout"]'));
    expect(await inside()).toBe(true);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await inside(), `Tab ${i + 1}`).toBe(true);
    }
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await inside(), `Shift+Tab ${i + 1}`).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => sessionStorage.getItem("fc_layout_prompt"))).toBe("later");
    expect(await inside()).toBe(false);
    // the page is live again: the keyboard reaches the header
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => !!document.activeElement?.closest("header, main")),
    ).toBe(true);
  });
});
