import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { Client } from "pg";
import { deleteUsers, plantGuest } from "../auth/auth-helpers";
import { openSettings, settingsDocket } from "../identity/settings-helpers";
import { HYDRATION_WAIT } from "../timeouts";

// #968 C2, C3, C6: the DAILY GOAL section of /settings (reference `Profil.dc.html` `OBJECTIF QUOTIDIEN`):
// the name, the value `15 MIN / DAY`, a native range 5 to 60 in fives (44px, named, read as minutes) and
// the hint; moving it files the viewer's own goal, which a reload reads back; axe-clean at 375, 768 and
// 1280 in both themes with no sideways scroll. The attendance register's read is in e2e/profile.

const section = (page: Page) => settingsDocket(page).locator('[data-setting="dailyGoalMin"]');
const range = (page: Page) => section(page).getByRole("slider");

/** The goal on file for the typist `name` (the planted guest), straight from the database. */
async function storedGoals(name: string) {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query<{ dailyGoalMin: number }>(
      `SELECT p."dailyGoalMin" FROM "Preference" p JOIN "User" u ON u.id = p."userId" WHERE u."typistName" = $1`,
      [name],
    );
    return rows;
  } finally {
    await db.end();
  }
}

async function openGoal(page: Page) {
  await openSettings(page);
  await expect(range(page)).toHaveAttribute("data-hydrated", "true", { timeout: HYDRATION_WAIT });
}

test.describe("#968 daily goal on /settings", () => {
  let name = "";
  test.beforeEach(async ({ context }) => {
    name = `Goal-${100 + (randomBytes(2).readUInt16BE() % 900)}`;
    await deleteUsers(name);
    await plantGuest(context, name);
  });
  test.afterEach(async () => {
    await deleteUsers(name);
  });

  test("C2 C3 the block in both languages; moving the range files the goal, a reload reads it", async ({
    page,
    context,
  }) => {
    const url = test.info().project.use.baseURL!;
    await context.addCookies([{ name: "locale", value: "en", url }]);
    await openGoal(page);
    await expect(section(page).getByRole("heading", { level: 2 })).toHaveText("DAILY GOAL");
    await expect(section(page).locator("[data-goal-value]")).toHaveText("15 MIN / DAY");
    await expect(section(page)).toContainText(
      "Used by the attendance register. The Major does not forgive absences, but he notes them politely.",
    );
    const slider = page.getByRole("slider", { name: "DAILY GOAL" });
    await expect(slider).toHaveAttribute("min", "5");
    await expect(slider).toHaveAttribute("max", "60");
    await expect(slider).toHaveAttribute("step", "5");
    await expect(slider).toHaveAttribute("aria-valuetext", "15 minutes a day");
    expect((await slider.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // the keyboard: each arrow step files (FILED), the value reads at once
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(section(page).locator("[data-goal-value]")).toHaveText("20 MIN / DAY");
    await expect(section(page).getByRole("status")).toHaveText("FILED");
    await slider.fill("30");
    await expect(slider).toHaveAttribute("aria-valuetext", "30 minutes a day");
    await expect(section(page).getByRole("status")).toHaveText("FILED");
    expect(await storedGoals(name)).toEqual([{ dailyGoalMin: 30 }]);

    await context.addCookies([{ name: "locale", value: "fr", url }]);
    await openGoal(page);
    await expect(section(page).getByRole("heading", { level: 2 })).toHaveText("OBJECTIF QUOTIDIEN");
    await expect(section(page).locator("[data-goal-value]")).toHaveText("30 MIN / JOUR");
    await expect(page.getByRole("slider", { name: "OBJECTIF QUOTIDIEN" })).toHaveAttribute(
      "aria-valuetext",
      "30 minutes par jour",
    );
    await expect(section(page)).toContainText(
      "Sert au registre de présence. Le Major ne pardonne pas les absences, mais il les note poliment.",
    );
  });

  test("C6 axe-clean at 375, 768 and 1280 in both themes; no sideways scroll", async ({ page }) => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of [375, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await openGoal(page);
        await expect(range(page)).toBeVisible();
        await expectNoA11yViolations(page);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        expect(overflow, `sideways scroll ${scheme} ${width}`).toBe(false);
      }
    }
  });
});
