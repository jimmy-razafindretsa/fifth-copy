import type { Page, Request } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { SAVED, saveOutfit, withoutWebGL } from "../results/helpers";
import { ACTION_WAIT } from "../timeouts";
import {
  entry,
  guest,
  hints,
  locale,
  menu,
  openMenu,
  overlaps,
  playerDocket,
  stage,
} from "./home-helpers";

// Contract of #946: the clerk stage on the Home menu (ADR 0013: menu first, 3D behind, paper fallback).

const desktopOnly = () => test.skip(test.info().project.name !== "desktop", "desktop project only");

/** Records every request for a /3d/ page. */
function threeD(page: Page): Request[] {
  const seen: Request[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/3d/")) seen.push(r);
  });
  return seen;
}

test.beforeEach(async ({ context }) => {
  await locale(context, "en");
});

test("C1 the stage: rays, podium, decorative, no focus and no pointer events", async ({
  page,
  context,
}) => {
  desktopOnly();
  await withoutWebGL(page);
  await guest(context);
  await openMenu(page);
  await expect(stage(page)).toBeVisible();
  await expect(stage(page)).toHaveAttribute("aria-hidden", "true");
  await expect(stage(page)).toHaveCSS("pointer-events", "none");
  expect(await stage(page).locator("a, button, [tabindex]").count()).toBe(0);
  // the sun-ray layer paints a conic gradient; under prefers-contrast: more it paints nothing
  const rays = stage(page).locator("> div").first();
  expect(await rays.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(
    "conic-gradient",
  );
  await page.emulateMedia({ contrast: "more" });
  expect(await rays.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe("none");
});

test("C2 with WebGL2 the stage mounts the clerk in the saved uniform @scene", async ({
  page,
  context,
}) => {
  desktopOnly();
  const { id } = await guest(context);
  await saveOutfit(id, SAVED);
  // the frame's page is not under test: hold it pending
  await page.route("**/3d/clerk.html*", () => {});
  await openMenu(page);
  const frame = stage(page).locator("iframe");
  await expect(frame).toHaveAttribute("src", /^\/3d\/clerk\.html\?cfg=/, { timeout: ACTION_WAIT });
  expect(decodeURIComponent((await frame.getAttribute("src"))!)).toContain(JSON.stringify(SAVED));
  await expect(stage(page)).toHaveAttribute("data-stage-view", "clerk");
});

test("C3 menu first: no iframe in the server HTML; Enter on the first entry works with the embed held", async ({
  page,
  context,
}) => {
  desktopOnly();
  await guest(context);
  const html = await (await page.request.get("/")).text();
  expect(html).toContain("data-home-menu");
  expect(html).not.toContain("<iframe");
  await page.route("**/3d/clerk.html*", () => {});
  await openMenu(page);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-entry")))
    .toBe("play");
  // the first entry is focusable and live while the embed hangs (PLAY's own landing is the matchmaking
  // spec's; PRACTICE is the same action path without the shared public room)
  await entry(page, "practice").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/lobby\/[A-Z]{3}-\d{4}$/, { timeout: ACTION_WAIT });
});

test("C4 without WebGL2 the portrait stands on the podium and no /3d/ page is asked", async ({
  page,
  context,
}) => {
  desktopOnly();
  const requests = threeD(page);
  await withoutWebGL(page);
  await guest(context);
  await openMenu(page);
  await expect(stage(page)).toHaveAttribute("data-stage-view", "picture");
  await expect(stage(page).locator("svg, img").first()).toBeVisible();
  await page.waitForTimeout(500);
  expect(requests).toHaveLength(0);
});

test("C5 under reduced motion the stage shows the picture and asks no /3d/ page", async ({
  page,
  context,
}) => {
  desktopOnly();
  const requests = threeD(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await guest(context);
  await openMenu(page);
  await expect(stage(page)).toHaveAttribute("data-stage-view", "picture");
  await page.waitForTimeout(500);
  expect(requests).toHaveLength(0);
});

test("C5 below 768px the stage is not shown and no /3d/ page is asked", async ({
  page,
  context,
}) => {
  test.skip(test.info().project.name !== "mobile", "mobile project only");
  const requests = threeD(page);
  await guest(context);
  await openMenu(page);
  await expect(stage(page)).toBeHidden();
  await page.waitForTimeout(500);
  expect(requests).toHaveLength(0);
});

test("C7 the stage keeps to the right half and overlaps neither the menu, the docket nor the bar", async ({
  page,
  context,
}) => {
  test.skip(test.info().project.name === "mobile", "tablet and desktop");
  await withoutWebGL(page);
  await guest(context);
  await openMenu(page);
  const width = page.viewportSize()!.width;
  const box = await stage(page).boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(width / 2 - 1);
  expect(overlaps(box, await menu(page).boundingBox())).toBe(false);
  // the docket and the bar sit over the stage ground, not over the podium or the clerk
  const podium = await stage(page).locator("> div").nth(1).boundingBox();
  expect(overlaps(podium, await playerDocket(page).boundingBox())).toBe(false);
  expect(
    overlaps(
      await stage(page).locator("> div").nth(2).boundingBox(),
      await hints(page).boundingBox(),
    ),
  ).toBe(false);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

for (const theme of ["light", "dark"] as const) {
  test(`C10 axe clean with the stage present (${theme})`, async ({ page, context }) => {
    desktopOnly();
    await withoutWebGL(page);
    await context.addCookies([
      { name: "theme", value: theme, url: test.info().project.use.baseURL! },
    ]);
    await guest(context);
    await openMenu(page);
    await expect(stage(page)).toBeVisible();
    await expectNoA11yViolations(page);
  });
}
