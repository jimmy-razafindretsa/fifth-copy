import type { BrowserContext, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "./fixtures";

// Contract of #19 (ARCHITECTURE 8.4, bible 3.2 and 14.1): light by default, the OS decides without a
// cookie, the `theme` cookie (written by the NIGHT SHIFT toggle) wins and is server-rendered as
// `<html data-theme>`, so the first paint is already in the chosen theme.

const PAPER = "rgb(241, 232, 214)"; // bible 3.1 paper #F1E8D6
const NIGHT = "rgb(62, 57, 52)"; // bible 3.2 night #3E3934
const AFTER_ACTION = { timeout: 20_000 };

async function setThemeCookie(context: BrowserContext, value: string) {
  const url = test.info().project.use.baseURL;
  if (!url) throw new Error("no baseURL");
  await context.addCookies([{ name: "theme", value, url }]);
}

const html = (page: Page) => page.locator("html");
const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const colorScheme = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
const toggle = (page: Page) =>
  page.locator("[data-preferences-demo]").getByRole("button", { name: "NIGHT SHIFT" });

/**
 * Loads /design and waits for hydration: under reduced motion `MotionSafe` renders its children on the
 * server and swaps to the fallback only on the client, so "Motion reduced" means the tree is live.
 */
async function ready(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/design");
  await expect(page.locator("[data-motion-safe]")).toHaveText("Motion reduced", AFTER_ACTION);
}

test.describe("#19 theme", () => {
  for (const [scheme, ground, cs] of [
    ["dark", NIGHT, "dark"],
    ["light", PAPER, "light"],
  ] as const) {
    test(`C1 C5 without a cookie the ${scheme} OS decides: no data-theme, ${ground}, color-scheme ${cs}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/design");
      await expect(html(page)).not.toHaveAttribute("data-theme");
      expect(await bodyBg(page)).toBe(ground);
      expect(await colorScheme(page)).toBe(cs);
    });
  }

  test("C2 the server HTML carries data-theme from the cookie, no client script needed", async ({
    request,
  }) => {
    const get = (cookie?: string) =>
      request
        .get("/design", { headers: cookie ? { cookie } : {} })
        .then(async (r) => (await r.text()).match(/<html[^>]*>/)?.[0] ?? "");
    expect(await get("theme=dark")).toContain('data-theme="dark"');
    expect(await get("theme=light")).toContain('data-theme="light"');
    for (const bad of [undefined, "theme=night", "theme=system", "theme="]) {
      expect(await get(bad), String(bad)).not.toContain("data-theme");
    }
  });

  test("C2 C5 theme=dark under a light OS paints night on first paint (scripts off)", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: "light" });
    await setThemeCookie(context, "dark");
    const page = await context.newPage();
    await page.goto("/design");
    await expect(html(page)).toHaveAttribute("data-theme", "dark");
    expect(await bodyBg(page)).toBe(NIGHT);
    expect(await colorScheme(page)).toBe("dark");
    await context.close();
  });

  test("C2 C5 theme=light under a dark OS stays paper", async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await setThemeCookie(context, "light");
    await page.goto("/design");
    await expect(html(page)).toHaveAttribute("data-theme", "light");
    expect(await bodyBg(page)).toBe(PAPER);
    expect(await colorScheme(page)).toBe("light");
  });

  test("C2 any other cookie value renders no data-theme and the OS decides", async ({
    page,
    context,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await setThemeCookie(context, "night");
    await page.goto("/design");
    await expect(html(page)).not.toHaveAttribute("data-theme");
    expect(await bodyBg(page)).toBe(NIGHT);
  });

  test("C3 C4 the toggle on /design switches at once, writes the cookie and a reload keeps it", async ({
    page,
    context,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await ready(page);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    await toggle(page).click();
    // at once: the client sets the attribute before the action answers
    await expect(html(page)).toHaveAttribute("data-theme", "dark", { timeout: 1_000 });
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    expect(await bodyBg(page)).toBe(NIGHT);
    await expect
      .poll(async () => (await context.cookies()).find((c) => c.name === "theme"), AFTER_ACTION)
      .toMatchObject({ value: "dark", httpOnly: true, sameSite: "Lax", path: "/" });
    const cookie = (await context.cookies()).find((c) => c.name === "theme");
    // max-age one year (a few seconds of slack for the round trip)
    expect(cookie!.expires - Date.now() / 1000).toBeGreaterThan(365 * 24 * 3600 - 60);

    await page.reload();
    await expect(html(page)).toHaveAttribute("data-theme", "dark");
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    expect(await colorScheme(page)).toBe("dark");

    await toggle(page).click();
    await expect(html(page)).toHaveAttribute("data-theme", "light", { timeout: 1_000 });
    await expect
      .poll(
        async () => (await context.cookies()).find((c) => c.name === "theme")?.value,
        AFTER_ACTION,
      )
      .toBe("light");
    await page.reload();
    await expect(html(page)).toHaveAttribute("data-theme", "light");
    expect(await bodyBg(page)).toBe(PAPER);
  });

  test("C4 aria-pressed follows the OS without a cookie, and the cookie once set", async ({
    page,
    context,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await ready(page);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");

    await setThemeCookie(context, "dark");
    await ready(page);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  });

  for (const key of ["Enter", "Space"] as const) {
    test(`C4 ${key} operates the toggle`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: "light" });
      await ready(page);
      await toggle(page).focus();
      await page.keyboard.press(key);
      await expect(html(page)).toHaveAttribute("data-theme", "dark", { timeout: 1_000 });
      await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    });
  }

  for (const value of ["light", "dark"] as const) {
    test(`C6 /design with the Preferences section is axe clean with theme=${value}`, async ({
      page,
      context,
    }) => {
      await setThemeCookie(context, value);
      await page.emulateMedia({ colorScheme: value === "dark" ? "light" : "dark" });
      await page.goto("/design");
      await expect(page.getByRole("heading", { level: 2, name: "Preferences" })).toBeVisible();
      await expect(toggle(page)).toHaveAttribute("aria-pressed", String(value === "dark"));
      await expectNoA11yViolations(page);
    });
  }
});
