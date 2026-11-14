import type { Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { withoutWebGL } from "../results/helpers";
import { ACTION_WAIT, HYDRATION_WAIT } from "../timeouts";
import { OUTFIT_CATALOGUE, OUTFIT_CATEGORIES } from "../../src/features/identity/clerk/outfit";
import { guest, locale, plantGuestCookie, withDb } from "../landing/home-helpers";

// Contract of #943 part D (C23-C26) and E (C28): the locker at /locker (bible 14.2, the reference
// `Fifth Copy Locker.dc.html`), every item owned, saved through saveClerkOutfit.

const locker = (page: Page) => page.locator("[data-locker]");
const cards = (page: Page) => page.locator("[data-cards] [role='radio']");
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });
const sign = (page: Page) => page.locator("[data-sign]");
const savedOutfit = (id: string) =>
  withDb(async (db) => {
    const { rows } = await db.query<{ outfit: Record<string, string> | null }>(
      `SELECT outfit FROM "User" WHERE id = $1`,
      [id],
    );
    return rows[0]?.outfit ?? null;
  });

async function openLocker(page: Page) {
  await page.goto("/locker");
  await expect(locker(page)).toBeVisible({ timeout: HYDRATION_WAIT });
  // hydrated: the seen cookie is written by the client (C29)
  await expect
    .poll(async () => (await page.context().cookies()).some((c) => c.name === "fc_locker_seen"), {
      timeout: HYDRATION_WAIT,
    })
    .toBe(true);
}

test.beforeEach(async ({ page, context }) => {
  await locale(context, "en");
  // the clerk's frame is the @scene test's; elsewhere the portrait keeps software GL out of the way
  if (!test.info().title.includes("@scene")) await withoutWebGL(page);
});

test.describe("route (C23)", () => {
  test("a visitor is sent to sign in", async ({ page }) => {
    await page.goto("/locker");
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=(%2F|\/)locker$/);
  });

  test("a cookie that resolves to nobody gets the sign-in link, and no guest is created", async ({
    page,
    context,
  }) => {
    await plantGuestCookie(context, "e2e_gone_locker");
    await page.goto("/locker");
    await expect(locker(page)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "SIGN IN" }).last()).toHaveAttribute(
      "href",
      /\/sign-in\?callbackUrl=\/locker/,
    );
    expect(
      await withDb(
        async (db) =>
          (await db.query(`SELECT 1 FROM "User" WHERE id = 'e2e_gone_locker'`)).rowCount,
      ),
    ).toBe(0);
  });
});

