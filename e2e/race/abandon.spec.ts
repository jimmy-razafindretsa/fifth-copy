import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { scaled } from "../timeouts";
import {
  hostRoom,
  phaseOf,
  recordRaceTokens,
  SEAT_HUD,
  setHostSettings,
  startButton,
  warmRace,
} from "./helpers";

// Contract of #233 C2 and C3 over the race server playwright.config.ts starts. A host and one guest
// (English) in a 10-word room. Abandon is visible and inert while waiting and counting down, live from GO:
// ABANDON opens the ink confirm (the race input keeps the focus), Escape and 5 s cancel it, the confirm
// sends the intent once. The server's `abandoned` brings the REASSIGNED docket (`WPM | nn`,
// `ACCURACY | nn %`, `PLACE | LAST`); KEEP WATCHING closes it while the HUD stays live without input (the
// host's lane keeps moving); a reload finds the docket again and its ink link leads to `/lobby/<code>`.
// The host then types the whole strip: after its finish its Abandon is inert too.

const abandonButton = (page: Page, name = "ABANDON") =>
  SEAT_HUD.abandon(page).getByRole("button", { name, exact: true });
const confirmButton = (page: Page) =>
  SEAT_HUD.abandon(page).getByRole("button", { name: "CONFIRM · REASSIGN ME", exact: true });
const exitDocket = (page: Page) => page.locator('[data-seat-status] [data-exit="abandoned"]');
const input = (page: Page) => page.getByRole("textbox", { name: "Text to type" });
const stripText = async (page: Page) =>
  (await page.locator("[data-telex] [data-state]").allTextContents()).join("");
const deskOf = async (page: Page) =>
  Number(/(\d{2})$/.exec((await SEAT_HUD.kicker(page).textContent()) ?? "")![1]);
const inputFocused = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? null);

