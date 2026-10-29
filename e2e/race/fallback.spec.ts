import type { BrowserContext, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { scaled } from "../timeouts";
import { expectSeatShellLayout, hostRoom, withoutWebGL } from "./helpers";

// Contract of #563 C3 (ADR 0013 2D fallback, bible 7.4 extension #560, 14.3): without WebGL2 the seat
// view never loads the scene (no frame, no /3d/ request), stays on its paper backdrop and shows the
// `no-scene` notice row exactly once; the #561 seat shell holds as it is. Desktop project only: the
// test sets its own viewports.

const NO_SCENE = "NO PICTURE FROM THE ROOM · KEEP TYPING";

test.describe("#563 C3 seat view without WebGL2", () => {
  test.skip(
    ({ viewport }) => viewport?.width !== 1280,
    "desktop project; tests set their viewports",
  );

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  async function seatWithoutWebGL(page: Page, browser: Parameters<typeof hostRoom>[0]) {
    const room = await hostRoom(browser, opened);
    await withoutWebGL(page);
    const embeds: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.startsWith("/3d/")) embeds.push(r.url());
    });
    await page.goto(`/race/${room.lobbyId}`);
    await expect(page.getByRole("status").filter({ hasText: "WAITING FOR THE HOST" })).toBeVisible({
      timeout: scaled(20_000),
    });
    return { room, embeds };
  }

  test("the scene is not loaded; paper backdrop and the no-scene notice, once", async ({
    page,
    browser,
  }) => {
    const { embeds } = await seatWithoutWebGL(page, browser);
    const notice = page.locator('[data-notice="no-scene"]');
    await expect(notice).toHaveCount(1);
    await expect(notice).toHaveText(NO_SCENE);
    await expect(notice).toHaveAttribute("role", "status");
    await expect(page.locator("[data-seat][data-backdrop='paper']")).toBeVisible();
    await expect(page.locator("[data-scene]")).toHaveCount(0);
    await expect(page.locator("[data-loading-card]")).toHaveCount(0);
    // the room's later events (a second typist) never bring the scene or a second notice
    await page.waitForLoadState("networkidle");
    await expect(notice).toHaveCount(1);
    expect(page.frames()).toHaveLength(1);
    expect(embeds, "no /3d/ request").toEqual([]);
    // the notice sits in the scene slot, outside the live state (#561's status checks stay true)
    await expect(page.locator("[data-seat-status] [data-notice='no-scene']")).toHaveCount(0);
    await expectNoA11yViolations(page);
  });

  test("the #561 seat shell holds: every HUD part on screen at 1280, 1024 and 768", async ({
    page,
    browser,
  }) => {
    await seatWithoutWebGL(page, browser);
    await expect(page.locator('[data-notice="no-scene"]')).toHaveCount(1);
    await expectSeatShellLayout(page);
  });

  test("French: PAS D'IMAGE DE LA SALLE · CONTINUE DE TAPER", async ({ page, browser }) => {
    await page
      .context()
      .addCookies([{ name: "locale", value: "fr", url: test.info().project.use.baseURL! }]);
    const room = await hostRoom(browser, opened);
    await withoutWebGL(page);
    await page.goto(`/race/${room.lobbyId}`);
    await expect(page.locator('[data-notice="no-scene"]')).toHaveText(
      "PAS D'IMAGE DE LA SALLE · CONTINUE DE TAPER",
      { timeout: scaled(20_000) },
    );
  });
});
