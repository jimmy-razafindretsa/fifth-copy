import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import type { RaceSettingsPatch } from "@fifth-copy/protocol";
import { expect, test } from "../fixtures";
import {
  hostRoom,
  phaseOf,
  recordRaceTokens,
  setHostSettings,
  startButton,
  warmRace,
} from "./helpers";

// Contract of #220 C3-C6, live over the race server started by playwright.config.ts: the host's error
// mode reaches the guest's engine and the seat view renders what the engine decided. Continue: a struck
// key stays on the copy (sheet `×`, strip red) and the cursor moves on; Backspace takes it back, or, with
// backspace off, changes nothing. Block: the cursor holds, every wrong press counts, the machine jams
// (on the teleprinter: key outlines, the space bar and the slot red, the red X) until the right key.
// R217: the same wrong key at the start of the text holds the cursor in Block and advances it in
// Continue. The host sets the mode with `setHostSettings` before the guest takes a desk at
// `/race/<lobbyId>` and the host's START. Tablet and desktop only (the seat view is tablet+, #561 C5).

/** Machine colours: the invariant `machine-*` roles and `typing-error`, the same in both themes. */
const RED = "rgb(184, 29, 36)";
const PAPER = "rgb(241, 232, 214)";
const INK = "rgb(42, 36, 32)";
const DECK = "rgb(228, 214, 184)";

const input = (page: Page) => page.getByRole("textbox", { name: "Text to type" });
const machine = (page: Page) => page.locator("[data-machine]");
const sheetChars = (page: Page) => page.locator("[data-sheet] [data-state]");
const stripChars = (page: Page) => page.locator("[data-telex] [data-state]");
const keyCap = (page: Page, key: string) => machine(page).locator(`[data-key="${key}"]`);

/** A key on the seat's machine (SEAT_ROWS) that is not `ch` in any case: the struck key. */
const wrongFor = (ch: string) => ["q", "z", "x"].find((k) => k !== ch.toLowerCase())!;

/** The index of the `next` span among `chars`, and every char as `ch:state`. */
async function readCopy(chars: Locator) {
  return chars.evaluateAll((spans) => ({
    next: spans.findIndex((s) => s.getAttribute("data-state") === "next"),
    chars: spans.map((s) => `${s.textContent}:${s.getAttribute("data-state")}`),
  }));
}

/** The computed look of a machine part. */
async function look(locator: Locator) {
  return locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, color: s.color, border: s.borderTopColor };
  });
}

