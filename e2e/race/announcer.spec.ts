import type { BrowserContext, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { scaled } from "../timeouts";
import {
  hostRoom,
  phaseOf,
  recordRaceTokens,
  setHostSettings,
  startButton,
  warmRace,
} from "./helpers";

// Contract of #242 C3 over the race server playwright.config.ts starts. Host and one guest in a
// 10-word room; the guest takes its desk from the seat view, so it sits after the host and ranks
// second at the start (ties rank by desk). The guest's page records every text of its one announcer
// (`[data-announcer]`, the polite status region) with a MutationObserver installed before it loads,
// together with whether the race input held the focus at that moment. After GO the guest hears its
// place, passes the idle host (`You passed desk NN`), types the whole strip and hears
// `Finished. Place 1 of 2`. The input keeps the focus throughout: the announcer never moves it.

type Said = {
  t: number;
  text: string;
  role: string | null;
  live: string | null;
  atomic: string | null;
  focused: boolean;
  regions: number;
};

/** Runs in the page before its scripts: logs every announcer text and where the focus was. */
function recorder() {
  const log: Said[] = [];
  (window as unknown as { __said: Said[] }).__said = log;
  let said: string | null = null;
  const check = () => {
    const announcer = document.querySelector("[data-announcer]");
    const text = announcer?.textContent ?? null;
    if (text === said) return;
    said = text;
    if (!text) return;
    log.push({
      t: Date.now(),
      text,
      role: announcer!.getAttribute("role"),
      live: announcer!.getAttribute("aria-live"),
      atomic: announcer!.getAttribute("aria-atomic"),
      focused: document.activeElement === document.querySelector("[data-race-input]"),
      regions: document.querySelectorAll("[data-announcer]").length,
    });
  };
  new MutationObserver(check).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
}

/** Every sentence the announcer may say (#242 C1); anything else would be a leak. */
const LINE =
  /^(3|2|1|GO|Place \d+ of \d+|You passed desk \d{2}|Desk \d{2} passed you|Finished\. Place \d+ of \d+|ACCEPTED · \d+ WPM|RETURNED · \d+ ERRORS?|Race over\.( Place \d+ of \d+)?)$/;

const saidOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { __said: Said[] }).__said);
const deskOf = async (page: Page) =>
  /(\d{2})$/.exec((await page.getByRole("heading", { level: 1 }).textContent())!)![1]!;

test.describe("#242 screen reader announcements", () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project");

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  test("C3: the guest hears GO, its place, its overtake and its finish, without losing the focus", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(90_000));
    const room = await hostRoom(browser, opened, { before: recordRaceTokens });
    await setHostSettings(room.host, { wordCount: 10 });
    await page.addInitScript(recorder);
    await page.goto(`/race/${room.lobbyId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/\d{2}$/);
    await expect(startButton(room.host)).toBeEnabled();
    await warmRace(room.host, room.lobbyId);

    await startButton(room.host).click();
    await expect(room.host).toHaveURL(/\/race\/[0-9a-f-]{36}$/);
    await expect(room.host.getByRole("heading", { level: 1 })).toHaveText(/\d{2}$/);
    const hostDesk = await deskOf(room.host);
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", {
      timeout: scaled(10_000),
    });
    await expect(page.locator("[data-countdown]")).toHaveCount(0, { timeout: scaled(5_000) });
    const input = page.getByRole("textbox", { name: "Text to type" });
    await expect(input).toBeFocused();
    // the place sentence after the first snapshot, once the GO stamp left
    const region = page.locator("[data-announcer]");
    await expect(region).toHaveText("Place 2 of 2", { timeout: scaled(5_000) });

    const text = (await page.locator("[data-telex] [data-state]").allTextContents()).join("");
    expect(text.length).toBeGreaterThan(20);
    await page.keyboard.type(Array.from(text).slice(0, 3).join(""));
    await expect(page.locator("[data-stamps]")).toHaveAttribute("data-stamps", "overtake", {
      timeout: scaled(5_000),
    });
    await expect(region).toHaveText(`You passed desk ${hostDesk}`, { timeout: scaled(5_000) });
    await expect(input).toBeFocused();

    await page.keyboard.type(Array.from(text).slice(3).join(""), { delay: 30 });
    await expect
      .poll(async () => (await saidOf(page)).map((e) => e.text), { timeout: scaled(10_000) })
      .toContain("Finished. Place 1 of 2");

    const said = await saidOf(page);
    const texts = said.map((e) => e.text);
    const at = (line: string) => texts.indexOf(line);
    const go = at("GO");
    const place = at("Place 2 of 2");
    const overtake = at(`You passed desk ${hostDesk}`);
    const finished = at("Finished. Place 1 of 2");
    expect(go, texts.join(" | ")).toBeGreaterThanOrEqual(0);
    expect(place, texts.join(" | ")).toBeGreaterThan(go);
    expect(overtake, texts.join(" | ")).toBeGreaterThan(place);
    expect(finished, texts.join(" | ")).toBeGreaterThan(overtake);
    // one polite, atomic status region; never assertive, never the race text
    for (const e of said) {
      expect(e.role).toBe("status");
      expect(e.live).toBe("polite");
      expect(e.atomic).toBe("true");
      expect(e.regions).toBe(1);
      expect(e.text, "only the announcer's own sentences, never the race text").toMatch(LINE);
    }
    // the race input held the focus at every line after GO up to the finish (it locks at the finish)
    for (const e of said.slice(go + 1, finished)) expect(e.focused, e.text).toBe(true);
    await expectNoA11yViolations(page);
  });
});