test.describe("screen (C24, C26, C28)", () => {
  test("one h1, five tabs, one card per catalogue id, no locked card; NEW on the two new items", async ({
    page,
    context,
  }) => {
    await guest(context);
    await openLocker(page);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText("DRESS YOUR CLERK");
    await expect(page.getByText("FORM 5-C · UNIFORM ISSUE")).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(5);
    for (const category of OUTFIT_CATEGORIES) {
      await tab(page, category.toUpperCase()).click();
      await expect(cards(page)).toHaveCount(OUTFIT_CATALOGUE[category].length);
    }
    await expect(page.locator("[data-locked]")).toHaveCount(0);
    await tab(page, "GLASSES").click();
    await expect(page.locator('[data-item="glasses:square"] >> text=NEW')).toBeVisible();
    await tab(page, "HAT").click();
    await expect(page.locator('[data-item="hat:kepka"] >> text=NEW')).toBeVisible();
    // the next visit has seen them
    await page.reload();
    await expect(locker(page)).toBeVisible();
    await tab(page, "HAT").click();
    await expect(page.locator('[data-item="hat:kepka"]')).not.toContainText("NEW");
  });

  test("tabs and cards: arrows switch tabs (aria-selected) and pick within the radio group", async ({
    page,
    context,
  }) => {
    test.skip(test.info().project.name !== "desktop", "desktop project only");
    await guest(context);
    await openLocker(page);
    await tab(page, "HAIR").focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab(page, "GLASSES")).toHaveAttribute("aria-selected", "true");
    await expect(tab(page, "GLASSES")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(tab(page, "HAIR")).toHaveAttribute("aria-selected", "true");
    await cards(page).first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('[data-item="hair:buzz"]')).toHaveAttribute("aria-checked", "true");
    await expect(page.locator('[data-item="hair:buzz"]')).toBeFocused();
    await expect(locker(page)).toHaveAttribute("data-dirty", "true");
  });

  for (const theme of ["light", "dark"] as const) {
    test(`axe clean, 44px controls (${theme})`, async ({ page, context }) => {
      await context.addCookies([
        { name: "theme", value: theme, url: test.info().project.use.baseURL! },
      ]);
      await guest(context);
      await openLocker(page);
      await expectNoA11yViolations(page);
      const heights = await page
        .locator("[data-locker] button")
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
    });
  }

  test("375: the door stacks over the form, no horizontal scroll", async ({ page, context }) => {
    test.skip(test.info().project.name !== "mobile", "mobile project only");
    await guest(context);
    await openLocker(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    const door = await page.locator("[data-locker] > section").first().boundingBox();
    const form = await page.locator("[data-locker] > section").nth(1).boundingBox();
    expect(form!.y).toBeGreaterThanOrEqual(door!.y + door!.height - 1);
  });

  test("under reduced motion the clerk is the portrait and the ISSUED stamp does not slam", async ({
    page,
    context,
  }) => {
    test.skip(test.info().project.name !== "desktop", "desktop project only");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await guest(context);
    await openLocker(page);
    await expect(page.locator('[data-stage-view="picture"]')).toBeVisible();
    const issued = page.locator('[data-state="equipped"] span').last();
    expect(await issued.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  });
});

test.describe("dressing (C25)", () => {
  test("choose, SIGN & FILE, FILED then ON FILE; after a reload the chosen items are ISSUED", async ({
    page,
    context,
  }) => {
    test.skip(test.info().project.name !== "desktop", "desktop project only");
    const { id } = await guest(context);
    await openLocker(page);
    await expect(sign(page)).toHaveText("ON FILE");
    await tab(page, "HAT").click();
    await page.locator('[data-item="hat:beret"]').click();
    await expect(page.locator('[data-item="hat:beret"]')).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("[data-unsigned]")).toContainText("UNSIGNED CHANGES");
    await expect(sign(page)).toHaveText("SIGN & FILE");
    await sign(page).click();
    await expect(page.getByRole("status").filter({ hasText: "FILED" })).toBeVisible({
      timeout: ACTION_WAIT,
    });
    await expect(sign(page)).toHaveText("ON FILE", { timeout: ACTION_WAIT });
    await expect.poll(() => savedOutfit(id)).toMatchObject({ hat: "beret" });
    await page.reload();
    await tab(page, "HAT").click();
    await expect(page.locator('[data-item="hat:beret"]')).toHaveAttribute("data-state", "equipped");
    await expect(page.locator('[data-item="hat:beret"]')).toContainText("ISSUED");
  });

  test("UNDO CHANGES restores the saved outfit; RANDOM ISSUE picks a valid one", async ({
    page,
    context,
  }) => {
    test.skip(test.info().project.name !== "desktop", "desktop project only");
    await guest(context);
    await openLocker(page);
    await page.locator('[data-item="hair:bald"]').click();
    await expect(locker(page)).toHaveAttribute("data-dirty", "true");
    await page.locator("[data-undo]").click();
    await expect(locker(page)).toHaveAttribute("data-dirty", "false");
    await expect(page.locator('[data-item="hair:side"]')).toHaveAttribute("aria-checked", "true");
    // a random issue differs from the default within a few draws
    await expect(async () => {
      await page.locator("[data-random]").click();
      await expect(locker(page)).toHaveAttribute("data-dirty", "true", { timeout: 500 });
    }).toPass({ timeout: ACTION_WAIT });
    for (const category of OUTFIT_CATEGORIES) {
      await tab(page, category.toUpperCase()).click();
      await expect(cards(page).and(page.locator('[aria-checked="true"]'))).toHaveCount(1);
    }
  });

  test("fc-setcfg carries the whole outfit to the clerk frame @scene", async ({
    page,
    context,
  }) => {
    test.skip(test.info().project.name !== "desktop", "desktop project only");
    await guest(context);
    // a stub clerk page that records what the page posts to it
    await page.route("**/3d/clerk.html*", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<script>window.got=[];addEventListener('message',e=>window.got.push(e.data))</script>",
      }),
    );
    await page.goto("/locker");
    await expect(locker(page)).toBeVisible({ timeout: HYDRATION_WAIT });
    const frame = page.frameLocator("[data-locker] iframe");
    await expect(page.locator("[data-locker] iframe")).toHaveAttribute("src", /locker=1/, {
      timeout: ACTION_WAIT,
    });
    await page.locator('[data-item="hair:quiff"]').click();
    await expect
      .poll(() =>
        frame.locator("html").evaluate(() => {
          const got = (
            window as unknown as { got: { type: string; cfg: Record<string, string> }[] }
          ).got;
          return got.filter((m) => m.type === "fc-setcfg").at(-1)?.cfg ?? null;
        }),
      )
      .toMatchObject({
        hair: "quiff",
        glasses: "round",
        hat: "none",
        clothes: "vest",
        face: "stache",
      });
  });
});
