import type { BrowserContext, Page } from "@playwright/test";
import { wordCount } from "@fifth-copy/engine";
import { expect, test } from "../fixtures";
import { scaled } from "../timeouts";
import { createLobby, joinAsGuest, lobbyIdOf, phaseOf, startButton, warmRace } from "./helpers";

// Contract of #351 C8: the host's text settings in the FORM 5-L rows reach the generator. RANDOM WORDS,
// HARD, 30 WORDS gives a telex text of exactly 30 words; a second lobby with REAL SENTENCES and 10 WORDS
// gives 10. Words are counted with the engine's `wordCount`, as the generator counts them.

const RACE_PATH = /\/race\/([0-9a-f-]{36})$/;
const docket = (page: Page) => page.getByRole("region", { name: "RACE SETTINGS" });
const segment = (page: Page, row: string, name: string) =>
  docket(page)
    .getByRole("group", { name: row, exact: true })
    .getByRole("button", { name, exact: true });
const stripText = async (page: Page) =>
  (await page.locator("[data-telex] [data-state]").allTextContents()).join("");

/** The host sets the text settings in the form, a guest joins, the host starts; returns the strip text. */
async function raceText(
  page: Page,
  browser: Parameters<typeof joinAsGuest>[0],
  opened: BrowserContext[],
  { textType, difficulty, words }: { textType: string; difficulty: string; words: number },
) {
  const code = await createLobby(page);
  const guest = await joinAsGuest(browser, code);
  opened.push(guest.context);
  for (const [row, name] of [
    ["TEXT TYPE", textType],
    ["DIFFICULTY", difficulty],
  ]) {
    await segment(page, row!, name!).click();
    await expect(segment(page, row!, name!)).toHaveAttribute("aria-pressed", "true");
  }
  const count = docket(page).getByRole("spinbutton", { name: "WORDS", exact: true });
  await count.fill(String(words));
  await count.press("Enter");
  // the guest's read-only docket shows the broadcast values: the room holds them
  const row = (label: string) =>
    docket(guest.page)
      .locator("dt")
      .filter({ hasText: new RegExp(`^${label}$`) })
      .locator("+ dd");
  await expect(row("TEXT TYPE")).toHaveText(textType, { timeout: scaled(5_000) });
  await expect(row("DIFFICULTY")).toContainText(difficulty, { timeout: scaled(5_000) });
  await expect(row("WORDS")).toHaveText(`${words} WORDS`, { timeout: scaled(5_000) });

  await expect(startButton(page)).toBeEnabled({ timeout: scaled(10_000) });
  await warmRace(page, await lobbyIdOf(code));
  await startButton(page).click();
  await expect(page).toHaveURL(RACE_PATH, { timeout: scaled(15_000) });
  await expect(phaseOf(page)).toHaveAttribute("data-phase", /countdown|running/, {
    timeout: scaled(10_000),
  });
  await expect(page.locator("[data-telex] [data-state]").first()).toBeAttached();
  return stripText(page);
}

test.describe("#351 host text settings reach the race text", () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project");

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  test("C8 RANDOM WORDS, HARD, 30 words: the telex holds exactly 30 words", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(90_000));
    const text = await raceText(page, browser, opened, {
      textType: "RANDOM WORDS",
      difficulty: "HARD",
      words: 30,
    });
    expect(wordCount(text), text).toBe(30);
    // HARD carries heavy punctuation (a mark in every 4 words): the difficulty reached the generator
    expect(text.match(/[,.!?;:]/g)?.length ?? 0, text).toBeGreaterThanOrEqual(7);
  });

  test("C8 REAL SENTENCES, 10 words: the telex holds exactly 10 words", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(90_000));
    const text = await raceText(page, browser, opened, {
      textType: "REAL SENTENCES",
      difficulty: "NORMAL",
      words: 10,
    });
    expect(wordCount(text), text).toBe(10);
  });
});
