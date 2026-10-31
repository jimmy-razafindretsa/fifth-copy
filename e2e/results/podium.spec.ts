import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { outfitForDesk } from "../../src/features/identity/clerk/outfit";
import { expect, test } from "../fixtures";
import { HYDRATION_WAIT, scaled } from "../timeouts";
import {
  type Desk,
  postResults,
  SAVED,
  saveOutfit,
  seedLobby,
  six,
  startRace,
  withoutWebGL,
} from "./helpers";

// Contract of #300 C2, C4, C5 and #688 C2, C5, C6: races seeded through the signed internal routes
// (e2e/results/helpers.ts), read back on /results/<raceId>.

const plinths = (page: Page) => page.locator("[data-podium] > [data-plinth]");
const plinth = (page: Page, place: number) => page.locator(`[data-plinth="${place}"]`);
const clerkDoc = (page: Page, place: number) =>
  page.frameLocator(`[data-plinth="${place}"] iframe`).locator("html");

/** Each plinth frame: mounted or idle, and its document's `data-ready` (same origin, read in the page). */
const frameStates = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLIFrameElement>("[data-plinth] iframe")].map((f) => ({
      mounted: f.dataset.embed === "mounted",
      ready: f.contentDocument?.documentElement.dataset.ready === "1",
    })),
  );

const hasWebGL2 = (page: Page) =>
  page.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));

/** Bring every plinth near the viewport once (the near-viewport mount latches), then back to the top. */
async function visitPlinths(page: Page) {
  for (const n of [3, 2, 1]) await plinth(page, n).scrollIntoViewIfNeeded();
}

