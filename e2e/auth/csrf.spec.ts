import type { BrowserContext, Page } from "@playwright/test";
import { LANDING, expect, test } from "../fixtures";
import { HYDRATION_WAIT } from "../timeouts";
import {
  authForm,
  deleteUsers,
  fill,
  freshUsername,
  header,
  openForm,
  PASSWORD,
  seedAccount,
  sessionCookie,
  signOutButton,
  landSignedIn,
} from "./auth-helpers";

// #87 C2 (ADR 0009 "CSRF through Auth.js and server actions' origin check"): a server action POST whose
// `Origin` is not this site is refused by Next.js before the action runs, and the Auth.js credentials
// callback refuses a POST without its CSRF token. The forged requests run in their own browser
// contexts: the refused action answers 500, which the shared page guard would report.
const PREFIX = `cs${Date.now().toString(36).slice(-5)}`;
const FOREIGN = "https://attacker.example";

test.afterAll(async () => deleteUsers(PREFIX));

/**
 * Sends every server-action POST of `page` with `Origin: origin` instead (as a page on another site
 * would: the browser's cookies, a foreign origin). Chromium keeps its own `Origin` on a continued
 * request, so the forged one is sent by Playwright's network stack and its answer handed back.
 */
async function forgeOrigin(page: Page, origin: string) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const headers = request.headers();
    if (request.method() === "POST" && headers["next-action"]) {
      const cookies = await page.context().cookies(request.url());
      const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      const response = await route.fetch({ headers: { ...headers, cookie, origin } });
      await route.fulfill({ response });
    } else {
      await route.continue();
    }
  });
}

async function signInThroughForm(page: Page, username: string) {
  await openForm(page, "/sign-in");
  await fill(page, username, PASSWORD);
  const action = page.waitForResponse(
    (r) => r.request().method() === "POST" && !!r.request().headers()["next-action"],
  );
  await authForm(page).getByRole("button", { name: "SIGN IN", exact: true }).click();
  return action;
}

async function sessionUser(context: BrowserContext) {
  const body = (await (await context.request.get("/api/auth/session")).json()) as {
    user?: { name?: string };
  };
  return body.user?.name ?? null;
}

test.describe("CSRF (#87 C2)", () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project only");

  test("the sign-in action refuses a foreign Origin and accepts this site's", async ({
    browser,
    baseURL,
  }) => {
    const username = freshUsername(PREFIX);
    await seedAccount(username, PASSWORD);

    const forged = await browser.newContext();
    const page = await forged.newPage();
    await forgeOrigin(page, FOREIGN);
    const refused = await signInThroughForm(page, username);
    expect(refused.status()).toBeGreaterThanOrEqual(400);
    expect(await sessionCookie(forged)).toBeUndefined();
    expect(await sessionUser(forged)).toBeNull();
    await forged.close();

    // control: the same replay with this site's Origin signs in
    const real = await browser.newContext();
    const realPage = await real.newPage();
    await forgeOrigin(realPage, new URL(baseURL!).origin);
    expect((await signInThroughForm(realPage, username)).status()).toBeLessThan(400);
    await landSignedIn(realPage);
    expect(await sessionUser(real)).toBe(username);
    await real.close();
  });

  test("the sign-out action refuses a foreign Origin: the session stays", async ({ browser }) => {
    const username = freshUsername(PREFIX);
    await seedAccount(username, PASSWORD);
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInThroughForm(page, username);
    await landSignedIn(page);

    await forgeOrigin(page, FOREIGN);
    const action = page.waitForResponse(
      (r) => r.request().method() === "POST" && !!r.request().headers()["next-action"],
    );
    await signOutButton(page).click();
    expect((await action).status()).toBeGreaterThanOrEqual(400);
    await page.unrouteAll({ behavior: "ignoreErrors" });

    // still signed in, and the cookie still resolves (no tokenVersion bump)
    expect(await sessionUser(context)).toBe(username);
    await page.goto(LANDING);
    await expect(signOutButton(page)).toBeVisible({ timeout: HYDRATION_WAIT });
    await expect(header(page).getByRole("link", { name: "SIGN IN", exact: true })).toHaveCount(0);
    await context.close();
  });

  test("the credentials callback refuses a POST without the Auth.js CSRF token", async ({
    browser,
  }) => {
    const username = freshUsername(PREFIX);
    await seedAccount(username, PASSWORD);
    const context = await browser.newContext();
    const response = await context.request.post("/api/auth/callback/credentials", {
      form: { username, password: PASSWORD, callbackUrl: "/" },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(302);
    expect(response.headers()["location"]).toMatch(/error=MissingCSRF/);
    expect(await sessionCookie(context)).toBeUndefined();
    expect(await sessionUser(context)).toBeNull();
    await context.close();
  });
});
