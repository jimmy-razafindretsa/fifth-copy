import type { Page, Request } from "@playwright/test";
import {
  expect,
  expectNoA11yViolations,
  isNotFoundActionAbort,
  test,
  type FailedRequest,
} from "./fixtures";
import { ACTION_WAIT } from "./timeouts";

// Card 397 (not-found part): the in-world form 404 with the Major in 3D (bible 10.3, 14.3).
const TITLE = "ARE YOU LOST, KID?";
const TITLE_FR = "T'ES PERDU, LE JEUNE ?";
const MISSING = "/no-such-desk";

const isLocaleAction = (r: Request) =>
  r.method() === "POST" && new URL(r.url()).pathname === MISSING && !!r.headers()["next-action"];

/**
 * Clicks a locale toggle and waits until its `setLocale` server action (a POST to the page's own
 * path) has settled (#647): finished, or cancelled by the reload Next does after an action on a 404
 * document (`response.finished()` never resolves then, so the request's own events are awaited).
 * Clicking again while the previous action is still in flight, or closing the page with one in
 * flight, would abort it for a reason of the test's own.
 */
async function switchLocale(page: Page, name: "FR" | "EN") {
  const settled = Promise.race(
    (["requestfinished", "requestfailed"] as const).map((event) =>
      page.waitForEvent(event, { predicate: isLocaleAction, timeout: ACTION_WAIT }),
    ),
  );
  await page.getByRole("button", { name, exact: true }).click();
  await settled;
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.describe("not found (#397)", () => {
  test("C1 an unknown route answers 404 with the form-404 docket and the two ways back", async ({
    page,
  }) => {
    const response = await page.goto(MISSING);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
    await expect(page.getByText("MINISTRY OF TYPING · FORM 404")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "FILE NOT FOUND" })).toBeVisible();
    await expect(page.locator("dd")).toHaveText(["404", "NOT ON FILE", "UNASSIGNED"]);
    await expect(page.getByRole("link", { name: "REPORT TO YOUR DESK" })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(page.getByRole("link", { name: "JOIN WITH CODE →" })).toHaveAttribute(
      "href",
      "/#play",
    );
    await expect(page.locator("header")).toBeVisible();
  });

  test("C2 the Major's embed is the local reference page in a titled, lazily mounted frame", async ({
    page,
    request,
  }) => {
    await page.goto(MISSING);
    const frame = page.locator("iframe");
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute("title", "The Major, watching, in 3D");
    await expect(frame).toHaveAttribute("data-embed", "mounted", { timeout: 30_000 });
    await expect(frame).toHaveAttribute("src", "/3d/major.html");
    const res = await request.get("/3d/major.html");
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("/3d/vendor/three.module.min.js");
    expect(html).not.toMatch(/unpkg|googleapis/);
    await expect(page.getByText("THE MAJOR · HE'S WATCHING YOUR CURSOR")).toBeVisible();
  });

  test("C3 the stamp slams in at -6° and stays still under reduced motion", async ({ page }) => {
    await page.goto(MISSING);
    const stamp = page.getByRole("status").filter({ hasText: "FILE NOT FOUND" });
    expect(await stamp.evaluate((el) => getComputedStyle(el).animationName)).toMatch(/fcSlam$/);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    const still = page.getByRole("status").filter({ hasText: "FILE NOT FOUND" });
    expect(await still.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    expect(await still.evaluate((el) => getComputedStyle(el).transform)).not.toBe("none");
  });

  test("C4 French through the header toggle", async ({ page }) => {
    await page.goto(MISSING);
    await expect(page.locator("iframe")).toHaveAttribute("data-embed", "mounted", {
      timeout: 30_000,
    });
    await switchLocale(page, "FR");
    await expect(page.getByRole("heading", { level: 1, name: TITLE_FR })).toBeVisible({
      timeout: ACTION_WAIT,
    });
    await expect(page.getByRole("status").filter({ hasText: "DOSSIER INTROUVABLE" })).toBeVisible();
    await switchLocale(page, "EN");
    await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible({
      timeout: ACTION_WAIT,
    });
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`C5 ${scheme}: accessible, no horizontal scroll`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(MISSING);
      await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
      await expectNoA11yViolations(page);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  }
});

// Contract of #610: the Major's stage paints the shared `sun-rays` utility of #25 (bible 6), the same
// recipe as the /design plate, and nothing under `prefers-contrast: more`.
const majorStage = (page: Page) => page.locator("iframe").locator("..");

const backgroundOf = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundImage);

test.describe("not-found sun-ray stage (#610)", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`C2 ${scheme}: the Major's stage paints the /design sun-rays plate`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/design");
      const plate = await backgroundOf(page, '[data-plate="sun-rays"]');
      expect(plate).toContain("repeating-conic-gradient");
      await page.goto(MISSING);
      const stage = await majorStage(page).evaluate((el) => {
        const s = getComputedStyle(el);
        // unchanged layout: beside the file above 900px, stacked over it below
        const stacked = window.innerWidth <= 900;
        return {
          bgImage: s.backgroundImage,
          minHeight: s.minHeight,
          rule: stacked ? s.borderBottomWidth : s.borderRightWidth,
          stacked,
        };
      });
      expect(stage.bgImage).toBe(plate);
      expect(stage.minHeight).toBe(stage.stacked ? "440px" : "560px");
      expect(stage.rule).toBe("2px");
    });
  }

  test("C3 under prefers-contrast: more the Major's stage paints no rays", async ({ page }) => {
    await page.emulateMedia({ contrast: "more" });
    await page.goto(MISSING);
    expect(await majorStage(page).evaluate((el) => getComputedStyle(el).backgroundImage)).toBe(
      "none",
    );
  });
});

// #647: the guard's one exemption for this page, an action POST cut short by the page's own reload.
test.describe("not-found action abort guard (#647)", () => {
  const abort: FailedRequest = {
    errorText: "net::ERR_ABORTED",
    path: MISSING,
    method: "POST",
    nextAction: "40f143d35ac9bd65d8d1bd0c057d77cab0e90fc8bb",
    rsc: null,
    status: 404,
    contentType: "text/x-component",
  };
  const notFound = new Set([MISSING]);

  test("exempts an aborted action POST answered 404 text/x-component on a 404 document", () => {
    expect(isNotFoundActionAbort(abort, notFound)).toBe(true);
  });

  for (const [name, change] of [
    ["a page that did not answer 404", { path: "/lobby/ABCD" }],
    ["another network error", { errorText: "net::ERR_CONNECTION_REFUSED" }],
    ["a POST without next-action", { nextAction: null }],
    ["a GET", { method: "GET" }],
    ["no response", { status: null, contentType: null }],
    ["a 500 response", { status: 500 }],
    ["an HTML response", { contentType: "text/html; charset=utf-8" }],
  ] as const) {
    test(`flags ${name}`, () => {
      expect(isNotFoundActionAbort({ ...abort, ...change }, notFound)).toBe(false);
    });
  }
});
