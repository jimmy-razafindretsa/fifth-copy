import type { BrowserContext, Frame, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { scaled } from "../timeouts";
import {
  disjoint,
  hostRoom,
  phaseOf,
  simulatedPlayers,
  startButton,
  warmRace,
  withoutWebGL,
  type SimulatedPlayer,
} from "./helpers";

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

/** What one audit of the seat HUD found: the moment, and each visible text without an opaque ground. */
type Audit = { moment: string; texts: number; bare: string[] };

/**
 * Runs in the page before its scripts (#693 C2): at each countdown step, the GO stamp and every stamp of
 * the scene area, walks every visible text node under `[data-seat]` up to its first opaque ground (a
 * background colour with alpha 1) on an ancestor below `[data-seat]` itself (whose paper the scene covers),
 * and logs the texts that have none. Opacity is ignored: a stamp slamming in still needs its ground.
 * Screen-reader-only text (1px boxes) is not visible. The scene's own frame is skipped.
 */
function groundAudit() {
  if (window.top !== window) return;
  const audits: Audit[] = [];
  (window as unknown as { __grounds: Audit[] }).__grounds = audits;
  const opaque = (color: string) => {
    if (color === "transparent") return false;
    const slash = /\/\s*([\d.]+%?)\s*\)$/.exec(color);
    if (slash) return slash[1] === "1" || slash[1] === "100%";
    const rgba = /^rgba\([^)]*,\s*([\d.]+)\)$/.exec(color);
    return rgba ? Number(rgba[1]) === 1 : true;
  };
  const audit = (moment: string) => {
    const seat = document.querySelector("[data-seat]");
    if (!seat) return;
    const walker = document.createTreeWalker(seat, NodeFilter.SHOW_TEXT);
    const bare: string[] = [];
    let texts = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const el = node.parentElement;
      if (!text || !el || !el.checkVisibility({ visibilityProperty: true })) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      texts++;
      let grounded = false;
      for (let a: Element | null = el; a && a !== seat; a = a.parentElement) {
        if (opaque(getComputedStyle(a).backgroundColor)) {
          grounded = true;
          break;
        }
      }
      if (!grounded) bare.push(`${text.slice(0, 40)} <${el.tagName.toLowerCase()}>`);
    }
    audits.push({ moment, texts, bare });
  };
  let last: string | null = null;
  new MutationObserver(() => {
    if (!document.querySelector('[data-scene="ready"]')) return;
    const countdown = document.querySelector("[data-countdown]")?.getAttribute("data-countdown");
    const stamp = document.querySelector("[data-stamps]")?.getAttribute("data-stamps");
    const moment = countdown ? `countdown ${countdown}` : stamp ? `stamp ${stamp}` : null;
    if (moment && moment !== last) audit(moment);
    last = moment;
  }).observe(document, { subtree: true, childList: true, attributes: true });
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

  // #693 C2 (bible 14.3 "Over the scene", 7.3): the room is darker than paper, so while the scene shows
  // every HUD text, the digits, the GO stamp and the overtake stamp included, sits on an opaque ground.
  for (const colorScheme of ["light", "dark"] as const) {
    test(`#693 C2 over the scene every HUD text has an opaque ground: countdown, GO, overtake (${colorScheme})`, async ({
      page,
      browser,
    }) => {
      // the host races on paper (one scene at a time); the page under test passes it after GO
      const room = await hostRoom(browser, opened, { before: (host) => withoutWebGL(host) });
      await page.emulateMedia({ colorScheme });
      await page.addInitScript(groundAudit);
      await page.goto(`/race/${room.lobbyId}?scene=pin`);
      await expect(scene(page)).toHaveAttribute("data-scene", "ready", { timeout: SCENE_WAIT });
      await expect(scene(page)).toHaveAttribute("data-scene-preset", "low");
      await expect(startButton(room.host)).toBeEnabled();
      await warmRace(room.host, room.lobbyId);
      await startButton(room.host).click();

      await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", {
        timeout: scaled(15_000),
      });
      await expect(page.locator("[data-countdown]")).toHaveCount(0, { timeout: scaled(10_000) });
      const strip = page.getByRole("textbox", { name: "Text to type" });
      await expect(strip).toBeFocused();
      const text = (await page.locator("[data-telex] [data-state]").allTextContents()).join("");
      await page.keyboard.type(Array.from(text).slice(0, 3).join(""));
      await expect(page.locator("[data-stamps]")).toHaveAttribute("data-stamps", "overtake", {
        timeout: scaled(10_000),
      });

      const audits = await page.evaluate(
        () => (window as unknown as { __grounds: Audit[] }).__grounds,
      );
      const moments = audits.map((a) => a.moment);
      for (const moment of ["countdown go", "stamp overtake"]) expect(moments).toContain(moment);
      expect(
        moments.some((m) => /^countdown [123]$/.test(m)),
        "a countdown digit",
      ).toBe(true);
      for (const a of audits) {
        expect(a.texts, `${a.moment}: texts seen`).toBeGreaterThan(5);
        expect(a.bare, `${a.moment}: texts without an opaque ground`).toEqual([]);
      }
    });
  }
});
