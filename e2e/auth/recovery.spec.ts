import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { ACTION_WAIT, HYDRATION_WAIT } from "../timeouts";
import { LANDING, expect, expectNoA11yViolations, test } from "../fixtures";
import {
  PASSWORD,
  SESSION_COOKIE,
  authForm,
  deleteUsers,
  fill,
  freshUsername,
  header,
  openForm,
  sessionCookie,
  signOutButton,
  signUpThroughForm,
} from "./auth-helpers";

// #46 C2, C5: the one-time recovery code revealed once after sign-up, then redeemed on /recover: the
// new password signs in, the old one and a session captured before recovery do not.

const PREFIX = `rv_${Date.now().toString(36)}`;
const NEW_PASSWORD = `new-${randomBytes(6).toString("hex")}`;

const words = (page: Page) => page.locator("[data-recovery-words] li");

async function readWords(page: Page): Promise<string[]> {
  const items = page.locator("[data-recovery-words] li span:last-child");
  await expect(items).toHaveCount(10);
  return items.allTextContents();
}

test.describe("one-time recovery code (#46)", () => {
  test.afterAll(async () => deleteUsers(PREFIX));

  test("C2 + C5 reveal once, sign out, recover, sign in with the new password", async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(test.info().timeout * 2);
    const username = freshUsername(PREFIX).slice(0, 20);

    // C2: the reveal right after sign-up
    await signUpThroughForm(page, username, PASSWORD);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("RECOVERY CODE");
    await expect(main.getByText("LOST CODE, LOST FILE")).toBeVisible();
    await expect(main.locator('[lang="fr"]')).toContainText("ton dossier est perdu");
    const code = await readWords(page);
    await expect(main.getByRole("list", { name: "Your recovery code, 10 words" })).toBeVisible();
    await expect(main.getByRole("button", { name: "COPY" })).toBeVisible();
    const proceed = main.getByRole("button", { name: "CONTINUE →" });
    await expect(proceed).toBeDisabled();
    await expectNoA11yViolations(page);
    const ack = main.getByRole("checkbox", { name: "I wrote it down" });
    await ack.check();
    await expect(proceed).toBeEnabled();

    // a reload never shows it again
    await page.reload();
    await expect(main.getByText("ALREADY SHOWN")).toBeVisible();
    await expect(words(page)).toHaveCount(0);
    for (const w of code) await expect(main).not.toContainText(w);

    const before = await sessionCookie(context);
    expect(before).toBeDefined();
    await signOutButton(page).click();
    await expect(header(page).getByRole("link", { name: "SIGN IN", exact: true })).toBeVisible({
      timeout: ACTION_WAIT,
    });

    // C5: /recover with the words shuffled and upper-cased
    await page.goto("/recover");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("RECOVER MY FILE");
    const form = page.locator('form:has(input[name="code"])');
    await expect(form).toHaveAttribute("data-hydrated", "true", { timeout: HYDRATION_WAIT });
    await expectNoA11yViolations(page);
    await form.locator('input[name="username"]').fill(username);
    await form.locator('input[name="code"]').fill([...code].reverse().join(" ").toUpperCase());
    await form.locator('input[name="password"]').fill(NEW_PASSWORD);
    await form.getByRole("button", { name: "RECOVER MY FILE" }).click();
    await expect(page.getByText("PASSWORD SET")).toBeVisible({ timeout: ACTION_WAIT });
    const fresh = await readWords(page);
    expect(fresh).not.toEqual(code);
    await expect(page.locator('input[name="password"]')).toHaveCount(0);

    // the session cookie captured before recovery no longer resolves
    const stale = await browser.newContext();
    await stale.addCookies([{ ...before!, name: before!.name || SESSION_COOKIE }]);
    const stalePage = await stale.newPage();
    await stalePage.goto(LANDING);
    await expect(header(stalePage).getByRole("link", { name: "SIGN IN", exact: true })).toBeVisible(
      { timeout: HYDRATION_WAIT },
    );
    await expect(header(stalePage)).not.toContainText(username);
    await stale.close();

    // the old password fails, the new one signs in
    await openForm(page, "/sign-in");
    await fill(page, username, PASSWORD);
    await authForm(page).getByRole("button", { name: "SIGN IN", exact: true }).click();
    await expect(authForm(page).getByRole("alert").first()).toBeVisible({ timeout: ACTION_WAIT });
    expect(await sessionCookie(context)).toBeUndefined();
    await fill(page, username, NEW_PASSWORD);
    await authForm(page).getByRole("button", { name: "SIGN IN", exact: true }).click();
    await expect(header(page)).toContainText(username, { timeout: ACTION_WAIT });
  });

  for (const [locale, link, heading] of [
    ["en", "USE YOUR RECOVERY CODE →", "RECOVER MY FILE"],
    ["fr", "UTILISE TON CODE DE RÉCUPÉRATION →", "RÉCUPÉRER MON DOSSIER"],
  ] as const) {
    test(`owner decision 2026-11-09: /sign-in links to /recover (${locale}), /sign-up does not`, async ({
      page,
      context,
    }) => {
      const url = test.info().project.use.baseURL!;
      await context.addCookies([{ name: "locale", value: locale, url }]);
      await openForm(page, "/sign-up");
      await expect(page.getByRole("main").getByRole("link", { name: link })).toHaveCount(0);
      await openForm(page, "/sign-in");
      await page.getByRole("main").getByRole("link", { name: link }).click();
      await expect(page).toHaveURL(/\/recover$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    });
  }

  test("C3 a wrong code gets the one generic answer; every state is on /design", async ({
    page,
  }) => {
    await page.goto("/recover");
    const form = page.locator('form:has(input[name="code"])');
    await expect(form).toHaveAttribute("data-hydrated", "true", { timeout: HYDRATION_WAIT });
    await form.locator('input[name="username"]').fill(`${PREFIX}_ghost`);
    await form.locator('input[name="code"]').fill(Array(10).fill("acorn").join(" "));
    await form.locator('input[name="password"]').fill(NEW_PASSWORD);
    await form.getByRole("button", { name: "RECOVER MY FILE" }).click();
    await expect(
      form.getByRole("alert").filter({ hasText: "Wrong username or recovery code." }),
    ).toBeVisible({ timeout: ACTION_WAIT });

    await page.goto("/design");
    for (const id of [
      "reveal",
      "already-shown",
      "default",
      "pending",
      "field-error",
      "generic-error",
      "rate-limited",
      "success",
    ]) {
      await expect(page.locator(`[data-recovery-state="${id}"]`)).toBeVisible();
    }
  });
});
