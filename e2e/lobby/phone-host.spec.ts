import type { BrowserContext, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { HYDRATION_WAIT, LOAD_LIMIT_MS, scaled } from "../timeouts";
import {
  hostRoom,
  recordRaceTokens,
  SEAT_HUD,
  simulatedPlayers,
  startButton,
  warmRace,
  type SimulatedPlayer,
} from "../race/helpers";

// Contract of #999 C14 (bible 14.3 "Lobby layout" phone rule, "Phone spectator"): a host on a phone keeps
// the room's controls (the settings docket, the invite rows, REMOVE on the roll, START) but never a desk:
// it watches (#876, WATCHES filed for it), and its race page is the phone spectator screen. Real web app
// and race server (playwright.config.ts).

const PHONE = { width: 375, height: 812 };
const roll = (page: Page) => page.getByRole("list", { name: "Typists in the room" });
const settings = (page: Page) => page.getByRole("region", { name: "RACE SETTINGS" });
const hostRow = (page: Page, name: "TYPES" | "WATCHES") =>
  settings(page)
    .getByRole("group", { name: "HOST", exact: true })
    .getByRole("button", { name, exact: true });

test.describe("#999 the host on a phone", () => {
  test.skip(
    ({ viewport }) => viewport?.width !== 1280,
    "desktop project (the phone sets its size)",
  );

  const opened: BrowserContext[] = [];
  let players: SimulatedPlayer[] = [];
  test.afterEach(async () => {
    for (const p of players.splice(0)) p.close();
    for (const context of opened.splice(0)) await context.close();
  });

  test("C14 a phone host keeps settings, invite, REMOVE and START, watches with no desk, and follows the race on the phone screen", async ({
    browser,
  }) => {
    test.setTimeout(scaled(120_000) + LOAD_LIMIT_MS);
    const { host, lobbyId } = await hostRoom(browser, opened, { before: recordRaceTokens });
    players = await simulatedPlayers(2, lobbyId);
    await expect(roll(host).getByRole("listitem")).toHaveCount(3);

    // the host's page opens the room on a phone (a page's role is decided when it mounts)
    await host.setViewportSize(PHONE);
    await host.reload();

    // it files WATCHES by itself: its row leaves the roll, the two typists stay
    await expect(hostRow(host, "WATCHES")).toHaveAttribute("aria-pressed", "true", {
      timeout: HYDRATION_WAIT,
    });
    await expect(roll(host).getByRole("listitem")).toHaveCount(2, { timeout: scaled(5_000) });

    // every control of the room is on the phone
    await expect(settings(host)).toBeVisible();
    await expect(host.getByRole("button", { name: "NEW LINK", exact: true })).toBeVisible();
    await expect(host.getByRole("button", { name: "NEW WATCH LINK" })).toBeVisible();
    await expect(
      roll(host)
        .getByRole("button", { name: /^REMOVE / })
        .first(),
    ).toBeVisible();
    await expect(startButton(host)).toBeVisible();
    await expect(host.getByRole("textbox", { name: "Text to type" })).toHaveCount(0);
    const sideways = await host.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(sideways, "horizontal scroll").toBeLessThanOrEqual(0);
    await expectNoA11yViolations(host);

    // START: the race page is the phone screen, no desk
    await expect(startButton(host)).toBeEnabled({ timeout: scaled(20_000) });
    await warmRace(host, lobbyId);
    await startButton(host).click();
    await host.waitForURL(/\/race\/[0-9a-f-]{36}$/, { timeout: HYDRATION_WAIT });
    await expect(host.getByRole("heading", { level: 1 })).toHaveText("SPECTATOR VIEW", {
      timeout: HYDRATION_WAIT,
    });
    await expect(host.locator("[data-projector-state]")).toHaveAttribute(
      "data-projector-state",
      /^(loading|countdown|racing)$/,
      { timeout: LOAD_LIMIT_MS + scaled(15_000) },
    );
    await expect(host.getByRole("textbox")).toHaveCount(0);
    await expect(SEAT_HUD.telex(host)).toHaveCount(0);
    await expect(host.locator("[data-top10] li")).toHaveCount(2);
  });
});
