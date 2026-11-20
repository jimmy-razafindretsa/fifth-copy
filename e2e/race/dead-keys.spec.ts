import type { Browser, BrowserContext, CDPSession, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { scaled } from "../timeouts";
import {
  hostRoom,
  openRace,
  phaseOf,
  recordRaceTokens,
  setHostSettings,
  startButton,
  warmRace,
} from "./helpers";

// Contract of #1001 C5, live over the race server started by playwright.config.ts: in a running Block
// race on a French text holding `ê` and `ç` (the host's practice letters), the guest's cursor stands on
// an `ê` (the host cannot set the text itself, so the copy is typed up to it). Composing `^` then `e`
// through CDP (`Input.imeSetComposition` + `Input.insertText`, the macOS / IME model) advances the
// cursor by one with no error; the same through the dead-key model (`Input.dispatchKeyEvent` with
// `key: "Dead"`, then `e` and an `insertText` of `ê`, the Windows model) does too; `c` then a composed
// `ç` scores one wrong and one correct keystroke; the machine never flashes red on the dead key.
// Chromium only (CDP); tablet and desktop (the seat view is tablet+).

const input = (page: Page) => page.getByRole("textbox", { name: "Text to type" });
const stripText = async (page: Page) =>
  (await page.locator("[data-telex] [data-state]").allTextContents()).join("");
/** The strip's caret: the index of the `next` char. */
const caret = (page: Page) =>
  page
    .locator("[data-telex] [data-state]")
    .evaluateAll((spans) => spans.findIndex((s) => s.getAttribute("data-state") === "next"));
const errors = async (page: Page) => Number(await input(page).getAttribute("data-errors"));

test.describe("#1001 dead keys and composition, live", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 768, "the seat view is tablet+ (#561 C5)");
  test.skip(({ browserName }) => browserName !== "chromium", "CDP input is Chromium's");

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  /** A Block race on a French text holding `ê` and `ç`; resolves at GO with the race text. */
  async function race(page: Page, browser: Browser) {
    const room = await hostRoom(browser, opened, { before: recordRaceTokens });
    await setHostSettings(room.host, {
      errorMode: "block",
      language: "fr",
      textType: "words",
      wordCount: 20,
      practiceLetters: ["ê", "ç"],
      includeNumbers: false,
      includeSymbols: false,
      includePunctuation: false,
      bonuses: false,
    });
    await openRace(page, room);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^SEAT VIEW · DESK \d{2}$/);
    await expect(startButton(room.host)).toBeEnabled();
    await warmRace(room.host, room.lobbyId);
    await startButton(room.host).click();
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", {
      timeout: scaled(10_000),
    });
    await expect(input(page)).toBeFocused();
    await expect(input(page)).toHaveAttribute("data-mode", "block");
    return stripText(page);
  }

  /** Types the copy right from the caret up to (not including) `index`. */
  async function typeUpTo(page: Page, text: string, index: number) {
    const from = await caret(page);
    await page.keyboard.type(text.slice(from, index), { delay: 28 });
    await expect.poll(() => caret(page)).toBe(index);
  }

  /** Records every key of the machine that turns `data-wrong` from now on. */
  async function watchRed(page: Page) {
    await page.evaluate(() => {
      const w = window as unknown as { __red: string[] };
      w.__red = [];
      const machine = document.querySelector("[data-machine]");
      if (!machine) throw new Error("no machine");
      new MutationObserver((records) => {
        for (const r of records) {
          const el = r.target as Element;
          if (el.getAttribute("data-wrong") === "true") w.__red.push(el.getAttribute("data-key") ?? "?");
        }
      }).observe(machine, { attributes: true, subtree: true, attributeFilter: ["data-wrong"] });
      for (const el of machine.querySelectorAll('[data-wrong="true"]')) {
        w.__red.push(el.getAttribute("data-key") ?? "?");
      }
    });
  }
  const reds = (page: Page) =>
    page.evaluate(() => (window as unknown as { __red: string[] }).__red);

  async function compose(cdp: CDPSession, accent: string, result: string) {
    await cdp.send("Input.imeSetComposition", {
      text: accent,
      selectionStart: accent.length,
      selectionEnd: accent.length,
    });
    await cdp.send("Input.insertText", { text: result });
  }

  test("C5 ^ then e composes ê in both event models; c then ç is one wrong and one correct; no red on the dead key", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(120_000));
    const text = await race(page, browser);
    const first = text.indexOf("ê");
    const second = text.indexOf("ê", first + 1);
    expect(first, "the race text holds ê twice").toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
    const cdp = await page.context().newCDPSession(page);

    // 1. composition model (IME / macOS): the accent alone types nothing, the commit types ê once
    await typeUpTo(page, text, first);
    const errorsBefore = await errors(page);
    await watchRed(page);
    await cdp.send("Input.imeSetComposition", { text: "^", selectionStart: 1, selectionEnd: 1 });
    await page.waitForTimeout(scaled(200));
    expect(await caret(page), "the accent alone does not move the cursor").toBe(first);
    expect(await reds(page)).toEqual([]);
    await cdp.send("Input.insertText", { text: "ê" });
    await expect.poll(() => caret(page)).toBe(first + 1);
    expect(await errors(page)).toBe(errorsBefore);
    expect(await reds(page)).toEqual([]);

    // 2. dead key without composition (Windows): Dead, then e whose insert is ê
    await typeUpTo(page, text, second);
    await cdp.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Dead",
      code: "BracketLeft",
      windowsVirtualKeyCode: 219,
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Dead",
      code: "BracketLeft",
      windowsVirtualKeyCode: 219,
    });
    await page.waitForTimeout(scaled(200));
    expect(await caret(page), "the dead key alone does not move the cursor").toBe(second);
    expect(await reds(page), "the machine never flashes red on the dead key").toEqual([]);
    await cdp.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "e",
      code: "KeyE",
      windowsVirtualKeyCode: 69,
    });
    await cdp.send("Input.insertText", { text: "ê" });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "e",
      code: "KeyE",
      windowsVirtualKeyCode: 69,
    });
    await expect.poll(() => caret(page)).toBe(second + 1);
    expect(await errors(page)).toBe(errorsBefore);
    expect(await reds(page)).toEqual([]);

    // 3. c then a composed ç: one wrong (Block holds the cursor), then one correct
    const cedilla = text.indexOf("ç", second + 1);
    expect(cedilla, "a ç after the second ê").toBeGreaterThan(second);
    await typeUpTo(page, text, cedilla);
    const errorsAtC = await errors(page);
    await page.keyboard.press("c");
    await expect(input(page)).toHaveAttribute("data-errors", String(errorsAtC + 1));
    expect(await caret(page)).toBe(cedilla);
    await compose(cdp, "¸", "ç");
    await expect.poll(() => caret(page)).toBe(cedilla + 1);
    expect(await errors(page)).toBe(errorsAtC + 1);
  });
});
