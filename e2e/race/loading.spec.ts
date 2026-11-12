import type { BrowserContext, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { HOLD_MS, HYDRATION_WAIT, LOAD_LIMIT_MS, SAME_START_TOLERANCE, scaled } from "../timeouts";
import {
  createLobby,
  hostRoom,
  joinAsGuest,
  lobbyIdOf,
  phaseOf,
  simulatedPlayers,
  startButton,
  warmRace,
  type SimulatedPlayer,
} from "./helpers";

// Contract of #926 (ARCHITECTURE 7.1 "Loading", bible 7.4 "Scene loading card"): after START the room
// loads before it counts down. Every seat page shows the shared loading card with its READY row while
// it loads its text and its scene and reports ready; the 3-2-1 starts for everyone at one instant once
// every connected typist is ready, or at the load limit; a typist whose scene is not up by then races on
// paper. Real web app and race server (playwright.config.ts).

/** Each seat phase the page shows, with this machine's clock when it showed (`[data-phase]`). */
type Phases = [phase: string, t: number][];

/** Records every change of the seat view's `data-phase` from the page's first script on. */
async function recordPhases(page: Page) {
  await page.addInitScript(() => {
    if (window !== window.top) return;
    const w = window as unknown as { __phases: Phases };
    w.__phases = [];
    new MutationObserver(() => {
      const phase = document
        .querySelector("[data-seat-status] [data-phase]")
        ?.getAttribute("data-phase");
      if (phase && w.__phases.at(-1)?.[0] !== phase) w.__phases.push([phase, Date.now()]);
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-phase"],
    });
  });
}
const phasesOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { __phases: Phases }).__phases);
const firstAt = (phases: Phases, phase: string) => phases.find(([p]) => p === phase)?.[1] ?? null;

const loadingCard = (page: Page) =>
  page.locator("[data-loading-card]").filter({ hasText: "LOADING THE RING ROOM" });
const readyRow = (page: Page) => page.locator("[data-loading-card] [data-ready]");
const noScene = (page: Page) => page.locator('[data-notice="no-scene"]');

