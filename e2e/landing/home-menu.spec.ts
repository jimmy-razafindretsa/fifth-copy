import type { Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { LANDING, expect, expectNoA11yViolations, test } from "../fixtures";
import { withoutWebGL } from "../results/helpers";
import { ACTION_WAIT, HYDRATION_WAIT } from "../timeouts";
import {
  description,
  entries,
  entry,
  guest,
  hints,
  locale,
  menu,
  openMenu,
  plantGuestCookie,
  signInAccount,
} from "./home-helpers";

// Contract of #943 part A (C1-C10) and part E (C29): `/` is the Home menu for a viewer, the landing for
// a visitor; six entries, one roving tab stop, the description line, the key-hint bar.

const ORDER = ["play", "practice", "rooms", "file", "clerk", "settings"];
const LABELS = ["PLAY", "PRACTICE", "OPEN ROOMS", "MY FILE", "MY CLERK", "SETTINGS"];
const desktopOnly = () => test.skip(test.info().project.name !== "desktop", "desktop project only");
const selected = (page: Page) => menu(page).locator('[data-selected="true"]');
const focusedEntry = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute("data-entry") ?? null);

test.beforeEach(async ({ page, context }) => {
  await locale(context, "en");
  // the stage's 3D frame is #946's spec; the picture keeps software GL out of the way here
  await withoutWebGL(page);
});

test.describe("routing (C1)", () => {
  test("a visitor gets the landing: hero, QUICK RACE, open rooms; no guest is created", async ({
    page,
    context,
  }) => {
    const response = await page.goto("/");
    await expect(
      page.getByRole("button", { name: "QUICK RACE", exact: true }).first(),
    ).toBeVisible();
    await expect(page.locator("section[data-open-rooms]")).toBeVisible();
    await expect(menu(page)).toHaveCount(0);
    expect(response?.headers()["set-cookie"] ?? "").not.toContain("fc_guest");
    expect((await context.cookies()).some((c) => c.name === "fc_guest")).toBe(false);
  });

  test("a guest with a file gets the menu, not the hero", async ({ page, context }) => {
    await guest(context);
    await openMenu(page);
    await expect(page.locator("[data-home-screen]")).toBeVisible();
    await expect(page.locator("section[data-open-rooms]")).toHaveCount(0);
  });

  test("a signed-in account gets the menu", async ({ page }) => {
    desktopOnly();
    await signInAccount(page);
    await expect(menu(page)).toBeVisible({ timeout: HYDRATION_WAIT });
  });

  test("a stale guest cookie that resolves to nobody gets the landing", async ({
    page,
    context,
  }) => {
    await plantGuestCookie(context, `e2e_gone_${randomBytes(6).toString("hex")}`);
    await page.goto("/");
    await expect(menu(page)).toHaveCount(0);
    await expect(page.locator("section[data-open-rooms]")).toBeVisible();
  });
});

