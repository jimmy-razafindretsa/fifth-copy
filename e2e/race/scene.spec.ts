import type { BrowserContext, Frame, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { scaled } from "../timeouts";
import { disjoint, hostRoom, simulatedPlayers, type SimulatedPlayer } from "./helpers";

// Contract of #563 C2, C4, C5 (ADR 0017 option A, bible 11.3, 12, 7.3, 7.4, 8): the seat view loads the
// 3D seat scene after the HUD, behind a stamped loading card, and the scene reports its seat POV. Headless
// CI renders WebGL in software (#690): every test pins `?scene=pin` (LOW, no benchmark, no frame budget:
// SwiftShader draws LOW under the 18 fps floor, #695 C9), runs on the desktop
// project only, mounts one scene at a time and waits with scaled deadlines.

const SCENE_WAIT = scaled(60_000);
const scene = (page: Page) => page.locator("[data-scene]");
const loadingCard = (page: Page) => page.locator("[data-loading-card]");

/** The seat scene's same-origin frame (`/3d/seat.html`). */
async function seatFrame(page: Page): Promise<Frame> {
  await expect
    .poll(() => page.frames().some((f) => f.url().includes("/3d/seat.html")), {
      timeout: SCENE_WAIT,
    })
    .toBe(true);
  return page.frames().find((f) => f.url().includes("/3d/seat.html"))!;
}

test.describe("#563 seat scene", { tag: "@scene" }, () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project only (software WebGL)");
  test.slow();

  const opened: BrowserContext[] = [];
  let players: SimulatedPlayer[] = [];
  test.afterEach(async () => {
    for (const p of players.splice(0)) p.close();
    for (const context of opened.splice(0)) await context.close();
  });

  test.beforeEach(async ({ page }) => {
    const webgl = await page.evaluate(
      () => !!document.createElement("canvas").getContext("webgl2"),
    );
    test.skip(!webgl, "no WebGL2 in this browser (fallback.spec.ts covers that path)");
  });

  test("C2 the stamped loading card shows until the scene is ready, never over the typing strip", async ({
    page,
    browser,
  }) => {
    const room = await hostRoom(browser, opened);
    // hold three.js back: the card must be on screen while the scene loads
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/3d/vendor/three.module.min.js", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto(`/race/${room.lobbyId}?scene=pin`);

    const card = loadingCard(page);
    await expect(card).toBeVisible({ timeout: scaled(20_000) });
    await expect(card).toHaveAttribute("aria-busy", "true");
    await expect(card).toHaveAttribute("role", "status");
    await expect(card.locator("[data-stamp-tone]")).toHaveText("LOADING THE RING ROOM");
    // `race.didYouKnow` is empty until #383: no tip row
    await expect(card.locator("[data-did-you-know]")).toHaveCount(0);
    await expect(scene(page)).toHaveAttribute("data-scene", "loading");
    const cardBox = (await card.boundingBox())!;
    for (const part of ["[data-telex]", "[data-sheet]", "[data-machine]"]) {
      const b = (await page.locator(part).boundingBox())!;
      expect(disjoint(cardBox, b), `loading card vs ${part}`).toBe(true);
    }
    await expectNoA11yViolations(page);

    release();
    await expect(scene(page)).toHaveAttribute("data-scene", "ready", { timeout: SCENE_WAIT });
    await expect(card).toHaveCount(0);
    await expect(page.locator('[data-notice="no-scene"]')).toHaveCount(0);
  });

  test("C4 the seat POV: FOV 62, the room's desks, the forced preset, your clerk hidden", async ({
    page,
    browser,
  }) => {
    const room = await hostRoom(browser, opened);
    players = await simulatedPlayers(1, room.lobbyId);
    await page.goto(`/race/${room.lobbyId}?scene=pin`);
    const view = scene(page);
    await expect(view).toHaveAttribute("data-scene", "ready", { timeout: SCENE_WAIT });
    await expect(view).toHaveAttribute("data-scene-fov", "62");
    // host + simulated player + this page
    await expect(view).toHaveAttribute("data-scene-desks", "3");
    await expect(view).toHaveAttribute("data-scene-preset", "low");
    await expect(view).toHaveAttribute("data-scene-self", "hidden");
    // decorative and out of the way: never focusable, never under the pointer
    const frame = view.locator("iframe");
    await expect(frame).toHaveAttribute("aria-hidden", "true");
    await expect(frame).toHaveAttribute("tabindex", "-1");
    expect(await view.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
    await expect(page.locator("[data-loading-card]")).toHaveCount(0);
    // the HUD stays in front of the scene
    await expect(page.locator("[data-race-card]")).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("C5 reduced motion crosses the bridge: data-motion=reduce and a steady bulb", async ({
    page,
    browser,
  }) => {
    const room = await hostRoom(browser, opened);
    await page.goto(`/race/${room.lobbyId}?scene=pin`);
    await expect(scene(page)).toHaveAttribute("data-scene", "ready", { timeout: SCENE_WAIT });
    await expect(scene(page)).toHaveAttribute("data-scene-motion", "full");
    const seat = await seatFrame(page);
    await expect
      .poll(() => seat.evaluate(() => document.documentElement.dataset.bulb))
      .toBe("stutter");

    // the page's own setting (#28): `<html data-motion="reduce">`, passed as fc-race-motion
    await page.evaluate(() => document.documentElement.setAttribute("data-motion", "reduce"));
    await expect(scene(page)).toHaveAttribute("data-scene-motion", "reduce");
    await expect
      .poll(() => seat.evaluate(() => document.documentElement.dataset.bulb))
      .toBe("steady");
    await expect
      .poll(() => seat.evaluate(() => document.documentElement.dataset.motion))
      .toBe("reduce");

    // and back
    await page.evaluate(() => document.documentElement.removeAttribute("data-motion"));
    await expect(scene(page)).toHaveAttribute("data-scene-motion", "full");
    await expect
      .poll(() => seat.evaluate(() => document.documentElement.dataset.bulb))
      .toBe("stutter");
  });

  test("C5 the OS setting (prefers-reduced-motion: reduce) from the first frame", async ({
    browser,
  }) => {
    const room = await hostRoom(browser, opened);
    const context = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      reducedMotion: "reduce",
    });
    opened.push(context);
    const page = await context.newPage();
    await page.goto(`/race/${room.lobbyId}?scene=pin`);
    await expect(scene(page)).toHaveAttribute("data-scene", "ready", { timeout: SCENE_WAIT });
    await expect(scene(page)).toHaveAttribute("data-scene-motion", "reduce");
    const seat = await seatFrame(page);
    expect(await seat.evaluate(() => document.documentElement.dataset.bulb)).toBe("steady");
    expect(
      await seat.evaluate(() => getComputedStyle(document.querySelector(".grain")!).animationName),
    ).toBe("none");
  });
});