test.describe("#220 error modes, live", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 768, "the seat view is tablet+ (#561 C5)");

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  /**
   * A fresh room in `settings`: the host sets them, the page takes a desk at `/race/<lobbyId>`, the host
   * starts; resolves at GO with the race text (the strip's) and the focused input.
   */
  async function race(page: Page, browser: Browser, settings: RaceSettingsPatch) {
    const room = await hostRoom(browser, opened, { before: recordRaceTokens });
    await setHostSettings(room.host, settings);
    await page.goto(`/race/${room.lobbyId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^SEAT VIEW · DESK \d{2}$/);
    await expect(startButton(room.host)).toBeEnabled();
    await warmRace(room.host, room.lobbyId);
    await startButton(room.host).click();
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", { timeout: 10_000 });
    await expect(input(page)).toBeFocused();
    const text = (await stripChars(page).allTextContents()).join("");
    expect(text.length, "the race text").toBeGreaterThan(1);
    return { text, first: Array.from(text)[0]! };
  }

  test("C3 C5 C6 Continue: the struck key stays on the copy and the cursor moves on; Backspace takes it back", async ({
    page,
    browser,
  }) => {
    const { first } = await race(page, browser, { errorMode: "continue", backspace: true });
    await expect(input(page)).toHaveAttribute("data-mode", "continue");
    await expect(input(page)).toHaveAttribute("data-backspace", "on");
    await expect(input(page)).toHaveAttribute("data-errors", "0");
    const wrong = wrongFor(first);

    await page.keyboard.press(wrong);
    // the sheet: the struck char, red, with the × typed over it; the caret on the next char
    const struck = page.locator('[data-sheet] [data-state="wrong"]');
    await expect(struck).toHaveCount(1);
    expect(await readCopy(sheetChars(page))).toMatchObject({ next: 1 });
    const over = await struck.evaluate((el) => ({
      color: getComputedStyle(el).color,
      content: getComputedStyle(el, "::after").content,
      overColor: getComputedStyle(el, "::after").color,
    }));
    expect(over).toEqual({ color: RED, content: '"×"', overColor: RED });
    // the strip: the same char wrong (red text), the next one is next
    await expect(page.locator('[data-telex] [data-state="wrong"]')).toHaveCount(1);
    expect(await readCopy(stripChars(page))).toMatchObject({ next: 1 });
    expect((await readCopy(stripChars(page))).chars[0]).toBe(`${first}:wrong`);
    // the machine: the struck cap red, no jam
    await expect(keyCap(page, wrong)).toHaveAttribute("data-wrong", "true");
    await expect(machine(page).locator('[data-wrong="true"]')).toHaveCount(1);
    await expect(machine(page)).not.toHaveAttribute("data-jammed", /.*/);
    await expect(machine(page).locator('[data-part="jam"]')).toHaveCount(0);
    // R217, Continue: the first wrong key advances the cursor by one and counts one error
    await expect(input(page)).toHaveAttribute("data-errors", "1");

    await page.keyboard.press("Backspace");
    await expect(struck).toHaveCount(0);
    await expect(page.locator('[data-telex] [data-state="wrong"]')).toHaveCount(0);
    expect(await readCopy(sheetChars(page))).toMatchObject({ next: 0 });
    expect(await readCopy(stripChars(page))).toMatchObject({ next: 0 });
    await expect(input(page)).toHaveAttribute("data-errors", "0");
    await expect(machine(page).locator('[data-wrong="true"]')).toHaveCount(0);
  });

  test("C3 C6 Continue with backspace off: Backspace leaves the sheet, the strip and the cursor unchanged", async ({
    page,
    browser,
  }) => {
    const { first } = await race(page, browser, { errorMode: "continue", backspace: false });
    await expect(input(page)).toHaveAttribute("data-mode", "continue");
    await expect(input(page)).toHaveAttribute("data-backspace", "off");

    await page.keyboard.press(wrongFor(first));
    await expect(page.locator('[data-sheet] [data-state="wrong"]')).toHaveCount(1);
    await expect(input(page)).toHaveAttribute("data-errors", "1");
    const sheet = await readCopy(sheetChars(page));
    const strip = await readCopy(stripChars(page));
    expect(sheet.next).toBe(1);

    await page.keyboard.press("Backspace");
    // the engine took the press (it reached the prediction) and changed nothing on the copy
    await page.waitForTimeout(300);
    expect(await readCopy(sheetChars(page))).toEqual(sheet);
    expect(await readCopy(stripChars(page))).toEqual(strip);
    await expect(input(page)).toHaveAttribute("data-errors", "1");
  });

  test("C4 C5 C6 Block: the wrong key jams the machine and holds the cursor; the right key releases it", async ({
    page,
    browser,
  }) => {
    const { text, first } = await race(page, browser, { errorMode: "block" });
    await expect(input(page)).toHaveAttribute("data-mode", "block");
    await expect(input(page)).toHaveAttribute("data-backspace", "on");
    const wrong = wrongFor(first);
    const teleprinter = page.locator('[data-machine][data-skin="teleprinter"]');
    await expect(teleprinter).toHaveCount(1);
    const deck = teleprinter.locator('[data-part="deck"]');
    const slot = teleprinter.locator('[data-part="slot"]');
    const space = teleprinter.locator('[data-key=" "]');
    // a cap that is neither the struck key nor the space bar: its colours at rest
    const cap = teleprinter.locator(`[data-key="${wrong === "q" ? "w" : "q"}"]`);
    const rest = { deck: await look(deck), cap: await look(cap) };
    expect([rest.deck.bg, rest.cap.bg, rest.cap.color, rest.cap.border]).toEqual([
      DECK,
      INK,
      PAPER,
      INK,
    ]);
    expect([(await look(slot)).bg, (await look(space)).bg]).toEqual([INK, INK]);

    await page.keyboard.press(wrong);
    await expect(machine(page)).toHaveAttribute("data-jammed", "true");
    await expect(keyCap(page, wrong)).toHaveAttribute("data-wrong", "true");
    // the cursor holds and nothing lands on the sheet (only the caret cell)
    expect(await readCopy(sheetChars(page))).toEqual({ next: 0, chars: [`${first}:next`] });
    expect(await readCopy(stripChars(page))).toMatchObject({ next: 0 });
    await expect(page.locator('[data-telex] [data-state="wrong"]')).toHaveCount(0);
    // the teleprinter jams: the X, the slot and the space bar red, every outline red, caps and deck kept
    await expect(teleprinter.locator('[data-part="jam"]')).toHaveCount(1);
    expect((await look(slot)).bg).toBe(RED);
    expect((await look(space)).bg).toBe(RED);
    const jammedCap = await look(cap);
    expect([jammedCap.bg, jammedCap.color, jammedCap.border]).toEqual([INK, PAPER, RED]);
    expect((await look(deck)).bg).toBe(rest.deck.bg);

    // R217, Block: the same wrong key three times holds the cursor and counts three errors
    await page.keyboard.press(wrong);
    await page.keyboard.press(wrong);
    await expect(input(page)).toHaveAttribute("data-errors", "3");
    expect(await readCopy(sheetChars(page))).toMatchObject({ next: 0 });
    expect(await readCopy(stripChars(page))).toMatchObject({ next: 0 });
    await expect(machine(page)).toHaveAttribute("data-jammed", "true");

    // the right key releases the jam and the cursor moves on by one
    await page.keyboard.type(first);
    await expect(machine(page)).not.toHaveAttribute("data-jammed", /.*/);
    await expect(teleprinter.locator('[data-part="jam"]')).toHaveCount(0);
    await expect(machine(page).locator('[data-wrong="true"]')).toHaveCount(0);
    expect(await readCopy(sheetChars(page))).toMatchObject({ next: 1 });
    expect(await readCopy(stripChars(page))).toMatchObject({ next: 1 });
    expect((await look(slot)).bg).toBe(INK);
    expect((await look(cap)).border).toBe(INK);
    await expect(input(page)).toHaveAttribute("data-errors", "3");

    // #559 review: a refused key no longer pops the char before the cursor again (no remount)
    const second = Array.from(text)[1]!;
    const typed = page.locator('[data-sheet] [data-last="true"]');
    await expect(typed).toHaveCount(1);
    await typed.evaluate((el) => el.setAttribute("data-probe", "kept"));
    await page.keyboard.press(wrongFor(second));
    await expect(machine(page)).toHaveAttribute("data-jammed", "true");
    await expect(page.locator('[data-sheet] [data-probe="kept"][data-last="true"]')).toHaveCount(1);
  });
});