test.describe("entries (C2, C4, C5, C10)", () => {
  test("exactly six entries in order; each link lands where it says", async ({ page, context }) => {
    await guest(context);
    await openMenu(page);
    await expect(entries(page)).toHaveCount(6);
    expect(
      await entries(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-entry"))),
    ).toEqual(ORDER);
    for (const [i, label] of LABELS.entries())
      await expect(entries(page).nth(i)).toContainText(label);
    await expect(entry(page, "rooms")).toHaveAttribute("href", "/welcome#rooms");
    await expect(entry(page, "file")).toHaveAttribute("href", "/profile");
    await expect(entry(page, "clerk")).toHaveAttribute("href", "/locker");
    await expect(entry(page, "settings")).toHaveAttribute("href", "/settings");
    await entry(page, "settings").click();
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("PRACTICE runs createPracticeLobby and lands on /lobby/<code>", async ({
    page,
    context,
  }) => {
    desktopOnly();
    await guest(context);
    await openMenu(page);
    await entry(page, "practice").click();
    await expect(page).toHaveURL(/\/lobby\/[A-Z]{3}-\d{4}$/, { timeout: ACTION_WAIT });
  });

  test("PLAY runs quickRace and lands on /lobby/<code> @matchmaking", async ({ page, context }) => {
    await guest(context);
    await openMenu(page);
    await entry(page, "play").click();
    await expect(page).toHaveURL(/\/lobby\/[A-Z]{3}-\d{4}$/, { timeout: ACTION_WAIT });
  });

  test("C5 OPEN ROOMS opens the landing at its rooms docket, with CREATE PRIVATE RACE and the code join", async ({
    page,
    context,
  }) => {
    desktopOnly();
    await guest(context);
    await openMenu(page);
    await entry(page, "rooms").click();
    await expect(page).toHaveURL(/\/welcome#rooms$/);
    await expect(page.locator("section#rooms[data-open-rooms]")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "CREATE PRIVATE RACE", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("form", { name: "Join with code" })).toBeVisible();
  });

  test("C5 the guide link of a viewer's pages lands on the landing's How a race runs", async ({
    page,
    context,
  }) => {
    desktopOnly();
    await guest(context);
    await page.goto("/profile");
    const guide = page.getByRole("banner").getByRole("link", { name: "HOW TO TYPE É Ç « »" });
    await expect(guide).toHaveAttribute("href", "/welcome#how");
    await guide.click();
    await expect(page).toHaveURL(/\/welcome#how$/);
    await expect(page.locator("section#how")).toBeVisible();
  });

  test("C5 a visitor's guide link on / stays the in-page anchor", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("banner").getByRole("link", { name: "HOW TO TYPE É Ç « »" }),
    ).toHaveAttribute("href", "#how");
  });

  test("C10 in French the six entries read JOUER … RÉGLAGES", async ({ page, context }) => {
    await locale(context, "fr");
    await guest(context);
    await openMenu(page);
    const labels = await entries(page).evaluateAll((els) =>
      els.map((e) => e.querySelector("span:not([aria-hidden])")?.textContent?.trim()),
    );
    expect(labels.map((l) => l?.replace(/\s*\d+ NOUVEAUX?$/, ""))).toEqual([
      "JOUER",
      "ENTRAÎNEMENT",
      "SALLES OUVERTES",
      "MON DOSSIER",
      "MON COMMIS",
      "RÉGLAGES",
    ]);
  });
});

test.describe("keyboard (C3, C4)", () => {
  test("one tab stop, focused on load; arrows wrap; hover selects; Enter opens; Tab leaves to the hints", async ({
    page,
    context,
  }) => {
    desktopOnly();
    await guest(context);
    await openMenu(page);
    await expect(menu(page).locator('[tabindex="0"]')).toHaveCount(1);
    await expect.poll(() => focusedEntry(page)).toBe("play");
    await expect(selected(page)).toHaveAttribute("data-entry", "play");
    await expect(description(page)).toHaveAttribute("aria-live", "polite");
    const first = await description(page).textContent();

    await page.keyboard.press("ArrowUp");
    await expect.poll(() => focusedEntry(page)).toBe("settings");
    await expect(selected(page)).toHaveAttribute("data-entry", "settings");
    await expect(description(page)).not.toHaveText(first!);
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => focusedEntry(page)).toBe("play");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => focusedEntry(page)).toBe("practice");
    await expect(menu(page).locator('[tabindex="0"]')).toHaveAttribute("data-entry", "practice");

    await entry(page, "file").hover();
    await expect(selected(page)).toHaveAttribute("data-entry", "file");
    await expect(description(page)).toHaveText(/Personnel file/);

    await entry(page, "practice").focus();
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() =>
        document.activeElement?.closest("[data-key-hints]")
          ? "hints"
          : (document.activeElement?.outerHTML.slice(0, 120) ?? "none"),
      ),
    ).toBe("hints");

    await entry(page, "practice").focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
    await expect.poll(() => focusedEntry(page)).toBe("settings");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("Space activates the focused entry", async ({ page, context }) => {
    desktopOnly();
    await guest(context);
    await openMenu(page);
    await entry(page, "file").focus();
    await page.keyboard.press(" ");
    await expect(page).toHaveURL(/\/profile$/);
  });
});

test.describe("key-hint bar (C6)", () => {
  test("a guest: no ESC hint, SIGN IN link, Escape does nothing; the version", async ({
    page,
    context,
  }) => {
    await guest(context);
    await openMenu(page);
    await expect(hints(page).getByRole("link", { name: "SIGN IN", exact: true })).toHaveAttribute(
      "href",
      "/sign-in",
    );
    await expect(hints(page)).not.toContainText("ESC");
    await expect(hints(page).locator("[data-version]")).toContainText(/^v\d+\.\d+\.\d+/);
    await entry(page, "play").focus();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("an account: Escape in the menu signs out and the next / is the landing", async ({
    page,
  }) => {
    desktopOnly();
    await signInAccount(page);
    await openMenu(page);
    await expect(hints(page).getByRole("button", { name: /SIGN OUT/ })).toBeVisible();
    await expect(hints(page)).toContainText("ESC");
    await entry(page, "play").focus();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0, { timeout: ACTION_WAIT });
    await page.goto("/");
    await expect(page.locator("section[data-open-rooms]")).toBeVisible();
  });

  test("an account: clicking SIGN OUT signs out", async ({ page }) => {
    desktopOnly();
    await signInAccount(page);
    await openMenu(page);
    await hints(page)
      .getByRole("button", { name: /SIGN OUT/ })
      .click();
    await expect(menu(page)).toHaveCount(0, { timeout: ACTION_WAIT });
  });
});

test.describe("accessibility, motion and layout (C8, C9)", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`axe clean, one h1, 44px targets (${theme})`, async ({ page, context }) => {
      await context.addCookies([
        { name: "theme", value: theme, url: test.info().project.use.baseURL! },
      ]);
      await guest(context);
      await openMenu(page);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveText("FIFTH COPY");
      await expectNoA11yViolations(page);
      const heights = await page
        .locator("[data-entry], [data-sign-in], [data-sign-out]")
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
    });
  }

  test("an account's menu is axe clean in both themes", async ({ page, context }) => {
    desktopOnly();
    await signInAccount(page);
    for (const theme of ["light", "dark"] as const) {
      await context.addCookies([
        { name: "theme", value: theme, url: test.info().project.use.baseURL! },
      ]);
      await openMenu(page);
      await expectNoA11yViolations(page);
    }
  });

  test("under reduced motion the selection has no transition and no transform", async ({
    page,
    context,
  }) => {
    desktopOnly();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await guest(context);
    await openMenu(page);
    await entry(page, "practice").hover();
    const style = await entry(page, "practice").evaluate((el) => {
      const s = getComputedStyle(el);
      return { duration: s.transitionDuration, transform: s.transform };
    });
    expect(style.duration.split(",").every((d) => parseFloat(d) === 0)).toBe(true);
    expect(style.transform).toBe("none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => document.documentElement.setAttribute("data-motion", "reduce"));
    const attr = await entry(page, "file").evaluate(
      (el) => getComputedStyle(el).transitionDuration,
    );
    expect(attr.split(",").every((d) => parseFloat(d) === 0)).toBe(true);
  });

  test("375: one column, no horizontal scroll, key caps hidden, SIGN IN stays", async ({
    page,
    context,
  }) => {
    test.skip(test.info().project.name !== "mobile", "mobile project only");
    await guest(context);
    await openMenu(page);
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(fits).toBe(true);
    for (const cap of await hints(page)
      .locator('[aria-hidden="true"]')
      .filter({ hasText: /↑↓|ENTER/ })
      .all())
      await expect(cap).toBeHidden();
    await expect(hints(page).getByRole("link", { name: "SIGN IN", exact: true })).toBeVisible();
    // one column: the menu, the description and the bar are stacked
    const menuBox = await menu(page).boundingBox();
    const barBox = await hints(page).boundingBox();
    expect(barBox!.y).toBeGreaterThan(menuBox!.y + menuBox!.height - 1);
  });

  test("1280: the menu is the left column and the stage the right half", async ({
    page,
    context,
  }) => {
    desktopOnly();
    await guest(context);
    await openMenu(page);
    const menuBox = await menu(page).boundingBox();
    const stageBox = await page.locator("[data-home-stage]").boundingBox();
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(640);
    expect(stageBox!.x).toBeGreaterThanOrEqual(639);
  });
});