test.describe("#233 Abandon and the Reassigned notice", () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project");

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  test("C2 C3: inert before GO, confirm with Escape and 5 s, REASSIGNED with the partial stats, keep watching, back to the waiting room", async ({
    page,
  }) => {
    test.setTimeout(scaled(120_000));
    const room = await hostRoom(page.context().browser()!, opened, { before: recordRaceTokens });
    await setHostSettings(room.host, { wordCount: 10 });
    // every `abandon` the guest's sockets send (the intent goes out once, C1)
    const abandons = { count: 0 };
    page.on("websocket", (ws) =>
      ws.on("framesent", ({ payload }) => {
        if (String(payload).startsWith('42["abandon"')) abandons.count++;
      }),
    );
    await page.goto(`/race/${room.lobbyId}`);
    await expect(SEAT_HUD.kicker(page)).toHaveText(/\d{2}$/);
    const guestDesk = await deskOf(page);

    // C2: visible and inert while waiting
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "waiting");
    await expect(SEAT_HUD.abandon(page)).toHaveAttribute("data-abandon", "disabled");
    await expect(abandonButton(page)).toBeDisabled();

    await expect(startButton(room.host)).toBeEnabled();
    await warmRace(room.host, room.lobbyId);
    await startButton(room.host).click();
    await expect(room.host).toHaveURL(/\/race\/[0-9a-f-]{36}$/);
    // ... and while counting down
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "countdown", {
      timeout: scaled(10_000),
    });
    await expect(abandonButton(page)).toBeDisabled();
    for (const p of [page, room.host]) {
      await expect(phaseOf(p)).toHaveAttribute("data-phase", "running", {
        timeout: scaled(10_000),
      });
    }
    const hostDesk = await deskOf(room.host);

    // the host keeps typing, one correct key a second, so its lane moves while the guest watches
    const hostText = Array.from(await stripText(room.host));
    let typed = 0;
    let awake = true;
    const keepTyping = (async () => {
      for (; awake && typed < hostText.length - 1; typed++) {
        await room.host.keyboard.type(hostText[typed]!);
        for (let w = 0; awake && w < 10; w++) await room.host.waitForTimeout(100);
      }
    })();

    try {
      // C2: live from GO; a press keeps the race input's focus
      await expect(SEAT_HUD.abandon(page)).toHaveAttribute("data-abandon", "idle");
      await expect(input(page)).toBeFocused();
      const text = await stripText(page);
      await page.keyboard.type(text.slice(0, 6), { delay: 40 });
      await abandonButton(page).click();
      await expect(SEAT_HUD.abandon(page)).toHaveAttribute("data-abandon", "confirm");
      await expect(abandonButton(page)).toHaveAttribute("aria-expanded", "true");
      await expect(confirmButton(page)).toBeVisible();
      expect(await inputFocused(page)).toBe("Text to type");

      // Escape cancels
      await page.keyboard.press("Escape");
      await expect(SEAT_HUD.abandon(page)).toHaveAttribute("data-abandon", "idle");
      await expect(confirmButton(page)).toHaveCount(0);
      // 5 s without an answer cancel
      await abandonButton(page).click();
      await expect(confirmButton(page)).toBeVisible();
      await expect(confirmButton(page)).toHaveCount(0, { timeout: scaled(7_000) });
      await expect(abandonButton(page)).toHaveAttribute("aria-expanded", "false");

      // nothing went out so far; the ink confirm sends the intent once
      expect(abandons.count).toBe(0);
      await page.keyboard.type(text.slice(6, 8), { delay: 40 });
      await abandonButton(page).click();
      await confirmButton(page).click();

      // C3: the REASSIGNED docket with your partial stats
      const docket = exitDocket(page);
      await expect(docket).toBeVisible({ timeout: scaled(5_000) });
      expect(abandons.count).toBe(1);
      await expect(docket.locator("[data-stamp-tone]")).toHaveText("REASSIGNED");
      await expect(docket.locator("[data-stamp-tone]")).toHaveAttribute("data-stamp-tone", "ink");
      await expect(docket.locator('[data-row="wpm"]')).toHaveText(/^WPM\d+$/);
      await expect(docket.locator('[data-row="accuracy"]')).toHaveText(/^ACCURACY\d{1,3} %$/);
      await expect(docket.locator('[data-row="place"]')).toHaveText("PLACELAST");
      const wpm = await docket.locator('[data-row="wpm"] dd').textContent();
      // the figure is frozen: it reads the same a second later
      await page.waitForTimeout(1_200);
      await expect(docket.locator('[data-row="wpm"] dd')).toHaveText(wpm!);
      // input and Abandon are inert now
      await expect(input(page)).toBeDisabled();
      await expect(abandonButton(page)).toBeDisabled();
      // the race card files the guest as REASSIGNED on both pages
      for (const p of [page, room.host]) {
        await expect(
          SEAT_HUD.raceCard(p).locator(`[data-lane][data-desk="${guestDesk}"] [data-status-label]`),
        ).toHaveAttribute("data-status-label", "abandoned", { timeout: scaled(5_000) });
      }

      // KEEP WATCHING: the docket closes, the HUD stays live (the host's lane still moves), no input
      await docket.getByRole("button", { name: "KEEP WATCHING", exact: true }).click();
      await expect(docket).toHaveCount(0);
      await expect(phaseOf(page)).toHaveAttribute("data-phase", "running");
      await expect(input(page)).toBeDisabled();
      const hostLane = SEAT_HUD.raceCard(page).locator(`[data-lane][data-desk="${hostDesk}"]`);
      const before = await hostLane.getAttribute("data-desk-progress");
      await expect(hostLane).not.toHaveAttribute("data-desk-progress", before!, {
        timeout: scaled(5_000),
      });

      // a reload finds the docket again (the server's status), and its link leads to the waiting room
      await page.reload();
      await expect(exitDocket(page)).toBeVisible({ timeout: scaled(10_000) });
      const back = exitDocket(page).getByRole("link", {
        name: "BACK TO THE WAITING ROOM →",
        exact: true,
      });
      await expect(back).toHaveAttribute("href", `/lobby/${room.code}`);
      await back.click();
      await expect(page).toHaveURL(new RegExp(`/lobby/${room.code}$`));

      // C2: after the host's finish its Abandon is inert too
      awake = false;
      await keepTyping;
      await room.host.keyboard.type(hostText.slice(typed).join(""), { delay: 40 });
      await expect(room.host.getByRole("textbox", { name: "Text to type" })).toBeDisabled({
        timeout: scaled(5_000),
      });
      await expect(SEAT_HUD.abandon(room.host)).toHaveAttribute("data-abandon", "disabled");
      await expect(abandonButton(room.host)).toBeDisabled();
    } finally {
      awake = false;
      await keepTyping;
    }
  });
});
