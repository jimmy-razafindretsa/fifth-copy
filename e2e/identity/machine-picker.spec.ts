import { randomBytes } from "node:crypto";
import type { BrowserContext, Page } from "@playwright/test";
import { machineSkinIds } from "../../src/features/race/components/machine/skin";
import { expect, test } from "../fixtures";
import { deleteUsers, plantGuest } from "../auth/auth-helpers";
import { hostRoom, warmRace } from "../race/helpers";
import { group, openSettings, settingsDocket } from "./settings-helpers";

// #638 C2, C3: the MACHINE section of /settings (7.1 segmented toggle, one segment per registered skin,
// over a static specimen of the shown skin) and the seat view drawing the filed skin. Skins come from the
// race feature's registry, so the spec grows with it: with one skin there is nothing to switch to and the
// chosen skin is the default.

const machineGroup = (page: Page) => group(settingsDocket(page), /^(MACHINE)$/);
const specimen = (page: Page) =>
  settingsDocket(page).locator("[data-machine-specimen] [data-machine]");
const radioOf = (page: Page, skin: string) => machineGroup(page).locator(`input[value="${skin}"]`);

/** Files `skin` from the settings screen (a click on its segment, then FILED); a no-op when it is shown. */
async function fileSkin(page: Page, skin: string) {
  await openSettings(page);
  if (await radioOf(page, skin).isChecked()) return;
  await machineGroup(page)
    .locator("label")
    .filter({ has: radioOf(page, skin) })
    .click();
  await expect(radioOf(page, skin)).toBeChecked();
  const section = settingsDocket(page).locator('[data-setting="machineSkin"]');
  await expect(section.getByRole("status")).toHaveText(/^(FILED|CLASSÉ)$/);
}

test.describe("#638 machine skin preference", () => {
  let name = "";
  const opened: BrowserContext[] = [];
  test.beforeEach(async ({ context }) => {
    name = `Heron-${100 + (randomBytes(2).readUInt16BE() % 900)}`;
    await deleteUsers(name);
    await plantGuest(context, name);
  });
  test.afterEach(async () => {
    for (const c of opened.splice(0)) await c.close();
    await deleteUsers(name);
  });

  test("C2 one segment per registered skin over a static specimen; choosing switches it", async ({
    page,
  }) => {
    await openSettings(page);
    await expect(
      settingsDocket(page).getByRole("heading", { level: 2, name: "MACHINE", exact: true }),
    ).toBeVisible();
    const radios = machineGroup(page).getByRole("radio");
    await expect(radios).toHaveCount(machineSkinIds.length);
    await expect(radioOf(page, "teleprinter")).toBeChecked();
    await expect(specimen(page)).toHaveCount(1);
    await expect(specimen(page)).toHaveAttribute("data-skin", "teleprinter");
    // static: no key state on the specimen
    await expect(
      specimen(page).locator("[data-pressed], [data-wrong], [data-disabled]"),
    ).toHaveCount(0);
    await expect(specimen(page)).not.toHaveAttribute("data-jammed", /.*/);

    // hit targets >= 44px
    for (const label of await machineGroup(page).locator("label").all()) {
      const box = (await label.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    // keyboard: focus the checked radio, arrows move and choose (native radio group)
    await radioOf(page, "teleprinter").focus();
    await expect(radioOf(page, "teleprinter")).toBeFocused();

    // a full reload would drop this marker
    await page.evaluate(() => ((window as unknown as { __kept: boolean }).__kept = true));
    for (const skin of machineSkinIds.filter((id) => id !== "teleprinter")) {
      await fileSkin(page, skin);
      await expect(specimen(page)).toHaveAttribute("data-skin", skin);
    }
    expect(await page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept)).toBe(
      true,
    );
  });

  test("C3 the seat view draws the filed skin", async ({ page, browser }) => {
    const chosen = machineSkinIds[machineSkinIds.length - 1]!;
    await fileSkin(page, chosen);
    const room = await hostRoom(browser, opened);
    await warmRace(page, room.lobbyId);
    await page.goto(`/race/${room.lobbyId}`);
    await expect(page.locator(`[data-machine][data-skin="${chosen}"]`)).toHaveCount(1);
  });

  test("C3 a viewer without a preference gets the teleprinter", async ({ browser }) => {
    const room = await hostRoom(browser, opened);
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    opened.push(context);
    const page = await context.newPage();
    await page.goto(`/race/${room.lobbyId}`);
    await expect(page.locator('[data-machine][data-skin="teleprinter"]')).toHaveCount(1);
  });
});
