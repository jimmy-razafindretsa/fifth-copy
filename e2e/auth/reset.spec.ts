import { randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";
import type { BrowserContext, Page } from "@playwright/test";
import { Client } from "pg";
import { ACTION_WAIT, HYDRATION_WAIT } from "../timeouts";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import {
  PASSWORD,
  authForm,
  deleteUsers,
  fill,
  freshUsername,
  header,
  openForm,
  seedAccount,
  sessionCookie,
  landSignedIn,
} from "./auth-helpers";

// #789 C5, C7: the /reset screen in both languages, its /design states, and a teacher reset redeemed
// end to end: the new password signs in, the old one and the old session do not, the code is spent.

const PREFIX = `rs_${Date.now().toString(36)}`;
const NEW_PASSWORD = `new-${randomBytes(6).toString("hex")}`;

const COPY = {
  en: {
    heading: "NEW PASSWORD",
    username: "USERNAME",
    code: "RESET CODE",
    password: "NEW PASSWORD",
    submit: "SET MY PASSWORD",
    signIn: "SIGN IN →",
  },
  fr: {
    heading: "NOUVEAU MOT DE PASSE",
    username: "NOM D'UTILISATEUR",
    code: "CODE DE RÉINITIALISATION",
    password: "NOUVEAU MOT DE PASSE",
    submit: "CHANGER MON MOT DE PASSE",
    signIn: "CONNEXION →",
  },
} as const;

const resetForm = (page: Page) => page.locator('form:has(input[name="code"])');

async function setLocale(context: BrowserContext, locale: "en" | "fr") {
  const url = test.info().project.use.baseURL!;
  await context.addCookies([{ name: "locale", value: locale, url }]);
}

/** Adds a reset row for `username` with the Argon2id hash of `code` (as #788 stores it). */
async function seedReset(username: string, code: string): Promise<void> {
  const codeHash = await hash(code, {
    algorithm: 2,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query(
      `INSERT INTO "PasswordReset" (id, "userId", "codeHash", "lobbyCode", "issuedAt", "expiresAt")
       SELECT $1, id, $2, 'QRT-1234', now(), now() + interval '30 minutes'
       FROM "User" WHERE "usernameNormalized" = $3`,
      [`e2e_${randomBytes(8).toString("hex")}`, codeHash, username.toLowerCase()],
    );
  } finally {
    await db.end();
  }
}

async function redeem(page: Page, username: string, code: string, password: string) {
  await page.goto("/reset");
  const form = resetForm(page);
  await expect(form).toHaveAttribute("data-hydrated", "true", { timeout: HYDRATION_WAIT });
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="code"]').fill(code);
  await form.locator('input[name="password"]').fill(password);
  await form.getByRole("button", { name: "SET MY PASSWORD" }).click();
}

test.describe("teacher password reset, redeemed (#789)", () => {
  test.afterAll(async () => deleteUsers(PREFIX));

  for (const locale of ["en", "fr"] as const) {
    test(`C5 /reset in ${locale}: heading, three fields, submit, sign-in link, no email, no recovery code`, async ({
      page,
      context,
    }) => {
      await setLocale(context, locale);
      await page.goto("/reset");
      const c = COPY[locale];
      const main = page.getByRole("main");
      const h1 = main.getByRole("heading", { level: 1 });
      await expect(h1).toHaveText(c.heading);
      expect(await h1.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/Stardos/i);
      const form = resetForm(page);
      await expect(form).toHaveAttribute("method", /post/i);
      await expect(form.getByLabel(c.username, { exact: true })).toHaveAttribute("type", "text");
      await expect(form.getByLabel(c.code, { exact: true })).toHaveAttribute("type", "text");
      await expect(form.getByLabel(c.password, { exact: true })).toHaveAttribute(
        "type",
        "password",
      );
      await expect(form.locator("input:not([type=hidden])")).toHaveCount(3);
      await expect(form.getByRole("button", { name: c.submit })).toBeVisible();
      await expect(main.getByRole("link", { name: c.signIn })).toHaveAttribute("href", "/sign-in");
      await expect(main.locator('input[type="email"], input[name*="mail" i]')).toHaveCount(0);
      await expect(main).not.toContainText(/e-?mail|courriel|recovery|récupération/i);
      await expectNoA11yViolations(page);
    });
  }

  test("C5 every reset state is on /design", async ({ page }) => {
    await page.goto("/design");
    const state = (id: string) => page.locator(`[data-reset-state="${id}"]`);

    const plain = state("default").locator("form");
    await expect(plain.locator("input")).toHaveCount(3);
    await expect(plain.locator("input[aria-invalid]")).toHaveCount(0);
    await expect(plain.getByRole("alert")).toHaveCount(0);

    const pending = state("pending").locator("form");
    await expect(pending).toHaveAttribute("aria-busy", "true");
    const busy = pending.getByRole("button", { name: "FILING…" });
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute("aria-busy", "true");

    const invalid = state("field-error").locator('input[name="code"]');
    await expect(invalid).toHaveAttribute("aria-invalid", "true");
    const describedBy = (await invalid.getAttribute("aria-describedby"))!.split(" ");
    const message = state("field-error").locator(`[id="${describedBy.at(-1)}"]`);
    await expect(message).toContainText("Use the 8 letters and numbers");
    await expect(message).toHaveAttribute("role", "alert");

    await expect(
      state("generic-error").getByRole("alert").filter({ hasText: "Wrong username or code" }),
    ).toBeVisible();
    await expect(
      state("rate-limited")
        .getByRole("alert")
        .filter({ hasText: "Too many tries. Try again in 42 min." }),
    ).toBeVisible();
    const done = state("success").getByRole("status");
    await expect(done).toContainText("PASSWORD SET");
    await expect(done.getByRole("link", { name: "SIGN IN →" })).toHaveAttribute("href", "/sign-in");
    await expect(state("success").locator("input")).toHaveCount(0);
  });

  test("C7 a redeemed code sets the password, drops the old session and is spent", async ({
    page,
    context,
    browser,
  }) => {
    const username = freshUsername(PREFIX);
    await seedAccount(username, PASSWORD);

    // a session from before the reset
    await openForm(page, "/sign-in");
    await fill(page, username, PASSWORD);
    await authForm(page).getByRole("button", { name: "SIGN IN", exact: true }).click();
    await landSignedIn(page, ACTION_WAIT);
    await expect(header(page)).toContainText(username, { timeout: ACTION_WAIT });
    const oldCookie = await sessionCookie(context);
    expect(oldCookie).toBeDefined();
    expect(
      ((await (await context.request.get("/api/auth/session")).json()) as { user?: unknown }).user,
    ).toBeDefined();

    // the teacher hands over a code; the student redeems it in another browser
    const code = "K7QM3XRT";
    await seedReset(username, code);
    const student = await browser.newContext();
    const sp = await student.newPage();
    await redeem(sp, username, "k7qm-3xrt", NEW_PASSWORD);
    const done = sp.getByRole("status").filter({ hasText: "PASSWORD SET" });
    await expect(done).toBeVisible({ timeout: ACTION_WAIT });
    await expect(done.getByRole("link", { name: "SIGN IN →" })).toHaveAttribute("href", "/sign-in");
    expect(sp.url()).not.toContain(code);
    expect(sp.url().toLowerCase()).not.toContain("k7qm");

    // the session cookie captured before the reset no longer resolves
    const stale = await browser.newContext();
    await stale.addCookies([oldCookie!]);
    expect(await (await stale.request.get("/api/auth/session")).json()).toEqual({});
    await stale.close();

    // the old password is refused, the new one signs in
    const fresh = await browser.newContext();
    const fp = await fresh.newPage();
    await openForm(fp, "/sign-in");
    await fill(fp, username, PASSWORD);
    await authForm(fp).getByRole("button", { name: "SIGN IN", exact: true }).click();
    await expect(
      fp.getByRole("alert").filter({ hasText: "Wrong username or password." }),
    ).toBeVisible({ timeout: ACTION_WAIT });
    await fill(fp, username, NEW_PASSWORD);
    await authForm(fp).getByRole("button", { name: "SIGN IN", exact: true }).click();
    await landSignedIn(fp, ACTION_WAIT);
    await expect(header(fp)).toContainText(username, { timeout: ACTION_WAIT });
    await fresh.close();

    // the same code again: the one generic answer
    await redeem(sp, username, code, `again-${NEW_PASSWORD}`);
    await expect(sp.getByRole("alert").filter({ hasText: "Wrong username or code" })).toBeVisible({
      timeout: ACTION_WAIT,
    });
    await expect(sp.getByRole("main")).not.toContainText(code);
    await student.close();
  });
});
