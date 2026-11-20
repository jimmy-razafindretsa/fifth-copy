import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { scaled } from "../timeouts";
import {
  hostRoom,
  phaseOf,
  simulatedPlayers,
  startButton,
  warmRace,
  type SimulatedPlayer,
  openRace,
} from "./helpers";

// Contract of #999 C63-C65 (bible 10.2 "Sabotage throw", 8 flash rule, 15 `fc-race-sabotage` /
// `fc-scene-sabotage`, ADR 0017 SCENE_PROTOCOL 2). Two halves:
// - the race page (C63): a guest seated by rank (as e2e/race/bonus.spec.ts: 2nd of 3 -> Extra Paperwork on
//   the leader, 3rd of 3 -> Smoke Break on everyone ahead, 6th of 8 -> Exemption on itself) plays its card
//   over the race server while its seat scene runs (`?scene=pin`); the scene acks with `fc-scene-sabotage`,
//   which the page writes to `data-scene-sabotage` (`kind:from:to:mode`): `throw`, and `static` once
//   reduced motion is emulated. The scene must be ready before GO: a play that waits in the embed's inbox
//   while the room is built is dropped, never played late.
// - the embed on its own (C64, C65): `/3d/seat.html` opened top-level (as e2e/race/scene-lod.spec.ts), driven
//   with `fc-race-*` messages; it reports on `<html>`: `data-sabotage` (the ack), `data-throws-flying`,
//   `-peak` (most in flight since the last play), `-landed`, `-puffs` and `data-throw-cover` (the largest
//   viewport share of a thrown object since the last play).
// `@scene`, desktop project only (software WebGL), every wait through e2e/timeouts.ts.

const SCENE_WAIT = scaled(60_000);

const html = (page: Page) => page.locator("html");
const num = async (page: Page, name: string) =>
  Number((await html(page).getAttribute(`data-${name}`)) ?? NaN);

/** A running room of `n` desks numbered 1..n, you at desk 1. */
const room = (n: number, phase = "running") => ({
  self: 1,
  desks: Array.from({ length: n }, (_, k) => ({
    desk: k + 1,
    tint: "desk-color-1",
    status: "typing",
    rank: k + 1,
    progress: 0,
  })),
  lamp: null,
  phase,
});

async function post(page: Page, msg: Record<string, unknown>) {
  await page.evaluate((m) => postMessage({ v: 2, ...m }, location.origin), msg);
}

async function openSeat(page: Page, n: number, motion = "full") {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/3d/seat.html?preset=low");
  await post(page, { type: "fc-race-init", view: room(n), preset: "low", motion });
  await expect(html(page)).toHaveAttribute("data-room", "ready", { timeout: SCENE_WAIT });
  await expect(html(page)).toHaveAttribute("data-seats", String(n), { timeout: SCENE_WAIT });
  await expect(html(page)).toHaveAttribute("data-throws-landed", "0", { timeout: SCENE_WAIT });
}

const sabotage = (page: Page, kind: string, from: number, to: number[]) =>
  post(page, { type: "fc-race-sabotage", kind, from, to });

