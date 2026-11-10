import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { HYDRATION_WAIT, scaled } from "../timeouts";
import { postResults, seedLobby, six, startRace, withoutWebGL, type Desk } from "./helpers";

// Contract of #864 C3: the personal stats card in the Dawn report's `personal` slot (bible 14.4), from
// races seeded through the signed internal routes (helpers.ts) on the page's own lobby (its host is the
// viewer). A typist's card shows the place, WPM and accuracy of their ranking row and their bonuses by
// name; a spectator (a viewer with no desk) has no card and the ranking takes the full width. Every
// project runs it: 375 and 768 stack the slots, 1280 puts the card beside the ranking.

const card = (page: Page) => page.locator('[data-slot="personal"] [data-personal]');
const ranking = (page: Page) => page.locator("[data-ranking]");

/** A finished race of these desks on the page's own lobby. */
async function report(
  page: Page,
  request: Parameters<typeof startRace>[0],
  desks: (h: string) => Desk[],
) {
  // the podium's clerk frames are not under test: their stamp fallback keeps software GL out of the way
  await withoutWebGL(page);
  const lobby = await seedLobby(page);
  const seeded = desks(lobby.hostUserId);
  const raceId = await startRace(request, lobby, seeded);
  await postResults(request, raceId, seeded);
  await page.goto(`/results/${raceId}`);
  await expect(ranking(page)).toBeVisible({ timeout: HYDRATION_WAIT });
}

/** Six desks; the viewer is desk 12 (third), who sent two cards and was hit by one. */
const withBonuses = (host: string): Desk[] =>
  six(host).map((d) => {
    if (d.desk === 7) return { ...d, userId: null };
    if (d.desk !== 12) return d;
    return {
      ...d,
      userId: host,
      accuracy: 0.91,
      bonusLog: [
        { t: 9_000, kind: "extra-paperwork", from: 12, to: 7 },
        { t: 21_000, kind: "smoke-break", from: 12, to: 7 },
        { t: 21_000, kind: "smoke-break", from: 12, to: 3 },
        { t: 30_000, kind: "extra-paperwork", from: 4, to: 12 },
      ],
    };
  });

test.describe("Dawn report personal card (#864)", () => {
  test.setTimeout(scaled(90_000));

  test("C3 a typist's card: the place, WPM and accuracy of their ranking row; bonuses by name", async ({
    page,
    request,
  }, info) => {
    await report(page, request, withBonuses);
    await expect(card(page)).toHaveCount(1);
    await expect(page.getByRole("region", { name: "FORM 5-R · YOUR COPY" })).toBeVisible();

    const mine = ranking(page).locator('tbody tr[data-you="true"]');
    await expect(mine).toHaveAttribute("data-desk", "12");
    const place = Number(await mine.getAttribute("data-place"));
    const wpm = await mine.locator('[data-col="wpm"]').textContent();
    const accuracy = await mine.locator('[data-col="accuracy"]').textContent();
    await expect(card(page).locator('[data-field="place"]')).toHaveText(`№ ${place}`);
    await expect(card(page).locator('[data-field="wpm"]')).toHaveText(wpm!);
    await expect(card(page).locator('[data-field="accuracy"]')).toHaveText(accuracy!);
    expect(place).toBe(3);
    expect(wpm).toBe("48");
    expect(accuracy).toBe("91 %");
    await expect(card(page).locator('[data-field="status"]')).toHaveCount(0);

    const sent = card(page).locator('[data-row="sent"]');
    const received = card(page).locator('[data-row="received"]');
    await expect(sent.locator("li")).toHaveText(["EXTRA PAPERWORK × 1", "SMOKE BREAK × 1"]);
    await expect(received.locator("li")).toHaveText(["EXTRA PAPERWORK × 1"]);

    // beside the ranking from 1024px, stacked under it below (bible 14.4)
    await card(page).scrollIntoViewIfNeeded();
    const cardBox = (await card(page).boundingBox())!;
    const rankBox = (await ranking(page).boundingBox())!;
    if (info.project.name === "desktop") {
      expect(cardBox.x, "card right of the ranking").toBeGreaterThan(rankBox.x + rankBox.width);
      expect(cardBox.width).toBeGreaterThanOrEqual(280);
      expect(cardBox.width).toBeLessThanOrEqual(400);
    } else {
      expect(cardBox.y, "card under the ranking").toBeGreaterThan(rankBox.y + rankBox.height - 1);
    }
    const [scrollWidth, clientWidth] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test("C3 a typist with no bonuses reads NONE both ways; a cut line reads its status", async ({
    page,
    request,
  }) => {
    await report(page, request, (host) =>
      six(host).map((d) =>
        d.desk === 4 ? { ...d, userId: host } : d.desk === 7 ? { ...d, userId: null } : d,
      ),
    );
    await expect(card(page).locator('[data-row="sent"] dd')).toHaveText("NONE");
    await expect(card(page).locator('[data-row="received"] dd')).toHaveText("NONE");
    await expect(card(page).locator('[data-field="status"]')).toHaveText("LINE CUT");
    await expect(card(page).locator('[data-field="place"]')).toHaveText("№ 4");
  });

  test("C3 a spectator: no card, the ranking takes the full width", async ({ page, request }) => {
    await report(page, request, (host) => six(host).map((d) => ({ ...d, userId: null })));
    await expect(ranking(page).locator('tbody tr[data-you="true"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="personal"]')).toHaveCount(0);
    await expect(page.locator("[data-personal]")).toHaveCount(0);
    const slot = page.locator('[data-slot="ranking"]');
    const slots = (await slot.locator("..").boundingBox())!;
    const box = (await slot.boundingBox())!;
    expect(Math.abs(box.width - slots.width), "ranking spans the slots row").toBeLessThan(2);
  });
});
