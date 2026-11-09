import { randomBytes } from "node:crypto";
import { expect, test } from "../fixtures";
import { createLobby } from "../race/helpers";
import { ACTION_WAIT, HYDRATION_WAIT } from "../timeouts";
import {
  PASSWORD,
  authForm,
  deleteUsers,
  fill,
  openForm,
  plantGuest,
  seedAccount,
} from "../auth/auth-helpers";
import { choose, group, headerTypist, openSettings, settingsDocket } from "./settings-helpers";

// #66 C14 and C15: preferences persist for a guest (same typist identity) and follow an account to
// another browser.

test.describe("#66 preferences end to end", () => {
  test("C14 a guest's layout, theme and language come back; a new visitor reads defaults", async ({
    page,
    browser,
  }) => {
    // a fresh visitor gets their guest identity on the landing's first race (ADR 0009)
    await createLobby(page);
    await openSettings(page);
    const typist = await headerTypist(page);

    await choose(page, "KEYBOARD LAYOUT", "AZERTY");
    await choose(page, "THEME", "DARK");
    await choose(page, "LANGUAGE", "FRANÇAIS");

    await page.reload();
    const docket = settingsDocket(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(
      group(docket, "DISPOSITION DU CLAVIER").getByRole("radio", { name: "AZERTY" }),
    ).toBeChecked();
    await expect(group(docket, "THÈME").getByRole("radio", { name: "SOMBRE" })).toBeChecked();
    await expect(group(docket, "LANGUE").getByRole("radio", { name: "FRANÇAIS" })).toBeChecked();
    expect(await headerTypist(page)).toBe(typist);

    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const name = `Crow-${100 + (randomBytes(2).readUInt16BE() % 900)}`;
    await deleteUsers(name);
    await plantGuest(other, name);
    const fresh = await other.newPage();
    await openSettings(fresh);
    const defaults = settingsDocket(fresh);
    await expect(
      group(defaults, "KEYBOARD LAYOUT").getByRole("radio", { checked: true }),
    ).toHaveCount(0);
    await expect(group(defaults, "THEME").getByRole("radio", { name: "SYSTEM" })).toBeChecked();
    await expect(group(defaults, "LANGUAGE").getByRole("radio", { name: "ENGLISH" })).toBeChecked();
    await expect(group(defaults, "SOUND").getByRole("radio", { name: "ON" })).toBeChecked();
    await other.close();
    await deleteUsers(name);
  });

  test("C14 the first save of a visitor whose guest no longer resolves files a new guest", async ({
    page,
    context,
  }) => {
    const url = test.info().project.use.baseURL!;
    await context.addCookies([{ name: "fc_guest", value: "gone.AAAA", url }]);
    await openSettings(page);
    await expect(page.getByRole("banner").getByRole("link", { name: "SIGN IN" })).toBeVisible();
    await choose(page, "KEYBOARD LAYOUT", "US QWERTY");
    await expect(page.getByRole("banner")).toContainText(/Comrade \S+-\d{3,4}/, {
      timeout: ACTION_WAIT,
    });
    const typist = await headerTypist(page);
    await page.reload();
    expect(await headerTypist(page)).toBe(typist);
    await expect(
      group(settingsDocket(page), "KEYBOARD LAYOUT").getByRole("radio", { name: "US QWERTY" }),
    ).toBeChecked();
    await deleteUsers(typist);
  });

  test("C15 an account's preferences appear in a second browser after sign-in", async ({
    page,
    browser,
  }, info) => {
    const username = `prf_${randomBytes(3).toString("hex")}${info.project.name[0]}`;
    await deleteUsers(username);
    await seedAccount(username, PASSWORD);
    const signIn = async (p: typeof page) => {
      await openForm(p, "/sign-in?callbackUrl=%2Fsettings");
      await fill(p, username, PASSWORD);
      await authForm(p).getByRole("button", { name: "SIGN IN", exact: true }).click();
      await expect(p).toHaveURL(/\/settings$/, { timeout: ACTION_WAIT });
    };

    await signIn(page);
    await openSettings(page);
    await choose(page, "KEYBOARD LAYOUT", "CANADIAN FRENCH (CSA)");
    await choose(page, "THEME", "DARK");
    await choose(page, "SOUND", "OFF");

    const second = await browser.newContext({ baseURL: info.project.use.baseURL });
    const other = await second.newPage();
    await signIn(other);
    await openSettings(other);
    const docket = settingsDocket(other);
    await expect(
      group(docket, "KEYBOARD LAYOUT").getByRole("radio", { name: "CANADIAN FRENCH (CSA)" }),
    ).toBeChecked({ timeout: HYDRATION_WAIT });
    await expect(group(docket, "THEME").getByRole("radio", { name: "DARK" })).toBeChecked();
    await expect(group(docket, "SOUND").getByRole("radio", { name: "OFF" })).toBeChecked();
    // the sign-in refreshed this browser's theme cookie from the account (database wins)
    await expect(other.locator("html")).toHaveAttribute("data-theme", "dark");
    await second.close();
    await deleteUsers(username);
  });
});
