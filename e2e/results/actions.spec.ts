import type { Page } from "@playwright/test";
import { freshUsername, PASSWORD, signUpThroughForm } from "../auth/auth-helpers";
import { expect, test } from "../fixtures";
import { HYDRATION_WAIT, scaled } from "../timeouts";
import { postResults, seedLobby, six, startRace, withoutWebGL } from "./helpers";

// Contract of #863 C3: the Dawn report's action row (bible 14.4) on /results/<raceId>, from a race seeded
// through the signed internal routes (helpers.ts) on the page's own open lobby (its host is the viewer,
// a member). A guest sees RACE AGAIN, the front desk link and the prompt to open a file; the prompt's
// link lands on /sign-up, the front desk link on /. An account that raced sees the two links, no prompt.
// Every project runs it: under 640px each link fills the row (C2).

const row = (page: Page) => page.locator('[data-slot="actions"]');
const raceAgain = (page: Page) => row(page).getByRole("link", { name: "RACE AGAIN", exact: true });
const frontDesk = (page: Page) =>
  row(page).getByRole("link", { name: "BACK TO THE FRONT DESK →", exact: true });
const prompt = (page: Page) => row(page).locator("[data-prompt]");
const openAFile = (page: Page) => prompt(page).getByRole("link", { name: "OPEN A FILE →" });

/** A finished race of six desks on the page's own lobby; returns its report path. */
async function report(page: Page, request: Parameters<typeof startRace>[0]) {
  // the podium's clerk frames are not under test: their stamp fallback keeps software GL out of the way
  await withoutWebGL(page);
  const lobby = await seedLobby(page);
  const desks = six(lobby.hostUserId);
  const raceId = await startRace(request, lobby, desks);
  await postResults(request, raceId, desks);
  const path = `/results/${raceId}`;
  await page.goto(path);
  await expect(row(page)).toBeVisible({ timeout: HYDRATION_WAIT });
  return path;
}

/** Each link at least 44px high; under 640px as wide as the row (bible 14.4, 18). */
async function expectTargets(page: Page, links: ReturnType<typeof raceAgain>[]) {
  const width = page.viewportSize()!.width;
  const rowBox = (await row(page).boundingBox())!;
  for (const link of links) {
    const box = (await link.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    if (width < 640) expect(box.width).toBeGreaterThanOrEqual(rowBox.width - 30);
  }
}

test.describe("Dawn report action row (#863)", () => {
  test.setTimeout(scaled(90_000));

  test("C3 a guest who raced: RACE AGAIN, the front desk, the prompt; each lands where it says", async ({
    page,
    request,
  }) => {
    const path = await report(page, request);
    await expect(raceAgain(page)).toHaveAttribute("href", /^\/lobby\/[^/]+$/);
    await expect(frontDesk(page)).toHaveAttribute("href", "/");
    await expect(prompt(page)).toContainText("Open a file and these results stay in your name.");
    await expect(openAFile(page)).toHaveAttribute("href", "/sign-up");
    await expectTargets(page, [raceAgain(page), frontDesk(page), openAFile(page)]);

    await openAFile(page).click();
    await expect(page).toHaveURL(/\/sign-up$/);
    await page.goto(path);
    await frontDesk(page).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("C3 an account that raced: RACE AGAIN and the front desk, no prompt", async ({
    page,
    request,
  }) => {
    await signUpThroughForm(page, freshUsername("act"), PASSWORD);
    await report(page, request);
    await expect(raceAgain(page)).toBeVisible();
    await expect(frontDesk(page)).toBeVisible();
    await expectTargets(page, [raceAgain(page), frontDesk(page)]);
    await expect(prompt(page)).toHaveCount(0);
    await expect(row(page).getByRole("link", { name: "OPEN A FILE →" })).toHaveCount(0);
  });
});