test.describe("Dawn report podium (#300)", () => {
  test.setTimeout(scaled(120_000));

  test("C2 C5 filing first, then the podium within 5 s of the post, no reload", async ({
    page,
    request,
  }, info) => {
    // The timing under test is the data path (filing -> podium). Three medals booting software WebGL
    // (headless CI, no GPU) block the page's thread for ~9 s right after the swap, so this test draws the
    // medal slots as their stamp; the live medals are proven by the C4 tests below.
    await withoutWebGL(page);
    const lobby = await seedLobby(page);
    const desks = six(lobby.hostUserId);
    const raceId = await startRace(request, lobby, desks);
    await page.goto(`/results/${raceId}`);
    await expect(
      page.getByRole("status").filter({ hasText: "FILING THE REPORT · ONE MOMENT" }),
    ).toBeVisible({ timeout: HYDRATION_WAIT });
    // the poll is a client leaf: let it hydrate before the post, so "no reload" is the refresh
    await page.waitForLoadState("networkidle");
    // a marker on the window survives router.refresh() and dies with a reload
    await page.evaluate(() => Object.assign(window, { __beforePost: true }));
    await postResults(request, raceId, desks);
    await expect(plinths(page)).toHaveCount(3, { timeout: scaled(5_000) });
    expect(
      await page.evaluate(() => (window as { __beforePost?: boolean }).__beforePost),
      "no reload",
    ).toBe(true);

    await expect(page.getByText("DAWN REPORT · FORM 5-R", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "RACE OVER" })).toBeVisible();
    expect(
      await plinths(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-plinth"))),
    ).toEqual(["1", "2", "3"]);
    await expect(plinth(page, 1)).toContainText("DESK 07 · Lynx-785");
    await expect(plinth(page, 1)).toContainText("61");
    await expect(plinth(page, 1)).toContainText("97 %");
    await expect(plinth(page, 1)).not.toContainText("101");
    await expect(plinth(page, 1)).toHaveAttribute("data-you", "true");
    await expect(plinth(page, 2)).toContainText("Typist Bot");
    await expect(plinth(page, 2).getByText("BOT", { exact: true })).toBeVisible();
    await expect(plinth(page, 3)).toContainText("DESK 12 · Heron-302");
    await expect(page.locator("[data-podium]")).not.toContainText("Otter-417");

    // from 768px the plinths stand 2 | 1 | 3, the first tallest
    if (info.project.name !== "mobile") {
      const box = async (n: number) => (await plinth(page, n).boundingBox())!;
      const [one, two, three] = [await box(1), await box(2), await box(3)];
      expect(two.x).toBeLessThan(one.x);
      expect(one.x).toBeLessThan(three.x);
      expect(one.height).toBeGreaterThan(two.height);
      expect(two.height).toBeGreaterThan(three.height);
    }
  });

  test("C5 two finishers: the third plinth is UNFILLED", async ({ page, request }) => {
    const lobby = await seedLobby(page);
    const desks: Desk[] = [
      { desk: 4, name: "Marmot-233", place: 1, wpm: 44.6 },
      { desk: 8, name: "Sparrow-482", place: 2, wpm: 39.9 },
    ];
    const raceId = await startRace(request, lobby, desks);
    await postResults(request, raceId, desks);
    await page.goto(`/results/${raceId}`);
    await expect(plinths(page)).toHaveCount(3, { timeout: HYDRATION_WAIT });
    await expect(plinth(page, 3)).toHaveAttribute("data-unfilled", "true");
    await expect(plinth(page, 3)).toContainText("UNFILLED");
    await expect(plinth(page, 1)).toContainText("Marmot-233");
  });

  test("C5 podium clerk: the host's saved outfit, the bot's desk outfit, mounted one at a time", async ({
    page,
    request,
  }) => {
    const lobby = await seedLobby(page);
    await saveOutfit(lobby.hostUserId, SAVED);
    const desks = six(lobby.hostUserId);
    const raceId = await startRace(request, lobby, desks);
    await postResults(request, raceId, desks);
    await page.goto(`/results/${raceId}`);
    test.skip(
      !(await hasWebGL2(page)),
      "no WebGL2 in this browser (the no-WebGL path has its own test)",
    );
    await expect(plinths(page)).toHaveCount(3, { timeout: HYDRATION_WAIT });
    await visitPlinths(page);

    // the stagger (C4): until all three are drawn, never more than one mounted frame still booting
    const deadline = Date.now() + scaled(30_000);
    let states = await frameStates(page);
    while (!(states.length === 3 && states.every((f) => f.mounted && f.ready))) {
      expect(
        states.filter((f) => f.mounted && !f.ready).length,
        JSON.stringify(states),
      ).toBeLessThanOrEqual(1);
      expect(Date.now(), `frames ${JSON.stringify(states)}`).toBeLessThan(deadline);
      await page.waitForTimeout(100);
      states = await frameStates(page);
    }

    // the host (desk 7, first) wears the saved outfit and the gold medal
    await expect(plinth(page, 1).locator("iframe")).toHaveAttribute(
      "src",
      /^\/3d\/podium-clerk\.html\?embed=1&variant=gold&cfg=/,
    );
    const host = clerkDoc(page, 1);
    await expect(host).toHaveAttribute("data-ready", "1");
    await expect(host).toHaveAttribute("data-variant", "gold");
    for (const [key, id] of Object.entries(SAVED).filter(([k]) => k !== "hairCol")) {
      await expect(host).toHaveAttribute(`data-${key}`, id);
    }
    // the bot (desk 3, second) wears its desk's fixed outfit and the silver medal
    const bot = clerkDoc(page, 2);
    await expect(bot).toHaveAttribute("data-variant", "silver");
    const desk3 = outfitForDesk(3);
    for (const key of ["hair", "glasses", "hat", "clothes", "face"] as const) {
      await expect(bot).toHaveAttribute(`data-${key}`, desk3[key]);
    }
    // desk 12 saved nothing: its desk's outfit, the bronze medal
    await expect(clerkDoc(page, 3)).toHaveAttribute("data-variant", "bronze");
    await expect(clerkDoc(page, 3)).toHaveAttribute("data-hat", outfitForDesk(12).hat);
    // the frames keep the catalog titles (no new strings)
    await expect(plinth(page, 1).locator("iframe")).toHaveAttribute("title", /gold medal/i);
    await expect(clerkDoc(page, 1)).toHaveAttribute("data-motion", "full");
  });

  test("C6 podium clerk under reduced motion: fc-motion crosses the frame, same layout", async ({
    page,
    request,
  }) => {
    const lobby = await seedLobby(page);
    const desks = six(lobby.hostUserId).slice(0, 3);
    const raceId = await startRace(request, lobby, desks);
    await postResults(request, raceId, desks);
    await page.goto(`/results/${raceId}`);
    test.skip(
      !(await hasWebGL2(page)),
      "no WebGL2 in this browser (the no-WebGL path has its own test)",
    );
    await plinth(page, 1).scrollIntoViewIfNeeded();
    const doc = clerkDoc(page, 1);
    await expect(doc).toHaveAttribute("data-ready", "1", { timeout: scaled(30_000) });
    await expect(doc).toHaveAttribute("data-motion", "full");
    const layout = () =>
      page.evaluate(() =>
        [
          ...document.querySelectorAll("[data-plinth], [data-medal-slot], [data-plinth] iframe"),
        ].map((e) => {
          const r = e.getBoundingClientRect();
          return [
            e.tagName,
            Math.round(r.x),
            Math.round(r.y),
            Math.round(r.width),
            Math.round(r.height),
          ];
        }),
      );
    const before = await layout();
    const html = await page.locator("[data-podium]").innerHTML();
    // the not-found pattern: the page's own motion setting, read by the bridge (bible 8, 15)
    await page.evaluate(() => document.documentElement.setAttribute("data-motion", "reduce"));
    await expect(doc).toHaveAttribute("data-motion", "reduce");
    expect(await layout()).toEqual(before);
    expect(await page.locator("[data-podium]").innerHTML()).toBe(html);
  });

  test("C4 without WebGL2 the slots show the gold HERO OF PAPERWORK stamp", async ({
    page,
    request,
  }) => {
    await withoutWebGL(page);
    const lobby = await seedLobby(page);
    const desks = six(lobby.hostUserId).slice(0, 3);
    const raceId = await startRace(request, lobby, desks);
    await postResults(request, raceId, desks);
    await page.goto(`/results/${raceId}`);
    for (const n of [1, 2, 3]) {
      const slot = plinth(page, n).locator("[data-medal-slot]");
      await expect(slot.locator('[data-medal-view="stamp"]')).toBeVisible({
        timeout: HYDRATION_WAIT,
      });
      await expect(slot).toContainText("HERO OF PAPERWORK");
      await expect(slot.locator("iframe")).toHaveCount(0);
    }
    // the stat cells name the players the clerks would have shown (#688 C5)
    await expect(plinth(page, 1)).toContainText("Lynx-785");
    await expect(plinth(page, 2)).toContainText("Typist Bot");
    await expect(plinth(page, 3)).toContainText("Heron-302");
    await expect(page.getByRole("heading", { level: 1, name: "RACE OVER" })).toBeVisible();
  });

  test("C2 an unknown race or a malformed id is a 404", async ({ page }) => {
    for (const id of [randomUUID(), "not-a-race"]) {
      const res = await page.goto(`/results/${id}`);
      expect(res?.status(), id).toBe(404);
    }
  });
});
