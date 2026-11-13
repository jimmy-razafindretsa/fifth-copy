import type { Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { HYDRATION_WAIT, scaled } from "../timeouts";
import {
  createLobby,
  lobbyIdOf,
  phaseOf,
  simulatedPlayers,
  startButton,
  warmRace,
  type SimulatedPlayer,
} from "./helpers";

// Contract of #937 (bible 7.4 "Waiting room", reference docs/design/waiting-room/): while the room is
// `loading` (#926) the seat page shows one full-screen waiting room: the summons kicker, LOADING., the
// mission-order docket with its rows, this device's load steps and the ARRIVALS band. Leaving at the
// countdown is e2e/race/loading.spec.ts C5. Real web app and race server (playwright.config.ts).

const room = (page: Page) => page.locator("[data-waiting-room]");

/**
 * Host + one simulated typist that reports ready (`Ada`) + one that never does (`Roy`): the room stays
 * `loading` until its limit, long enough to read the screen. Returns the room code.
 */
async function loadingRoom(page: Page, players: SimulatedPlayer[], locale?: "fr") {
  const code = await createLobby(page);
  const lobbyId = await lobbyIdOf(code);
  players.push(...(await simulatedPlayers(1, lobbyId, { names: ["Ada"] })));
  players.push(...(await simulatedPlayers(1, lobbyId, { names: ["Roy"], ready: false })));
  await expect(startButton(page)).toBeEnabled({ timeout: scaled(20_000) });
  await warmRace(page, lobbyId);
  // the lobby page is already drawn in English; the seat page is rendered in the cookie's language
  if (locale) await page.context().addCookies([{ name: "locale", value: locale, url: page.url() }]);
  await startButton(page).click();
  await expect(page).toHaveURL(/\/race\/[0-9a-f-]{36}$/, { timeout: HYDRATION_WAIT });
  await expect(phaseOf(page)).toHaveAttribute("data-phase", "loading", { timeout: HYDRATION_WAIT });
  return code;
}

test.describe("#937 the waiting room", () => {
  let players: SimulatedPlayer[] = [];
  test.afterEach(() => {
    for (const p of players.splice(0)) p.close();
  });

  test("C1-C5 the summons, the docket rows, the load steps and the arrivals; axe clean in light and Night shift; still under reduced motion", async ({
    page,
  }, info) => {
    const width = info.project.use.viewport?.width ?? 1280;
    test.skip(width < 768, "phones never take a seat (the phones notice)");
    test.setTimeout(scaled(90_000));
    const code = await loadingRoom(page, players);

    // C1: one screen over the seat, the #926 card not shown, no 3-2-1
    const screen = room(page);
    await expect(screen).toHaveCount(1);
    await expect(screen).toBeVisible();
    await expect(page.locator("[data-loading-card]")).toHaveCount(0);
    await expect(page.locator("[data-countdown]")).toHaveCount(0);
    await expect(screen.getByText(`SUMMONS · ROOM ${code}`, { exact: true })).toBeVisible();
    await expect(screen.getByRole("heading", { name: "LOADING." })).toBeVisible();
    await expect(screen.getByText("MISSION ORDER", { exact: true })).toBeVisible();
    await expect(screen.getByText("FORM 7-D", { exact: true })).toBeVisible();
    const box = await screen.boundingBox();
    const viewport = page.viewportSize()!;
    expect(
      box && Math.round(box.width) === viewport.width && Math.round(box.height) === viewport.height,
    ).toBe(true);

    // C2: the rows; this page (paper) and Ada reported, Roy did not: 02 of 03 desks ready
    await expect(screen.locator("[data-desk] dd")).toHaveText("01");
    await expect(screen.locator("[data-ready]")).toHaveText("02 / 03", { timeout: scaled(10_000) });

    // C3: this device is settled and filed; the Major (the others) is the current step
    const step = (id: string) => screen.locator(`[data-step="${id}"]`);
    for (const id of ["papers", "desk", "machines", "copy"])
      await expect(step(id)).toHaveAttribute("data-step-state", "done");
    await expect(step("major")).toHaveAttribute("data-step-state", "current");
    await expect(screen.locator("[data-phrase]")).toHaveText("Waiting for the Major…");
    // (4 own steps + 2/3 desks ready) / 5 = 93
    await expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "93");

    // C4: the arrivals are the two desks that reported, never the one still awaited
    const arrivals = screen.getByRole("list", { name: "ARRIVALS" });
    await expect(arrivals.getByRole("listitem")).toHaveCount(2);
    await expect(arrivals).toContainText("Ada");
    await expect(arrivals).not.toContainText("Roy");

    // C5: a polite busy status, axe clean in both themes
    const status = screen.getByRole("status");
    await expect(status).toHaveAttribute("aria-busy", "true");
    await expectNoA11yViolations(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await expectNoA11yViolations(page);

    // C4: under reduced motion nothing rolls
    await page.emulateMedia({ reducedMotion: "reduce" });
    const animation = await screen
      .locator("[data-arrivals] [role=region] > div")
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toBe("none");
  });

  test("C6 the French page", async ({ page }, info) => {
    test.skip(info.project.use.viewport?.width !== 1280, "desktop project");
    test.setTimeout(scaled(90_000));
    const code = await loadingRoom(page, players, "fr");
    const screen = room(page);
    await expect(
      screen.getByText(`AVIS DE CONVOCATION · SALLE ${code}`, { exact: true }),
    ).toBeVisible();
    await expect(screen.getByRole("heading", { name: "CHARGEMENT." })).toBeVisible();
    await expect(screen.getByText("ORDRE DE MISSION", { exact: true })).toBeVisible();
    await expect(screen.getByText("FORMULAIRE 7-D", { exact: true })).toBeVisible();
    await expect(screen.getByRole("list", { name: "ARRIVÉES" })).toBeVisible();
    await expect(screen.locator('[data-step="copy"]')).toContainText("COPIE");
  });
});