test.describe("#999 sabotage throws, the embed on its own", { tag: "@scene" }, () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project only (software WebGL)");
  test.slow();

  test.beforeEach(async ({ page }) => {
    const webgl = await page.evaluate(
      () => !!document.createElement("canvas").getContext("webgl2"),
    );
    test.skip(!webgl, "no WebGL2 in this browser");
  });

  test("C62 C65 each kind is thrown, lands where its bible line says, and every object goes at race end", async ({
    page,
  }) => {
    await openSeat(page, 6);
    // Extra Paperwork: desk 3 tosses a bundle onto the leader's desk (desk 2), where it stays
    await sabotage(page, "extra-paperwork", 3, [2]);
    await expect(html(page)).toHaveAttribute("data-sabotage", "extra-paperwork:3:2:throw");
    await expect(html(page)).toHaveAttribute("data-throws-peak", "1", { timeout: SCENE_WAIT });
    await expect(html(page)).toHaveAttribute("data-throws-flying", "0", { timeout: SCENE_WAIT });
    await expect(html(page)).toHaveAttribute("data-throws-landed", "1");
    // Exemption: desk 5 crumples a sheet over its shoulder to the floor, where it stays
    await sabotage(page, "exemption", 5, [5]);
    await expect(html(page)).toHaveAttribute("data-sabotage", "exemption:5:5:throw");
    await expect(html(page)).toHaveAttribute("data-throws-peak", "1", { timeout: SCENE_WAIT });
    await expect(html(page)).toHaveAttribute("data-throws-landed", "2", { timeout: SCENE_WAIT });
    // Smoke Break: desk 6 throws a ball at each desk ahead; each bursts into a puff, nothing stays
    await sabotage(page, "smoke-break", 6, [1, 2, 3]);
    await expect(html(page)).toHaveAttribute("data-sabotage", "smoke-break:6:1,2,3:throw");
    await expect(html(page)).toHaveAttribute("data-throws-peak", "3", { timeout: SCENE_WAIT });
    await expect.poll(() => num(page, "throws-puffs"), { timeout: SCENE_WAIT }).toBeGreaterThan(0);
    await expect(html(page)).toHaveAttribute("data-throws-puffs", "0", { timeout: SCENE_WAIT });
    await expect(html(page)).toHaveAttribute("data-throws-landed", "2");
    // the seat POV: nothing thrown at your own desk covers more than a quarter of the view (bible 8)
    expect(await num(page, "throw-cover")).toBeLessThanOrEqual(0.25);
    // the race ends: the clutter goes
    await post(page, { type: "fc-race-state", view: room(6, "ended") });
    await expect(html(page)).toHaveAttribute("data-throws-landed", "0", { timeout: SCENE_WAIT });
    await expect(html(page)).toHaveAttribute("data-throws-flying", "0");
  });

  test("C64 thrown at your own desk in the seat POV, no object covers more than 25% of the viewport", async ({
    page,
  }) => {
    await openSeat(page, 3);
    await sabotage(page, "smoke-break", 3, [1, 2]);
    await expect(html(page)).toHaveAttribute("data-throws-peak", "2", { timeout: SCENE_WAIT });
    await expect.poll(() => num(page, "throws-puffs"), { timeout: SCENE_WAIT }).toBeGreaterThan(0);
    await expect(html(page)).toHaveAttribute("data-throws-puffs", "0", { timeout: SCENE_WAIT });
    expect(await num(page, "throw-cover")).toBeLessThanOrEqual(0.25);
    await sabotage(page, "extra-paperwork", 2, [1]);
    await expect(html(page)).toHaveAttribute("data-throws-landed", "1", { timeout: SCENE_WAIT });
    expect(await num(page, "throw-cover")).toBeLessThanOrEqual(0.25);
    await sabotage(page, "exemption", 1, [1]);
    await expect(html(page)).toHaveAttribute("data-throws-landed", "2", { timeout: SCENE_WAIT });
    expect(await num(page, "throw-cover")).toBeLessThanOrEqual(0.25);
  });

  test("C64 under reduced motion: static, no flight and no puff; the object appears where it lands, the Smoke Break's ball leaves when the blur ends, the rest at race end", async ({
    page,
  }) => {
    await openSeat(page, 6, "reduce");
    await expect(html(page)).toHaveAttribute("data-motion", "reduce");
    // the three plays go in one task: a static play shows where it lands at once (no frame needed), so the
    // seven objects are all there long before the balls' blur ends, however slow the frames (software WebGL)
    const shownAt = Date.now();
    await page.evaluate(() =>
      [
        { kind: "smoke-break", from: 6, to: [1, 2, 3, 4, 5] },
        { kind: "extra-paperwork", from: 3, to: [1] },
        { kind: "exemption", from: 4, to: [4] },
      ].forEach((m) => postMessage({ v: 2, type: "fc-race-sabotage", ...m }, location.origin)),
    );
    await expect(html(page)).toHaveAttribute("data-sabotage", "exemption:4:4:static");
    await expect(html(page)).toHaveAttribute("data-throws-landed", "7", { timeout: SCENE_WAIT });
    // the balls leave with the blur (the engine's BLUR_MS, 5 s, wall clock, from a play after `shownAt`),
    // the rest stays
    await expect(html(page)).toHaveAttribute("data-throws-landed", "2", { timeout: SCENE_WAIT });
    expect(Date.now() - shownAt).toBeGreaterThan(4_000);
    await expect(html(page)).toHaveAttribute("data-throws-peak", "0");
    await expect(html(page)).toHaveAttribute("data-throws-puffs", "0");
    await post(page, { type: "fc-race-state", view: room(6, "ended") });
    await expect(html(page)).toHaveAttribute("data-throws-landed", "0", { timeout: SCENE_WAIT });
  });

  test("C64 reduced motion turned on mid-flight lands every object at once, with no puff", async ({
    page,
  }) => {
    await openSeat(page, 6);
    await sabotage(page, "extra-paperwork", 4, [1]);
    await expect(html(page)).toHaveAttribute("data-throws-flying", "1", { timeout: SCENE_WAIT });
    await post(page, { type: "fc-race-motion", motion: "reduce" });
    await expect(html(page)).toHaveAttribute("data-throws-flying", "0", { timeout: SCENE_WAIT });
    await expect(html(page)).toHaveAttribute("data-throws-landed", "1");
    await expect(html(page)).toHaveAttribute("data-throws-puffs", "0");
  });
});

// ---------- the race page (C63) ----------

/** The last play shortcut the tray showed (#951: Option/Alt + a letter per card). */
let lastPlayKey = "K";
async function playCard(page: Page) {
  const hint = page.locator("[data-sabotage-tray] [data-row=play] dd");
  if ((await hint.count()) > 0) {
    const m = /([GJKLP]) TO PLAY$/.exec((await hint.textContent()) ?? "");
    if (m) lastPlayKey = m[1]!;
  }
  await page.keyboard.press(`Alt+Key${lastPlayKey}`);
}

