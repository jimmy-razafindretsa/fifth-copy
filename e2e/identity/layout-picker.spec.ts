import { randomBytes } from "node:crypto";
import { expect, test } from "../fixtures";
import { deleteUsers, plantGuest } from "../auth/auth-helpers";
import { choose, group, openSettings, settingsDocket } from "./settings-helpers";

// #66 C10 and C11: the keyboard layout radio group with its previews, and the theme, language and sound
// controls applying without a full reload.

const LAYOUTS = {
  "CANADIAN FRENCH (CSA)": "CSA",
  "FRENCH CANADA": "FR_CA",
  "US QWERTY": "US_QWERTY",
  AZERTY: "AZERTY",
} as const;

test.describe("#66 layout picker and live controls", () => {
  let name = "";
  test.beforeEach(async ({ context }) => {
    name = `Otter-${100 + (randomBytes(2).readUInt16BE() % 900)}`;
    await deleteUsers(name);
    await plantGuest(context, name);
  });
  test.afterEach(async () => deleteUsers(name));

  test("C10 four layouts with three-row previews; choosing one files it", async ({ page }) => {
    await openSettings(page);
    const radios = group(settingsDocket(page), "KEYBOARD LAYOUT");
    await expect(radios.getByRole("radio")).toHaveCount(4);
    for (const [label, id] of Object.entries(LAYOUTS)) {
      await expect(radios.getByRole("radio", { name: label, exact: true })).not.toBeChecked();
      const preview = radios.locator(`[data-preview="${id}"]`);
      await expect(preview.locator(":scope > span")).toHaveCount(3);
      const accents = preview.locator("[data-accent]");
      if (id === "CSA" || id === "FR_CA") {
        for (const key of ["é", "è", "ç"]) {
          await expect(accents.and(preview.locator(`[data-key="${key}"]`))).toHaveCount(1);
        }
      }
      if (id === "US_QWERTY") await expect(accents).toHaveCount(0);
    }
    await choose(page, "KEYBOARD LAYOUT", "AZERTY");
    await expect(radios.getByRole("radio", { name: "AZERTY" })).toBeChecked();
    await page.reload();
    await expect(
      group(settingsDocket(page), "KEYBOARD LAYOUT").getByRole("radio", { name: "AZERTY" }),
    ).toBeChecked();
  });

  test("C11 theme, language and sound save and apply without a reload", async ({ page }) => {
    await openSettings(page);
    // a full reload would drop this marker
    await page.evaluate(() => ((window as unknown as { __kept: boolean }).__kept = true));
    const html = page.locator("html");

    await choose(page, "THEME", "DARK");
    await expect(html).toHaveAttribute("data-theme", "dark");
    await choose(page, "SOUND", "ON"); // #243: sound starts OFF
    await choose(page, "LANGUAGE", "FRANÇAIS");
    await expect(html).toHaveAttribute("lang", "fr");
    await expect(page.getByRole("heading", { level: 1, name: "RÉGLAGES" })).toBeVisible();
    await expect(
      group(settingsDocket(page), "THÈME").getByRole("radio", { name: "SOMBRE" }),
    ).toBeChecked();
    await choose(page, "THÈME", "SYSTÈME");
    await expect(html).not.toHaveAttribute("data-theme", /.+/);
    expect(await page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept)).toBe(
      true,
    );

    await page.reload();
    await expect(html).toHaveAttribute("lang", "fr");
    const docket = settingsDocket(page);
    await expect(group(docket, "SON").getByRole("radio", { name: "OUI" })).toBeChecked();
    await expect(group(docket, "THÈME").getByRole("radio", { name: "SYSTÈME" })).toBeChecked();
  });
});
