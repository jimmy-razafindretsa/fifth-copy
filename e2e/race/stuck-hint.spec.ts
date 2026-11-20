import type { Browser, BrowserContext, Page } from "@playwright/test";
import { STUCK_HINT_MS } from "@/features/race/view/stuck-hint";
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

// Contract of #999 C31, C32, live over the race server started by playwright.config.ts: a French race
// text of random words holding `ç` (the host's practice letter, so 40 % of the words carry it), Block
// mode. The guest types the copy right up to the first `ç`, then presses a wrong key three times on it:
// the stuck hint `STUCK ON ç? HERE'S HOW →` shows once, its link `/guide#c-cedilla` in a new tab, the
// focus kept in the race input; it goes after 8 s (`STUCK_HINT_MS`) or on a click. Three more misses on
// a later `ç` of the same race make no second hint. Tablet and desktop only (the seat view is tablet+).

const input = (page: Page) => page.getByRole("textbox", { name: "Text to type" });
const hint = (page: Page) => page.locator('[data-notice="stuck-hint"]');
const stripText = async (page: Page) =>
  (await page.locator("[data-telex] [data-state]").allTextContents()).join("");
/** The strip's caret: the index of the `next` char. */
const caret = (page: Page) =>
  page
    .locator("[data-telex] [data-state]")
    .evaluateAll((spans) => spans.findIndex((s) => s.getAttribute("data-state") === "next"));

test.describe("#999 stuck hint, live", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 768, "the seat view is tablet+ (#561 C5)");

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  /** A Block race on a French text holding `ç`; resolves at GO with the race text. */
  async function race(page: Page, browser: Browser) {
    const room = await hostRoom(browser, opened, { before: recordRaceTokens });
    await setHostSettings(room.host, {
      errorMode: "block",
      language: "fr",
      textType: "words",
      wordCount: 10,
      practiceLetters: ["ç"],
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
    const text = await stripText(page);
    expect(text, "the race text holds ç twice").toMatch(/ç.*ç/);
    return text;
  }

  /** Types the copy right from the caret up to (not including) `index`. */
  async function typeUpTo(page: Page, text: string, index: number) {
    const from = await caret(page);
    await page.keyboard.type(text.slice(from, index), { delay: 28 });
    await expect.poll(() => caret(page)).toBe(index);
  }

  /** Three wrong presses on the char under the caret (Block: the cursor holds, three errors). */
  async function missThrice(page: Page) {
    const errors = Number(await input(page).getAttribute("data-errors"));
    for (let i = 0; i < 3; i++) await page.keyboard.press("q");
    await expect(input(page)).toHaveAttribute("data-errors", String(errors + 3));
  }

  test("C31 C32 three misses on ç: the hint shows once, keeps the focus, goes after 8 s; a later ç makes no second one", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(120_000));
    const text = await race(page, browser);
    const first = text.indexOf("ç");
    await typeUpTo(page, text, first);
    await expect(hint(page)).toHaveCount(0);

    await missThrice(page);
    await expect(hint(page)).toHaveCount(1);
    const shownAt = Date.now();
    await expect(hint(page)).toHaveText("STUCK ON ç? HERE'S HOW →");
    await expect(hint(page)).toHaveAttribute("role", "status");
    const link = hint(page).getByRole("link", { name: "HERE'S HOW →" });
    await expect(link).toHaveAttribute("href", "/guide#c-cedilla");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener");
    // it never takes the focus: the race input keeps it and the next key types
    await expect(input(page)).toBeFocused();
    await page.keyboard.type("ç");
    await expect.poll(() => caret(page)).toBe(first + 1);

    // it goes on its own after 8 s
    await expect(hint(page)).toHaveCount(0, { timeout: scaled(STUCK_HINT_MS + 6_000) });
    expect(Date.now() - shownAt).toBeGreaterThanOrEqual(STUCK_HINT_MS - 500);

    // the same character later in the race: no second hint
    const second = text.indexOf("ç", first + 1);
    await typeUpTo(page, text, second);
    await missThrice(page);
    await page.waitForTimeout(scaled(1_000));
    await expect(hint(page)).toHaveCount(0);
  });

  test("C31 a click on the link opens the guide's entry in a new tab, hides the hint and keeps the focus", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(120_000));
    const text = await race(page, browser);
    await typeUpTo(page, text, text.indexOf("ç"));
    await missThrice(page);
    await expect(hint(page)).toHaveCount(1);

    const [guide] = await Promise.all([
      page.context().waitForEvent("page"),
      hint(page).getByRole("link", { name: "HERE'S HOW →" }).click(),
    ]);
    await expect(guide).toHaveURL(/\/guide#c-cedilla$/);
    await guide.close();
    await expect(hint(page)).toHaveCount(0);
    await expect(input(page)).toBeFocused();
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "running");
  });
});
