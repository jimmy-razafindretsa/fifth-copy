import type { BrowserContext } from "@playwright/test";
import { HYDRATION_WAIT } from "../timeouts";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { authForm } from "./auth-helpers";

// #36 C8, C9, C11: the two screens' content in both languages, the form states on /design, and the
// visual baselines (pinned image, @visual).

const SCREENS = ["/sign-in", "/sign-up"] as const;

const COPY = {
  en: {
    heading: { "/sign-in": "SIGN IN", "/sign-up": "OPEN A FILE" },
    guest: "PLAY AS GUEST →",
    username: "USERNAME",
    password: "PASSWORD",
    submit: { "/sign-in": "SIGN IN", "/sign-up": "OPEN MY FILE" },
    github: "CONTINUE WITH GITHUB",
    discord: "CONTINUE WITH DISCORD",
    google: "CONTINUE WITH GOOGLE",
    other: { "/sign-in": "OPEN A FILE →", "/sign-up": "SIGN IN →" },
    privacy: "Privacy: what we keep and why",
  },
  fr: {
    heading: { "/sign-in": "CONNEXION", "/sign-up": "OUVRIR UN DOSSIER" },
    guest: "JOUER EN INVITÉ →",
    username: "NOM D'UTILISATEUR",
    password: "MOT DE PASSE",
    submit: { "/sign-in": "CONNEXION", "/sign-up": "OUVRIR MON DOSSIER" },
    github: "CONTINUER AVEC GITHUB",
    discord: "CONTINUER AVEC DISCORD",
    google: "CONTINUER AVEC GOOGLE",
    other: { "/sign-in": "OUVRIR UN DOSSIER →", "/sign-up": "CONNEXION →" },
    privacy: "Confidentialité : ce qu'on garde et pourquoi",
  },
} as const;

async function setLocale(context: BrowserContext, locale: "en" | "fr") {
  const url = test.info().project.use.baseURL!;
  await context.addCookies([{ name: "locale", value: locale, url }]);
}

test.describe("auth screens (#36)", () => {
  for (const locale of ["en", "fr"] as const) {
    for (const path of SCREENS) {
      test(`C8 ${path} in ${locale}: every part, no email field, no forgot-password`, async ({
        page,
        context,
      }) => {
        await setLocale(context, locale);
        await page.goto(path);
        const c = COPY[locale];
        const main = page.getByRole("main");
        const h1 = main.getByRole("heading", { level: 1 });
        await expect(h1).toHaveText(c.heading[path]);
        // the stencil heading: the display role (Stardos Stencil)
        expect(await h1.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/Stardos/i);
        await expect(main.getByRole("link", { name: c.guest })).toHaveAttribute("href", "/#play");
        const form = authForm(page);
        await expect(form.getByLabel(c.username, { exact: true })).toHaveAttribute("type", "text");
        await expect(form.getByLabel(c.password, { exact: true })).toHaveAttribute(
          "type",
          "password",
        );
        await expect(form.getByRole("button", { name: c.submit[path], exact: true })).toBeVisible();
        // GitHub, Discord and Google, each led by its decorative monochrome mark: the accessible name
        // stays the label alone, the mark is aria-hidden and painted in the button's own text colour
        for (const id of ["github", "discord", "google"] as const) {
          const button = main.getByRole("button", { name: c[id], exact: true });
          await expect(button).toBeVisible();
          const mark = button.locator(`svg[data-provider-mark="${id}"]`);
          await expect(mark).toHaveAttribute("aria-hidden", "true");
          const [fill, color] = await button.evaluate((el) => [
            getComputedStyle(el.querySelector("path")!).fill,
            getComputedStyle(el).color,
          ]);
          expect(fill).toBe(color);
        }
        const other = path === "/sign-in" ? "/sign-up" : "/sign-in";
        await expect(main.getByRole("link", { name: c.other[path] })).toHaveAttribute(
          "href",
          other,
        );
        await expect(main.getByRole("link", { name: c.privacy })).toHaveAttribute(
          "href",
          "/privacy",
        );
        // no email field (R152); the only lost-password path is the recovery code link (#46)
        await expect(page.locator('input[type="email"], input[name*="mail" i]')).toHaveCount(0);
        await expect(page.getByLabel(/e-?mail|courriel/i)).toHaveCount(0);
        await expect(page.locator("body")).not.toContainText(
          /forgot|oubli|reset (your|my) password|réinitialis/i,
        );
        // the owner's C18 review: the copy makes no email claim (whether accounts store one is open)
        await expect(page.locator("body")).not.toContainText(/no email|courriel/i);
        expect(await form.locator("input:not([type=hidden])").count()).toBe(2);
        await expectNoA11yViolations(page);
      });
    }
  }

  // The Google press now starts Google's OAuth flow (#828, ADR 0009 amendment): e2e/auth/oauth.spec.ts.

  test("C9 every form state is on /design", async ({ page }) => {
    await page.goto("/design");
    const state = (id: string) => page.locator(`[data-auth-state="${id}"]`);

    const plain = state("default").locator("form");
    await expect(plain.locator("input[aria-invalid]")).toHaveCount(0);
    await expect(plain.getByRole("alert")).toHaveCount(0);

    const pending = state("pending").locator("form");
    await expect(pending).toHaveAttribute("aria-busy", "true");
    const busy = pending.getByRole("button", { name: "FILING…" });
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute("aria-busy", "true");

    const invalid = state("invalid").locator('input[name="username"]');
    await expect(invalid).toHaveAttribute("aria-invalid", "true");
    const describedBy = (await invalid.getAttribute("aria-describedby"))!.split(" ");
    const message = state("invalid").locator(`[id="${describedBy.at(-1)}"]`);
    await expect(message).toContainText("That username is already on file.");
    await expect(message).toHaveAttribute("role", "alert");

    await expect(
      state("server-error").getByRole("alert").filter({ hasText: "Wrong username or password." }),
    ).toBeVisible();
    await expect(
      state("oauth-error").getByRole("alert").filter({ hasText: "did not go through" }),
    ).toBeVisible();
  });

  for (const theme of ["light", "dark"] as const) {
    for (const path of SCREENS) {
      test(`C11 ${path} ${theme} baseline @visual`, async ({ page, context }) => {
        const url = test.info().project.use.baseURL!;
        await context.addCookies([{ name: "theme", value: theme, url }]);
        await page.goto(path);
        await expect(authForm(page)).toHaveAttribute("data-hydrated", "true", {
          timeout: HYDRATION_WAIT,
        });
        await expect(page).toHaveScreenshot(`${path.slice(1)}-${theme}.png`, { fullPage: true });
      });
    }
  }
});