test.describe("#926 the shared pre-race loading", () => {
  const opened: BrowserContext[] = [];
  let players: SimulatedPlayer[] = [];
  test.afterEach(async () => {
    for (const p of players.splice(0)) p.close();
    for (const context of opened.splice(0)) await context.close();
  });

  test("C5 one loading card with its READY row while the room loads, axe clean in light and Night shift; gone at the countdown", async ({
    page,
  }, info) => {
    const width = info.project.use.viewport?.width ?? 1280;
    test.skip(width < 768, "phones never take a seat (the phones notice)");
    test.setTimeout(scaled(90_000) + LOAD_LIMIT_MS);
    await recordPhases(page);
    const code = await createLobby(page);
    const lobbyId = await lobbyIdOf(code);
    // one typist that never reports: the room waits out its limit, the card stays up meanwhile
    players = await simulatedPlayers(1, lobbyId, { ready: false });
    await expect(startButton(page)).toBeEnabled({ timeout: scaled(20_000) });
    await warmRace(page, lobbyId);

    await startButton(page).click();
    await expect(page).toHaveURL(/\/race\/[0-9a-f-]{36}$/, { timeout: HYDRATION_WAIT });
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "loading", {
      timeout: HYDRATION_WAIT,
    });
    const card = loadingCard(page);
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute("role", "status");
    await expect(card).toHaveAttribute("aria-busy", "true");
    // this page (paper) reported; the simulated typist did not: 01 of 02 desks ready
    await expect(readyRow(page)).toHaveText(/^READY\s*01 \/ 02$/, { timeout: scaled(10_000) });
    // the paper device shows the card in place of its no-scene notice; no 3-2-1 digit while it is up
    await expect(noScene(page)).toHaveCount(0);
    await expect(page.locator("[data-countdown]")).toHaveCount(0);
    await expectNoA11yViolations(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await expectNoA11yViolations(page);

    // the limit: the room counts down for everyone; the card leaves, the notice returns
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "countdown", {
      timeout: LOAD_LIMIT_MS + scaled(10_000),
    });
    await expect(card).toHaveCount(0);
    await expect(noScene(page)).toHaveCount(1);
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", {
      timeout: scaled(10_000),
    });
  });

  test("C6 the same start instant: a held guest holds the room; both pages turn running together", async ({
    page,
    browser,
  }, info) => {
    test.skip(info.project.use.viewport?.width !== 1280, "desktop project");
    test.setTimeout(scaled(120_000));
    await recordPhases(page);
    const code = await createLobby(page);
    const lobbyId = await lobbyIdOf(code);
    const guest = await joinAsGuest(browser, code, { before: recordPhases });
    opened.push(guest.context);
    await expect(startButton(page)).toBeEnabled({ timeout: scaled(20_000) });
    await warmRace(page, lobbyId);
    // the guest's move to the seat view is held HOLD_MS: longer than the countdown, inside the limit
    await guest.page.route(
      (url) => url.pathname.startsWith("/race/"),
      async (route) => {
        await new Promise((r) => setTimeout(r, HOLD_MS));
        await route.continue().catch(() => undefined);
      },
    );

    const clickedAt = Date.now();
    await startButton(page).click();
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "loading", {
      timeout: HYDRATION_WAIT,
    });
    for (const p of [page, guest.page]) {
      await expect(phaseOf(p)).toHaveAttribute("data-phase", "running", {
        timeout: HYDRATION_WAIT,
      });
    }
    const [host, other] = [await phasesOf(page), await phasesOf(guest.page)];
    const hostCountdown = firstAt(host, "countdown");
    expect(hostCountdown, "the host's countdown").not.toBeNull();
    expect(hostCountdown! - clickedAt, "no countdown before the held guest").toBeGreaterThanOrEqual(
      HOLD_MS,
    );
    const [a, b] = [firstAt(host, "running"), firstAt(other, "running")];
    expect(a !== null && b !== null, "both pages ran").toBe(true);
    expect(Math.abs(a! - b!), "the two GO instants (ms)").toBeLessThanOrEqual(SAME_START_TOLERANCE);
  });

  test(
    "C4 a late typist drops to paper: the scene frame is held, the room starts at the limit, the typist types from GO",
    {
      tag: "@scene",
    },
    async ({ page, browser }, info) => {
      test.skip(info.project.use.viewport?.width !== 1280, "desktop project");
      test.setTimeout(scaled(120_000) + LOAD_LIMIT_MS);
      const webgl = await page.evaluate(
        () => !!document.createElement("canvas").getContext("webgl2"),
      );
      test.skip(!webgl, "no WebGL2 in this browser: the page is on paper from the start");
      const room = await hostRoom(browser, opened);
      players = await simulatedPlayers(1, room.lobbyId);
      await warmRace(room.host, room.lobbyId);
      // the scene's frame never arrives on this page until the test lets it go
      let release = () => {};
      const held = new Promise<void>((r) => (release = r));
      await page.route("**/3d/seat.html*", async (route) => {
        await held;
        await route.continue().catch(() => undefined);
      });
      try {
        await page.goto(`/race/${room.lobbyId}`);
        await expect(
          page.getByRole("status").filter({ hasText: "WAITING FOR THE HOST" }),
        ).toBeVisible({ timeout: HYDRATION_WAIT });
        await expect(startButton(room.host)).toBeEnabled({ timeout: scaled(20_000) });
        await startButton(room.host).click();
        await expect(phaseOf(page)).toHaveAttribute("data-phase", "loading", {
          timeout: scaled(10_000),
        });
        await expect(loadingCard(page)).toHaveCount(1);
        // the limit: this desk never reported, the room goes anyway; its scene is dropped for paper
        await expect(phaseOf(page)).toHaveAttribute("data-phase", "countdown", {
          timeout: LOAD_LIMIT_MS + scaled(10_000),
        });
        await expect(noScene(page)).toHaveCount(1);
        await expect(page.locator("[data-scene]")).toHaveCount(0);
        await expect(page.locator('iframe[src*="/3d/seat.html"]')).toHaveCount(0);
        await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", {
          timeout: scaled(10_000),
        });
        const first = (await page.locator("[data-telex] [data-state]").first().textContent()) ?? "";
        await page.keyboard.press(first === " " ? "Space" : first);
        await expect(page.locator('[data-sheet] [data-state="done"]')).toHaveCount(1, {
          timeout: scaled(5_000),
        });
        await expect(noScene(page)).toHaveCount(1);
      } finally {
        release();
      }
    },
  );
});
