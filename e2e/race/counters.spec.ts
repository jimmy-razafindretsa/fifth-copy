import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { scaled } from "../timeouts";
import { hostRoom, phaseOf, SEAT_HUD, startButton, warmRace } from "./helpers";

// Contract of #225 C3 and C4: the nixie counters live over the race server started by
// playwright.config.ts. Host (English) and one guest (French); the guest takes its desk from the seat
// view itself, so it sits after the host and ranks behind it until it types (ties rank by desk). After
// GO the guest types the first 30 characters of the strip in about a second: its WPM tube leaves `00`
// within 1 s of the last key, and the place tubes read `01 / 02` for the guest (the leader) and
// `02 / 02` for the idle host. The bezel's name reads both numbers in words in each page's UI language
// (`race.counters.*`). Before the start both read `00 / 02` with the no-place words (bible 7.11).

const tube = (page: Page, which: "wpm" | "place") =>
  SEAT_HUD.nixie(page).locator(`[data-tube="${which}"]`);

test.describe("#225 nixie counters", () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project");

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  test("C3 C4: the guest's WPM moves within 1 s, the places read 01 / 02 and 02 / 02, in words in each language", async ({
    page,
    browser,
  }) => {
    const room = await hostRoom(browser, opened);
    await page
      .context()
      .addCookies([{ name: "locale", value: "fr", url: test.info().project.use.baseURL! }]);
    await page.goto(`/race/${room.lobbyId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/\d{2}$/);
    await expect(startButton(room.host)).toBeEnabled();

    // before the start: no place yet, the seated typists counted
    await expect(
      page.getByRole("group", { name: "Mots par minute 0, 2 dactylos, pas encore de rang" }),
    ).toBeVisible();
    await expect(page.locator("[data-tube]")).toHaveText(["00", "00 / 02"]);

    await warmRace(room.host, room.lobbyId);
    await startButton(room.host).click();
    await expect(room.host).toHaveURL(/\/race\/[0-9a-f-]{36}$/);
    await expect(
      room.host.getByRole("group", { name: "Words per minute 0, 2 typists, no place yet" }),
    ).toBeVisible();
    for (const p of [page, room.host]) {
      await expect(phaseOf(p)).toHaveAttribute("data-phase", "running", {
        timeout: scaled(10_000),
      });
    }
    await expect(page.getByRole("textbox", { name: "Texte à taper" })).toBeFocused();

    // 30 characters in about a second (well under 10 s, under the server's key budget)
    const text = (await page.locator("[data-telex] [data-state]").allTextContents()).join("");
    const chars = Array.from(text).slice(0, 30);
    expect(chars).toHaveLength(30);
    const started = Date.now();
    await page.keyboard.type(chars.join(""), { delay: 30 });
    expect(Date.now() - started).toBeLessThan(10_000);

    // C3: the WPM tube shows a value > 0 within 1 s of typing
    await expect(tube(page, "wpm")).not.toHaveText("00", { timeout: scaled(1_000) });
    expect(Number(await tube(page, "wpm").textContent())).toBeGreaterThan(0);
    // the guest leads, the idle host follows
    await expect(tube(page, "place")).toHaveText("01 / 02");
    await expect(tube(room.host, "place")).toHaveText("02 / 02");
    await expect(tube(room.host, "wpm")).toHaveText("00");

    // C4: the same numbers in words, in each page's UI language
    const guestWords = await SEAT_HUD.nixie(page).getAttribute("aria-label");
    expect(guestWords).toMatch(/^Mots par minute [1-9]\d*, rang 1 sur 2$/);
    await expect(
      room.host.getByRole("group", { name: "Words per minute 0, place 2 of 2" }),
    ).toBeVisible();
    // the glyphs stay hidden: the bezel's name is the one reading
    for (const counter of await SEAT_HUD.nixie(page).locator("> span").all()) {
      await expect(counter).toHaveAttribute("aria-hidden", "true");
    }
  });
});
