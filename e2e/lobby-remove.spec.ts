import type { BrowserContext, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "./fixtures";
import {
  hostRoom,
  joinAsGuest,
  recordRaceTokens,
  setHostSettings,
  startButton,
} from "./race/helpers";
import { ACTION_WAIT, scaled } from "./timeouts";

// Contract of #133 C4, C5, C6, C7: the host removes a typist from the waiting room. The host plus two
// guests in fresh contexts, a bot seated through the host's settings; the race server started by
// playwright.config.ts. A private room (no @matchmaking).

const list = (page: Page) => page.getByRole("list", { name: "Typists in the room" });
const roll = (page: Page) => list(page).locator("li");
// the roll's own: the settings docket's bot rows carry `REMOVE BOT 1` (#114)
const removeButtons = (page: Page) =>
  list(page).getByRole("button", { name: /^(REMOVE|CONFIRM · REMOVE) / });
const removedDocket = (page: Page) => page.getByRole("region", { name: "REMOVED", exact: true });

/** The viewer's own name: the roll row that carries the YOU tag. */
async function ownName(page: Page): Promise<string> {
  const row = roll(page).filter({ has: page.getByText("YOU", { exact: true }) });
  return ((await row.locator("span").nth(2).textContent()) ?? "").trim();
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "sideways scroll").toBeLessThanOrEqual(0);
}

async function a11yBothThemes(page: Page) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expectNoA11yViolations(page);
    await noSidewaysScroll(page);
  }
  await page.emulateMedia({ colorScheme: null });
}

test.describe("remove a typist (#133)", () => {
  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  test("C6 the host removes B: B gets the docket within 2 s, the rolls drop B, a reload keeps it; A has no control; START stays enabled with a bot", async ({
    browser,
  }) => {
    test.setTimeout(scaled(120_000));
    const { host, code } = await hostRoom(browser, opened, { before: recordRaceTokens });
    const a = await joinAsGuest(browser, code);
    opened.push(a.context);
    const b = await joinAsGuest(browser, code);
    opened.push(b.context);
    for (const page of [host, a.page, b.page]) {
      await expect(roll(page)).toHaveCount(3, { timeout: ACTION_WAIT });
    }
    await setHostSettings(host, { bots: [{ level: "clerk" }] });
    for (const page of [host, a.page, b.page]) {
      await expect(roll(page)).toHaveCount(4, { timeout: ACTION_WAIT });
    }

    const nameA = await ownName(a.page);
    const nameB = await ownName(b.page);
    // C4: one REMOVE per human non-host row on the host's roll; none for a guest
    await expect(removeButtons(host)).toHaveCount(2);
    await expect(
      list(host).getByRole("button", { name: `REMOVE ${nameA}`, exact: true }),
    ).toBeVisible();
    await expect(removeButtons(a.page)).toHaveCount(0);
    await expect(removeButtons(b.page)).toHaveCount(0);

    // 44px on touch widths
    const remove = list(host).getByRole("button", { name: `REMOVE ${nameB}`, exact: true });
    const width = host.viewportSize()?.width ?? 0;
    if (width <= 768) {
      const box = await remove.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await a11yBothThemes(host);

    // the first press confirms in place (the focus stays on the button), the second removes
    await remove.click();
    const confirm = list(host).getByRole("button", {
      name: `CONFIRM · REMOVE ${nameB}`,
      exact: true,
    });
    await expect(confirm).toHaveText("CONFIRM");
    await expect(confirm).toBeFocused();
    await expect(host.getByRole("dialog")).toHaveCount(0);
    await confirm.click();

    await expect(removedDocket(b.page)).toBeVisible({ timeout: scaled(2_000) });
    for (const page of [host, a.page]) {
      await expect(roll(page)).toHaveCount(3, { timeout: scaled(2_000) });
      await expect(roll(page).filter({ hasText: nameB })).toHaveCount(0);
    }
    await expect(b.page.getByText("The host removed you from this room's roll.")).toBeVisible();
    const back = b.page.getByRole("link", { name: "BACK TO THE FRONT DESK →", exact: true });
    await expect(back).toHaveAttribute("href", "/");
    await expect(roll(b.page)).toHaveCount(0);
    await a11yBothThemes(b.page);

    // the host and A with the bot: START stays enabled
    await expect(removeButtons(host)).toHaveCount(1);
    await expect(startButton(host)).toBeEnabled();

    // B reloads: refused `removed` at the handshake, the docket again
    await b.page.reload();
    await expect(removedDocket(b.page)).toBeVisible({ timeout: ACTION_WAIT });
    await expect(roll(b.page)).toHaveCount(0);
    await expect(roll(host)).toHaveCount(3);
  });
});
