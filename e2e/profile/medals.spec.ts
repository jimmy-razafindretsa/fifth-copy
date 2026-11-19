import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { Client } from "pg";
import { expect, test } from "../fixtures";
import { type Desk, postResults, seedLobby, startRace, withoutWebGL } from "../results/helpers";
import { HYDRATION_WAIT, scaled } from "../timeouts";

// Contract of #999 C36: the enamel pins on the Personnel file (bible 14.3 "Medals", 7.6, 13). A guest
// with no pin sees the whole catalogue locked under the "none" sentence; a race won without an error,
// filed through the signed internal route, pins "first win" and "100 % accuracy" (both NEW, awarded
// today), an older award reads earned with its day, and the rest stays locked (greyed, dashed, LOCKED).
// Desktop, tablet and phone (the projects), light and Night shift: axe-clean, no sideways scroll.

const medals = (page: Page) => page.locator('[data-section="medals"]');
const pin = (page: Page, id: string) => medals(page).locator(`[data-pin="${id}"]`);

async function openFile(page: Page) {
  await page.goto("/profile");
  await expect(page.locator("[data-profile-state]")).toBeVisible({ timeout: HYDRATION_WAIT });
}

async function axeClean(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page })
    .include('[data-section="medals"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    bad.map((v) => `${v.id}: ${v.nodes.length}`),
    label,
  ).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow, `${label}: sideways scroll`).toBe(false);
}

/** An award filed long ago, straight into the table (an "earned", no longer new, pin). */
async function oldAward(userId: string, achievementId: string, daysAgo: number) {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query(
      `INSERT INTO "Achievement" ("userId", "achievementId", "awardedAt")
       VALUES ($1, $2, now() - make_interval(days => $3))`,
      [userId, achievementId, daysAgo],
    );
  } finally {
    await db.end();
  }
}

test.describe("#999 C36 enamel pins on the Personnel file", () => {
  test.setTimeout(scaled(120_000));

  test.beforeEach(async ({ context, page }) => {
    const url = test.info().project.use.baseURL!;
    await context.addCookies([{ name: "locale", value: "en", url }]);
    await withoutWebGL(page);
  });

  test("none: a fresh guest sees every pin of the catalogue locked", async ({ page }) => {
    await seedLobby(page);
    await openFile(page);
    await expect(medals(page)).toHaveAttribute("data-medals", "none");
    await expect(medals(page).getByRole("heading", { name: "Medals" })).toBeVisible();
    await expect(medals(page).locator("[data-medals-none]")).toHaveText(
      /^No pin on your file yet\./,
    );
    await expect(medals(page).locator("[data-medals-count]")).toHaveText("0 / 5 PINNED");
    const list = medals(page).getByRole("list", { name: "Enamel pins" });
    await expect(list.getByRole("listitem")).toHaveCount(5);
    await expect(list.locator('[data-state="locked"]')).toHaveCount(5);
    await expect(pin(page, "streak-7-days")).toContainText("Seven-Day Shift");
    await expect(pin(page, "streak-7-days")).toContainText("LOCKED");
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await axeClean(page, `none ${scheme}`);
    }
  });

  test("some, new and locked: a clean win pins two NEW pins, an old award reads earned", async ({
    page,
    request,
  }) => {
    const lobby = await seedLobby(page);
    const desks: Desk[] = [
      { desk: 1, name: "Host", place: 1, wpm: 41.5, accuracy: 1, userId: lobby.hostUserId },
      { desk: 2, name: "Typist Bot", place: 2, wpm: 30, isBot: true },
    ];
    await postResults(request, await startRace(request, lobby, desks), desks);
    await oldAward(lobby.hostUserId, "wpm-50-club", 40);
    await openFile(page);

    await expect(medals(page)).toHaveAttribute("data-medals", "some");
    await expect(medals(page).locator("[data-medals-none]")).toHaveCount(0);
    await expect(medals(page).locator("[data-medals-count]")).toHaveText("3 / 5 PINNED");
    await expect(pin(page, "first-win")).toHaveAttribute("data-state", "new");
    await expect(pin(page, "accuracy-100")).toHaveAttribute("data-state", "new");
    await expect(pin(page, "first-win").locator("[data-new]")).toHaveText("NEW");
    await expect(pin(page, "first-win").getByRole("heading")).toHaveText("Order of the First Copy");
    await expect(pin(page, "wpm-50-club")).toHaveAttribute("data-state", "earned");
    await expect(pin(page, "wpm-50-club").locator("[data-new]")).toHaveCount(0);
    await expect(pin(page, "wpm-50-club")).toContainText(/PINNED [A-Z]{3}\.? \d{1,2}, \d{4}/);
    for (const id of ["accent-master", "streak-7-days"]) {
      await expect(pin(page, id)).toHaveAttribute("data-state", "locked");
      await expect(pin(page, id)).toContainText("LOCKED");
    }
    // a locked pin is greyed, an earned one is not
    const filter = (id: string) =>
      pin(page, id)
        .locator("svg")
        .evaluate((el) => getComputedStyle(el).filter);
    expect(await filter("streak-7-days")).toContain("grayscale");
    expect(await filter("first-win")).toBe("none");
    // the section closes a file under three races (the archives come only from three)
    const order = await page
      .locator("[data-profile-state] [data-section]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-section")));
    expect(order.at(-1)).toBe("medals");

    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await axeClean(page, `some ${scheme}`);
    }
  });

  test("French: the pins' names and the canonical VERROUILLÉ / NOUVEAU", async ({
    page,
    context,
    request,
  }) => {
    const lobby = await seedLobby(page);
    const desks: Desk[] = [
      { desk: 1, name: "Host", place: 1, wpm: 41.5, accuracy: 1, userId: lobby.hostUserId },
      { desk: 2, name: "Typist Bot", place: 2, wpm: 30, isBot: true },
    ];
    await postResults(request, await startRace(request, lobby, desks), desks);
    // the lobby is created in English (its helper presses CREATE PRIVATE RACE); the file reads French
    const url = test.info().project.use.baseURL!;
    await context.addCookies([{ name: "locale", value: "fr", url }]);
    await openFile(page);
    await expect(medals(page).getByRole("heading", { name: "Médailles" })).toBeVisible();
    await expect(medals(page).locator("[data-medals-count]")).toHaveText("2 / 5 ÉPINGLÉES");
    await expect(pin(page, "first-win")).toContainText("Ordre de la première copie");
    await expect(pin(page, "first-win").locator("[data-new]")).toHaveText("NOUVEAU");
    await expect(pin(page, "accent-master")).toContainText("VERROUILLÉ");
  });
});
