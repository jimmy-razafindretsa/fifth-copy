import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { scaled } from "../timeouts";
import { hostRoom, simulatedPlayers, type SimulatedPlayer } from "./helpers";

// Contract of #927 C5, C6 (bible 11.1, 11.3; Art Direction slide 05 "3D render · small lobbies"): the seat
// scene stages a small room for its owner and keeps the real ring from 14 players. C5 opens `/3d/seat.html`
// top-level (as e2e/race/scene-probe.spec.ts: `parent === window`, so messages posted by the page itself pass
// the origin and source checks) at a forced LOW preset, drives it with `fc-race-init` then `fc-race-state`,
// and reads the layout the page reports on `<html>`. C6 checks the race page's own report of the scene.
// `@scene`, desktop project only (software WebGL), every wait through e2e/timeouts.ts.

const SCENE_WAIT = scaled(60_000);

/** A room of `n` desks numbered 1..n, you at desk 1, waiting. */
const room = (n: number) => ({
  self: 1,
  desks: Array.from({ length: n }, (_, k) => ({
    desk: k + 1,
    tint: "desk-color-1",
    status: "typing",
    rank: null,
    progress: 0,
  })),
  lamp: null,
  phase: "waiting",
});

async function post(page: Page, msg: Record<string, unknown>) {
  await page.evaluate((m) => postMessage({ v: 1, ...m }, location.origin), msg);
}

const html = (page: Page) => page.locator("html");

/** The layout `<html>` reports for a room of `n` (C5). */
async function expectLayout(
  page: Page,
  n: number,
  want: { layout: string; fov?: string; ring?: string },
) {
  const root = html(page);
  await expect(root).toHaveAttribute("data-seats", String(n), { timeout: SCENE_WAIT });
  await expect(root).toHaveAttribute("data-layout", want.layout);
  if (want.fov) await expect(root).toHaveAttribute("data-fov", want.fov);
  if (want.ring) await expect(root).toHaveAttribute("data-ring", want.ring);
  if (want.layout === "staged")
    await expect(root, `every rival of ${n} in view`).toHaveAttribute(
      "data-rivals-in-view",
      String(n - 1),
    );
}

test.describe("#927 the 3D room adapts to small lobbies", { tag: "@scene" }, () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project only (software WebGL)");
  test.slow();

  test.beforeEach(async ({ page }) => {
    const webgl = await page.evaluate(
      () => !!document.createElement("canvas").getContext("webgl2"),
    );
    test.skip(!webgl, "no WebGL2 in this browser");
  });

  test("C5 the seat page stages up to 13, rings from 14, follows the aspect, and evens the overview", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/3d/seat.html?preset=low");
    await post(page, { type: "fc-race-init", view: room(2), preset: "low", motion: "full" });
    await expect(html(page)).toHaveAttribute("data-room", "ready", { timeout: SCENE_WAIT });

    await expectLayout(page, 2, { layout: "staged", fov: "62", ring: "4.35" });
    await post(page, { type: "fc-race-state", view: room(4) });
    await expectLayout(page, 4, { layout: "staged", fov: "62" });
    await post(page, { type: "fc-race-state", view: room(13) });
    await expectLayout(page, 13, { layout: "staged", fov: "100" });
    await post(page, { type: "fc-race-state", view: room(14) });
    await expectLayout(page, 14, { layout: "ring", fov: "71.6", ring: "6.9" });
    await post(page, { type: "fc-race-state", view: room(30) });
    await expectLayout(page, 30, { layout: "ring", fov: "84", ring: "6.9" });

    // the FOV follows the window's aspect without a new message
    await post(page, { type: "fc-race-state", view: room(6) });
    await expectLayout(page, 6, { layout: "staged", fov: "71.6" });
    await page.setViewportSize({ width: 1024, height: 768 });
    await expectLayout(page, 6, { layout: "staged", fov: "87.8" });

    // the overview (projector, spectators): even spacing, FOV 55
    await post(page, {
      type: "fc-race-init",
      view: room(4),
      preset: "low",
      motion: "full",
      camera: "over",
    });
    await expectLayout(page, 4, { layout: "even", fov: "55", ring: "4.35" });
  });

  test.describe("C6 on the race page", () => {
    const opened: BrowserContext[] = [];
    let players: SimulatedPlayer[] = [];
    test.afterEach(async () => {
      for (const p of players.splice(0)) p.close();
      for (const context of opened.splice(0)) await context.close();
    });

    const scene = (page: Page) => page.locator("[data-scene]");

    test("a room of 8 typists widens the seat FOV above 62, at most 100", async ({
      page,
      browser,
    }) => {
      const lobby = await hostRoom(browser, opened);
      // host + 6 simulated players + this page
      players = await simulatedPlayers(6, lobby.lobbyId);
      await page.goto(`/race/${lobby.lobbyId}?scene=pin`);
      const view = scene(page);
      await expect(view).toHaveAttribute("data-scene", "ready", { timeout: SCENE_WAIT });
      await expect(view).toHaveAttribute("data-scene-desks", "8");
      const fov = Number(await view.getAttribute("data-scene-fov"));
      expect(fov).toBeGreaterThan(62);
      expect(fov).toBeLessThanOrEqual(100);
      await expect(view).toHaveAttribute("data-scene-self", "hidden");
    });
  });
});