test.describe("the MY CLERK tag (C29)", () => {
  test("2 NEW until the locker is opened; none after; part of the entry's name", async ({
    page,
    context,
  }) => {
    await guest(context);
    await openMenu(page);
    await expect(entry(page, "clerk")).toHaveAccessibleName(/MY CLERK\s*2 NEW/);
    await page.goto("/locker");
    await expect(page.locator("[data-locker]")).toBeVisible({ timeout: HYDRATION_WAIT });
    await expect
      .poll(async () => (await context.cookies()).find((c) => c.name === "fc_locker_seen")?.value)
      .toBeTruthy();
    await openMenu(page);
    await expect(entry(page, "clerk")).toHaveAccessibleName("MY CLERK");
  });

  test("in French it reads 2 NOUVEAUX", async ({ page, context }) => {
    await locale(context, "fr");
    await guest(context);
    await openMenu(page);
    await expect(entry(page, "clerk")).toContainText("2 NOUVEAUX");
  });

  test("a tampered seen cookie is ignored: the tag reads 2 NEW", async ({ page, context }) => {
    await guest(context);
    await context.addCookies([
      {
        name: "fc_locker_seen",
        value: "glasses:square,hat:kepka,<x>",
        url: test.info().project.use.baseURL!,
      },
    ]);
    await openMenu(page);
    await expect(entry(page, "clerk")).toContainText("2 NEW");
  });
});

test("the landing stays at /welcome for a viewer", async ({ page, context }) => {
  await guest(context);
  await page.goto(LANDING);
  await expect(page.locator("section[data-open-rooms]")).toBeVisible();
  await expect(menu(page)).toHaveCount(0);
});
