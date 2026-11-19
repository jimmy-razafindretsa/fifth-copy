import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { type Desk, postResults, seedLobby, startRace, withoutWebGL } from "../results/helpers";
import { HYDRATION_WAIT, scaled } from "../timeouts";

// Contract of #999 C43: the Personnel file's personal bests (bible 14.3 "Personal bests"): best clean
// WPM per language, text type and length, and the French versus English comparison. States: no races
// yet (a fresh guest), one language only (English races), populated (English short and medium texts
// and a French one, filed through the signed internal routes). Desktop, tablet and phone (the
// projects), light and Night shift: axe-clean, the page never scrolls sideways.

const bests = (page: Page) => page.locator('[data-section="bests"]');
const row = (page: Page, key: string) => bests(page).locator(`[data-best="${key}"]`);
const language = (page: Page, lang: "FR" | "EN") =>
  bests(page).locator(`[data-bests-language="${lang}"]`);

async function openFile(page: Page) {
  await page.goto("/profile");
  await expect(page.locator("[data-profile-state]")).toBeVisible({ timeout: HYDRATION_WAIT });
}

async function axeClean(page: Page, label: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const { violations } = await new AxeBuilder({ page })
      .include('[data-section="bests"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(
      bad.map((v) => `${v.id}: ${v.nodes.length}`),
      `${label} ${scheme}`,
    ).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow, `${label} ${scheme}: sideways scroll`).toBe(false);
  }
}

/** One finished race for the host against a bot, on a text of that language and length. */
async function race(
  request: Parameters<typeof startRace>[0],
  lobby: Awaited<ReturnType<typeof seedLobby>>,
  wpm: number,
  text: { language: "en" | "fr"; wordCount: number },
) {
  const desks: Desk[] = [
    { desk: 1, name: "Host", place: 1, wpm, accuracy: 0.95, userId: lobby.hostUserId },
    { desk: 2, name: "Typist Bot", place: 2, wpm: 20, isBot: true },
  ];
  await postResults(request, await startRace(request, lobby, desks, text), desks);
}

test.describe("#999 C43 personal bests on the Personnel file", () => {
  test.setTimeout(scaled(150_000));

  test.beforeEach(async ({ context, page }) => {
    const url = test.info().project.use.baseURL!;
    await context.addCookies([{ name: "locale", value: "en", url }]);
    await withoutWebGL(page);
  });

  test("no races yet: the section says what it will hold, no table", async ({ page }) => {
    await seedLobby(page);
    await openFile(page);
    await expect(bests(page)).toHaveAttribute("data-bests", "none");
    await expect(bests(page).getByRole("heading", { name: "Personal bests" })).toBeVisible();
    await expect(bests(page).locator("[data-bests-none]")).toHaveText(/^No best on file yet\./);
    await expect(bests(page).locator("table")).toHaveCount(0);
    await axeClean(page, "none");
  });

  test("one language only: English bests, French reads dashes and asks for a race", async ({
    page,
    request,
  }) => {
    const lobby = await seedLobby(page);
    await race(request, lobby, 52.5, { language: "en", wordCount: 20 });
    await openFile(page);
    await expect(bests(page)).toHaveAttribute("data-bests", "one-language");
    await expect(bests(page).locator("[data-bests-verdict]")).toHaveText(
      "Only English on file so far. Race in French to compare.",
    );
    await expect(language(page, "FR")).toHaveText(/FRENCH\s*0\s*—\s*—/);
    await expect(language(page, "EN").locator("[data-bests-best]")).toHaveText("52.5");
    await expect(row(page, "EN-SENTENCES-SHORT")).toContainText("SENTENCES · SHORT");
    await expect(row(page, "EN-SENTENCES-SHORT").locator("[data-best-wpm]")).toHaveText("52.5");
    await expect(bests(page).locator("[data-best]")).toHaveCount(1);
    await axeClean(page, "one language");
  });

  test("populated: bests per language and length, French versus English, in both languages", async ({
    page,
    request,
    context,
  }) => {
    const lobby = await seedLobby(page);
    await race(request, lobby, 61.4, { language: "en", wordCount: 20 });
    await race(request, lobby, 48.2, { language: "en", wordCount: 40 });
    await race(request, lobby, 44.0, { language: "fr", wordCount: 20 });
    // a slower short English race keeps the best
    await race(request, lobby, 50.0, { language: "en", wordCount: 20 });
    await openFile(page);

    await expect(bests(page)).toHaveAttribute("data-bests", "populated");
    // English: 61.4, 48.2, 50.0 -> average 53.2; French 44.0 -> 9.2 slower
    await expect(bests(page).locator("[data-bests-verdict]")).toHaveText(
      "In French you type 9.2 WPM slower than in English, on average.",
    );
    await expect(language(page, "EN")).toHaveText(/ENGLISH\s*3\s*61\.4\s*53\.2/);
    await expect(language(page, "FR")).toHaveText(/FRENCH\s*1\s*44\.0\s*44\.0/);
    const keys = await bests(page)
      .locator("[data-best]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-best")));
    expect(keys).toEqual(["FR-SENTENCES-SHORT", "EN-SENTENCES-SHORT", "EN-SENTENCES-MEDIUM"]);
    await expect(row(page, "EN-SENTENCES-SHORT").locator("[data-best-wpm]")).toHaveText("61.4");
    await expect(row(page, "EN-SENTENCES-MEDIUM").locator("[data-best-wpm]")).toHaveText("48.2");
    await expect(row(page, "EN-SENTENCES-MEDIUM")).toContainText("SENTENCES · MEDIUM");
    // the table is real and its scroll is its own
    await expect(
      bests(page).getByRole("region", { name: "Personal bests, scrolls sideways" }),
    ).toBeVisible();
    await axeClean(page, "populated");

    const url = test.info().project.use.baseURL!;
    await context.addCookies([{ name: "locale", value: "fr", url }]);
    await openFile(page);
    await expect(bests(page).getByRole("heading", { name: "Records personnels" })).toBeVisible();
    await expect(bests(page).locator("[data-bests-verdict]")).toHaveText(
      "En français, tu tapes 9,2 MPM moins vite qu'en anglais, en moyenne.",
    );
    await expect(row(page, "FR-SENTENCES-SHORT")).toContainText("PHRASES · COURT");
  });
});
