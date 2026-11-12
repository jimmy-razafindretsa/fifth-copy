import { randomBytes } from "node:crypto";
import { expect, test } from "../fixtures";
import { ACTION_WAIT } from "../timeouts";
import {
  PASSWORD,
  authForm,
  deleteUsers,
  fill,
  openForm,
  plantGuest,
  seedAccount,
} from "../auth/auth-helpers";
import { group, openSettings, settingsDocket } from "./settings-helpers";

// #66 C6 and C7: the settings screen's sections for a guest and an account, and its /design states.

const SECTIONS = ["KEYBOARD LAYOUT", "THEME", "LANGUAGE", "SOUND", "ACCOUNT"];

test.describe("#66 settings screen", () => {
  test("C6 a guest reads the five sections and the way to an account", async ({
    page,
    context,
  }) => {
    const name = `Heron-${100 + (randomBytes(2).readUInt16BE() % 900)}`;
    await deleteUsers(name);
    await plantGuest(context, name);
    await openSettings(page);
    await expect(page.getByRole("heading", { level: 1, name: "SETTINGS" })).toBeVisible();
    const docket = settingsDocket(page);
    for (const section of SECTIONS) {
      await expect(docket.getByRole("heading", { level: 2, name: section })).toBeVisible();
    }
    for (const option of ["LIGHT", "DARK", "SYSTEM"]) {
      await expect(group(docket, "THEME").getByRole("radio", { name: option })).toBeVisible();
    }
    for (const option of ["ENGLISH", "FRANÇAIS"]) {
      await expect(group(docket, "LANGUAGE").getByRole("radio", { name: option })).toBeVisible();
    }
    for (const option of ["ON", "OFF"]) {
      await expect(group(docket, "SOUND").getByRole("radio", { name: option })).toBeVisible();
    }
    const account = docket.getByRole("region", { name: "ACCOUNT" });
    await expect(account).toContainText(`Comrade ${name}`);
    await expect(account).toContainText("GUEST");
    await expect(account).toContainText("Create an account to keep your file");
    await expect(account.getByRole("link", { name: "OPEN A FILE →" })).toHaveAttribute(
      "href",
      "/sign-up",
    );
    await deleteUsers(name);
  });

  test("C6 an account reads its username and the picture and data entries", async ({
    page,
  }, info) => {
    const username = `set_${randomBytes(3).toString("hex")}${info.project.name[0]}`;
    await deleteUsers(username);
    await seedAccount(username, PASSWORD);
    await openForm(page, "/sign-in?callbackUrl=%2Fsettings");
    await fill(page, username, PASSWORD);
    await authForm(page).getByRole("button", { name: "SIGN IN", exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/, { timeout: ACTION_WAIT });
    await openSettings(page);
    const account = settingsDocket(page).getByRole("region", { name: "ACCOUNT" });
    await expect(account).toContainText("USERNAME");
    await expect(account).toContainText(username);
    await expect(account).not.toContainText("GUEST");
    // #60 wires the picture entry: it now opens the picture dialog (e2e/identity/avatar-crop.spec.ts).
    await expect(account.getByRole("button", { name: "CHANGE PICTURE" })).toBeEnabled();
    await expect(account.getByRole("button", { name: "DELETE MY DATA" })).toBeDisabled();
    await deleteUsers(username);
  });

  test("C7 /design shows the guest, account, pending, saved and error states", async ({ page }) => {
    await page.goto("/design#settings");
    const state = (id: string) => page.locator(`[data-settings-state="${id}"]`);
    await expect(state("guest")).toContainText("Create an account to keep your file");
    await expect(state("account").getByRole("button", { name: "DELETE MY DATA" })).toBeDisabled();
    const pending = state("pending").getByRole("region", { name: "KEYBOARD LAYOUT" });
    await expect(pending.getByRole("status")).toHaveText("FILING…");
    await expect(pending.getByRole("radiogroup")).toHaveAttribute("aria-busy", "true");
    const saved = state("saved").getByRole("region", { name: "SOUND" });
    await expect(saved.getByRole("status")).toHaveText("FILED");
    const error = state("error").getByRole("region", { name: "LANGUAGE" });
    await expect(error.getByRole("alert")).toContainText("RETURNED ·");
    await expect(error.getByRole("radiogroup")).toHaveAttribute(
      "aria-describedby",
      (await error.getByRole("alert").getAttribute("id"))!,
    );
  });
});