const tray = (page: Page) => page.locator("[data-sabotage-tray]");
const scene = (page: Page) => page.locator("[data-scene]");
const chars = (page: Page) => page.locator("[data-telex] [data-state]");
const input = (page: Page) => page.getByRole("textbox", { name: /^(Text to type|Texte à taper)$/ });

test.describe("#999 C63 sabotage plays reach the seat scene", { tag: "@scene" }, () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project only (software WebGL)");
  test.slow();

  const opened: BrowserContext[] = [];
  const sims: SimulatedPlayer[] = [];
  test.afterEach(async () => {
    for (const sim of sims.splice(0)) sim.close();
    for (const context of opened.splice(0)) await context.close();
  });

  test.beforeEach(async ({ page }) => {
    const webgl = await page.evaluate(
      () => !!document.createElement("canvas").getContext("webgl2"),
    );
    test.skip(!webgl, "no WebGL2 in this browser");
  });

  /**
   * Host (desk 1, leading) and the guest under test with its seat scene ready, `before` simulated players
   * seated ahead of it and `after` behind; the race runs. Returns the guest's desk.
   */
  async function race(
    page: Page,
    browser: Parameters<typeof hostRoom>[0],
    { before, after }: { before: number; after: number },
  ) {
    const room = await hostRoom(browser, opened, {
      before: (host) => host.setViewportSize({ width: 1280, height: 800 }),
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    if (before) sims.push(...(await simulatedPlayers(before, room.lobbyId)));
    await openRace(page, room, "?scene=pin");
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveText(/\d{2}$/);
    const desk = Number(/(\d{2})$/.exec((await heading.textContent())!)![1]);
    if (after) {
      sims.push(
        ...(await simulatedPlayers(after, room.lobbyId, {
          names: Array.from({ length: after }, (_, i) => `Sim-B${i + 1}`),
        })),
      );
    }
    await expect(scene(page)).toHaveAttribute("data-scene", "ready", { timeout: SCENE_WAIT });
    await expect(startButton(room.host)).toBeEnabled();
    await warmRace(room.host, room.lobbyId);
    await startButton(room.host).click();
    for (const p of [page, room.host]) {
      await expect(phaseOf(p)).toHaveAttribute("data-phase", "running", {
        timeout: scaled(20_000),
      });
      await expect(p.locator("[data-countdown]")).toHaveCount(0, { timeout: scaled(10_000) });
    }
    await expect(input(room.host)).toBeFocused();
    const text = (await chars(room.host).allTextContents()).join("");
    await room.host.keyboard.type(Array.from(text).slice(0, 4).join(""));
    await expect(input(page)).toBeFocused();
    return desk;
  }

  test("Extra Paperwork: 2nd of 3 throws it onto the leader's desk, acked `throw`", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(240_000));
    const desk = await race(page, browser, { before: 0, after: 1 });
    await expect(tray(page)).toHaveAttribute("data-card", "extra-paperwork", {
      timeout: scaled(10_000),
    });
    await playCard(page);
    await expect(scene(page)).toHaveAttribute(
      "data-scene-sabotage",
      `extra-paperwork:${desk}:1:throw`,
      { timeout: scaled(15_000) },
    );
  });

  test("Exemption: 6th of 8 crumples a sheet over its shoulder, acked `throw` with itself as target; under reduced motion the next play is `static`", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(240_000));
    const desk = await race(page, browser, { before: 4, after: 2 });
    await expect(tray(page)).toHaveAttribute("data-card", "exemption", {
      timeout: scaled(10_000),
    });
    await playCard(page);
    await expect(scene(page)).toHaveAttribute(
      "data-scene-sabotage",
      `exemption:${desk}:${desk}:throw`,
      { timeout: scaled(15_000) },
    );

    // reduced motion from here: the page tells the scene, and the same card dealt again after the
    // cooldown (the engine's 15 s; an Exemption is no hostile play, so no repeat immunity) is shown static
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(scene(page)).toHaveAttribute("data-scene-motion", "reduce");
    await expect(tray(page).locator("[data-row=play]")).toBeVisible({ timeout: scaled(30_000) });
    await expect(tray(page)).toHaveAttribute("data-card", "exemption");
    await playCard(page);
    await expect(scene(page)).toHaveAttribute(
      "data-scene-sabotage",
      `exemption:${desk}:${desk}:static`,
      { timeout: scaled(15_000) },
    );
  });

  test("Smoke Break: 3rd of 3 throws at everyone ahead, acked `throw`, the leader among the targets", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(240_000));
    const desk = await race(page, browser, { before: 1, after: 0 });
    await expect(tray(page)).toHaveAttribute("data-card", "smoke-break", {
      timeout: scaled(10_000),
    });
    await playCard(page);
    const ack = new RegExp(`^smoke-break:${desk}:(\\d+,\\d+):throw$`);
    await expect(scene(page)).toHaveAttribute("data-scene-sabotage", ack, {
      timeout: scaled(15_000),
    });
    const targets = /:(\d+,\d+):/.exec(
      (await scene(page).getAttribute("data-scene-sabotage"))!,
    )![1]!;
    expect(targets.split(",").map(Number)).toContain(1);
  });
});
