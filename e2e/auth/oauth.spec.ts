import type { BrowserContext } from "@playwright/test";
import { en } from "../../src/i18n/en";
import { fr } from "../../src/i18n/fr";
import { expect, test } from "../fixtures";
import { HYDRATION_WAIT } from "../timeouts";
import { openForm } from "./auth-helpers";

// #49 C4-C7: GitHub and Discord sign-in on /sign-in. playwright.config.ts gives the web server
// placeholder provider credentials, so both buttons show and the GitHub press reaches the authorize
// redirect, intercepted here: no request ever leaves for a provider.

const CATALOGS = { en, fr } as const;

/** Each Auth.js error code and the catalog sentence its banner shows (C4). */
const ERRORS = {
  OAuthCallbackError: "body",
  AccessDenied: "denied",
  OAuthAccountNotLinked: "notLinked",
  Configuration: "unavailable",
} as const;

async function setLocale(context: BrowserContext, locale: "en" | "fr") {
  const url = test.info().project.use.baseURL!;
  await context.addCookies([{ name: "locale", value: locale, url }]);
}

for (const locale of ["en", "fr"] as const) {
  const t = CATALOGS[locale].auth;

  test(`C5 C6 /sign-in shows GitHub, Discord and the under-13 line (${locale})`, async ({
    page,
    context,
  }) => {
    await setLocale(context, locale);
    await page.goto("/sign-in");
    const github = page.getByRole("button", { name: t.providers.github });
    const discord = page.getByRole("button", { name: t.providers.discord });
    await expect(github).toBeVisible();
    await expect(discord).toBeVisible();
    const age = page.getByText(t.providers.age, { exact: true });
    await expect(age).toBeVisible();
    // next to the buttons: in the same docket section, right after them
    const section = page.locator("section div").filter({ has: github }).filter({ has: age }).last();
    await expect(section).toContainText(t.providers.age);
  });

  for (const [code, key] of Object.entries(ERRORS)) {
    test(`C4 C6 ?error=${code} shows one plain message with role=alert (${locale})`, async ({
      page,
      context,
    }) => {
      await setLocale(context, locale);
      await page.goto(`/sign-in?error=${code}`);
      const alerts = page.getByRole("alert").filter({ hasText: t.oauthError.title });
      await expect(alerts).toHaveCount(1);
      await expect(alerts).toContainText(t.oauthError[key]);
      await expect(alerts).not.toContainText(code);
    });
  }
}

test("C7 the GitHub press redirects to github.com authorize with scope read:user only", async ({
  page,
  pageErrors,
}) => {
  const authorize: string[] = [];
  await page.route(/^https:\/\/(github\.com|api\.github\.com|discord\.com)\//, async (route) => {
    authorize.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "text/plain", body: "intercepted" });
  });
  await openForm(page, "/sign-in");
  await page.getByRole("button", { name: en.auth.providers.github }).click();
  await expect.poll(() => authorize.length, { timeout: HYDRATION_WAIT }).toBeGreaterThan(0);

  const url = new URL(authorize[0]!);
  expect(`${url.origin}${url.pathname}`).toBe("https://github.com/login/oauth/authorize");
  expect(url.searchParams.get("scope")).toBe("read:user");
  expect(url.search).not.toContain("user:email");
  expect(url.searchParams.get("state")).toBeTruthy();
  expect(url.searchParams.get("code_challenge")).toBeTruthy();
  expect(url.searchParams.get("redirect_uri")).toMatch(/\/api\/auth\/callback\/github$/);
  // The server action's own request is aborted by the navigation to the provider: expected here only.
  await page.waitForURL(/^https:\/\/github\.com\/login\/oauth\/authorize/, {
    timeout: HYDRATION_WAIT,
  });
  const aborted = (e: string) => /^requestfailed: POST .*\/sign-in net::ERR_ABORTED$/.test(e);
  pageErrors.splice(0, pageErrors.length, ...pageErrors.filter((e) => !aborted(e)));
});
