import type { BrowserContext, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { scaled } from "../timeouts";
import { hostRoom, phaseOf, SEAT_HUD, withoutWebGL } from "./helpers";

// Contract of #210 C1 (integration of #558, #560, #561, #562/ADR 0017, #563; bible 14.3, 7.7, 7.4, 11.3,
// 12): a guest who joined a lobby from the landing opens `/race/<lobbyId>` and gets the whole seat view in
// the `waiting` phase, the strip, sheet, keyboard, nixie counters, race card and Abandon control, first
// with the 3D seat scene (loading card, then `data-scene-fov="62"`), then with WebGL2 stubbed out (the
// no-scene notice over the same HUD). The scene test pins `?scene=pin` like e2e/race/scene.spec.ts
// (software WebGL in CI reads under the probe floor, #690, #695 C9) and carries `@scene` (e2e/fixtures.ts
// keeps the scene off elsewhere). Desktop project only; every wait through e2e/timeouts.ts.

const SCENE_WAIT = scaled(60_000);
const NO_SCENE = "NO PICTURE FROM THE ROOM · KEEP TYPING";

/** The HUD the contract names, in the `waiting` phase. */
async function expectWaitingHud(page: Page) {
  await expect(page.getByRole("status").filter({ hasText: "WAITING FOR THE HOST" })).toBeVisible({
    timeout: scaled(20_000),
  });
  await expect(phaseOf(page)).toHaveAttribute("data-phase", "waiting");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^SEAT VIEW · DESK \d{2}$/);
  for (const part of ["telex", "sheet", "machine", "nixie", "raceCard", "abandon"] as const) {
    await expect(SEAT_HUD[part](page), part).toBeVisible();
  }
  // the Abandon control exists before the start, disabled until GO (#561)
  await expect(SEAT_HUD.abandon(page)).toHaveAttribute("data-abandon", "disabled");
}

/** The page under test joins the host's room from the landing, as a guest typing the code (#107 flow). */
async function joinFromLanding(page: Page, code: string) {
  await page.goto("/");
  const form = page.getByRole("form", { name: "Join with code" });
  await form.getByLabel("JOIN WITH CODE", { exact: true }).pressSequentially(code);
  await form.getByRole("button", { name: "JOIN →", exact: true }).click();
  await page.waitForURL(`**/lobby/${code}`);
  await expect(page.getByRole("list", { name: "Typists in the room" })).toBeVisible();
}

test.describe("#210 C1 a guest from the lobby into the seat view", () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project only (software WebGL)");

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  test(
    "with the scene: the HUD, the loading card, then the seat POV at FOV 62",
    { tag: "@scene" },
    async ({ page, browser }) => {
      test.slow();
      const webgl = await page.evaluate(
        () => !!document.createElement("canvas").getContext("webgl2"),
      );
      test.skip(!webgl, "no WebGL2 in this browser (the fallback test covers that path)");

      const room = await hostRoom(browser, opened);
      await joinFromLanding(page, room.code);

      // hold three.js back so the loading card is observed before the scene is ready
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      await page.route("**/3d/vendor/three.module.min.js", async (route) => {
        await gate;
        await route.continue();
      });
      await page.goto(`/race/${room.lobbyId}?scene=pin`);

      await expectWaitingHud(page);
      const card = page.locator("[data-loading-card]");
      await expect(card).toBeVisible({ timeout: scaled(20_000) });
      await expect(card).toHaveAttribute("role", "status");
      await expect(page.locator("[data-scene]")).toHaveAttribute("data-scene", "loading");

      release();
      const scene = page.locator("[data-scene]");
      await expect(scene).toHaveAttribute("data-scene", "ready", { timeout: SCENE_WAIT });
      await expect(scene).toHaveAttribute("data-scene-fov", "62");
      await expect(card).toHaveCount(0);
      await expect(page.locator('[data-notice="no-scene"]')).toHaveCount(0);
      // the same HUD in front of the ready scene, still waiting for the host
      await expectWaitingHud(page);
      await expectNoA11yViolations(page);
    },
  );

  test("WebGL2 stubbed out: the no-scene notice and the same HUD", async ({ page, browser }) => {
    const room = await hostRoom(browser, opened);
    await joinFromLanding(page, room.code);
    await withoutWebGL(page);
    await page.goto(`/race/${room.lobbyId}`);

    await expectWaitingHud(page);
    const notice = page.locator('[data-notice="no-scene"]');
    await expect(notice).toHaveCount(1);
    await expect(notice).toHaveText(NO_SCENE);
    await expect(page.locator("[data-seat][data-backdrop='paper']")).toBeVisible();
    await expect(page.locator("[data-scene]")).toHaveCount(0);
    await expect(page.locator("[data-loading-card]")).toHaveCount(0);
    await expectNoA11yViolations(page);
  });
});
