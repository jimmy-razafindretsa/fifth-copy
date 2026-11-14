import type { Cookie, Page } from "@playwright/test";
import { LANDING, expect, test } from "../fixtures";
import { createLobby } from "../race/helpers";
import { HYDRATION_WAIT, scaled } from "../timeouts";
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
  signUpThroughForm,
  landSignedIn,
} from "./auth-helpers";

// #87 C1 (cookie flags) and C8 (sign-out revokes every device), ADR 0009 amended.
// playwright.config.ts runs `next start` (NODE_ENV=production) in CI and `next dev` locally: Secure and
// the `__Secure-` prefix are expected exactly when the server runs in production.
const PRODUCTION = !!process.env.CI;
const PREFIX = `hd${Date.now().toString(36).slice(-5)}`;

test.afterAll(async () => deleteUsers(PREFIX));

function expectPolicy(cookie: Cookie | undefined, name: string) {
  expect(cookie, name).toBeDefined();
  expect(
    {
      httpOnly: cookie!.httpOnly,
      sameSite: cookie!.sameSite,
      path: cookie!.path,
      secure: cookie!.secure,
    },
    name,
  ).toEqual({ httpOnly: true, sameSite: "Lax", path: "/", secure: PRODUCTION });
}

const cookieNamed = async (page: Page, name: string) =>
  (await page.context().cookies()).find((c) => c.name === name);

test.describe("account cookies and revocation (#87)", () => {
  // cookie flags do not depend on the viewport
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project only");

  test("C1 session, fc_guest, locale and theme cookies are HttpOnly, Lax, Path=/, Secure in production", async ({
    page,
  }) => {
    test.slow();
    // fc_guest: the first write that needs an identity (a lobby) creates the guest
    await createLobby(page);
    expectPolicy(await cookieNamed(page, "fc_guest"), "fc_guest");

    // locale and theme: the landing header's toggles (server actions)
    await page.goto(LANDING);
    const language = page.getByRole("group", { name: "Language" });
    await expect(async () => {
      await language.getByRole("button", { name: "FR", exact: true }).click();
      expect(await cookieNamed(page, "locale")).toBeDefined();
    }).toPass({ timeout: HYDRATION_WAIT });
    expectPolicy(await cookieNamed(page, "locale"), "locale");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    const night = page.getByRole("button", { name: "QUART DE NUIT" });
    await expect(async () => {
      await night.click();
      expect(await cookieNamed(page, "theme")).toBeDefined();
    }).toPass({ timeout: HYDRATION_WAIT });
    expectPolicy(await cookieNamed(page, "theme"), "theme");

    // the session cookie: sign in (Auth.js sets it)
    const username = freshUsername(PREFIX);
    await seedAccount(username, PASSWORD);
    await page.context().clearCookies();
    await openForm(page, "/sign-in");
    await fill(page, username, PASSWORD);
    await authForm(page).getByRole("button", { name: "SIGN IN", exact: true }).click();
    await landSignedIn(page);
    const session = await sessionCookie(page.context());
    expect(session?.name).toBe(
      PRODUCTION ? "__Secure-authjs.session-token" : "authjs.session-token",
    );
    expectPolicy(session, "session");
  });

  test("C8 sign-out on one device revokes the session cookie of every device", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(90_000));
    const username = freshUsername(PREFIX);
    await signUpThroughForm(page, username, PASSWORD);

    // a second device signs in to the same account
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await openForm(otherPage, "/sign-in");
    await fill(otherPage, username, PASSWORD);
    await authForm(otherPage).getByRole("button", { name: "SIGN IN", exact: true }).click();
    await landSignedIn(otherPage);
    const captured = await sessionCookie(other);
    expect(captured).toBeDefined();

    // sign out on the first device
    await page.goto(LANDING);
    await signOutButton(page).click();
    await expect(header(page).getByRole("link", { name: "SIGN IN", exact: true })).toBeVisible({
      timeout: HYDRATION_WAIT,
    });

    // the other device's cookie no longer resolves: signed out on the page and at /api/auth/session
    await otherPage.goto(LANDING);
    await expect(header(otherPage).getByRole("link", { name: "SIGN IN", exact: true })).toBeVisible(
      { timeout: HYDRATION_WAIT },
    );
    const replay = await browser.newContext();
    await replay.addCookies([captured!]);
    const session = await replay.request.get("/api/auth/session");
    expect(await session.json()).toEqual({});
    await other.close();
    await replay.close();
  });
});
