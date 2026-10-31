import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { HYDRATION_WAIT, scaled } from "../timeouts";
import { postResults, seedLobby, six, startRace, thirty, withoutWebGL, type Desk } from "./helpers";

// Contract of #301 C3, C4: the ranking docket under the podium on /results/<raceId>, from races seeded
// through the signed internal routes (helpers.ts). Every project runs it: mobile (375, two-line rows),
// tablet (768) and desktop (1280) (one line).

const docket = (page: Page) => page.locator("[data-ranking]");
const rows = (page: Page) => docket(page).locator("tbody tr");
const row = (page: Page, desk: number) => docket(page).locator(`tbody tr[data-desk="${desk}"]`);
const cell = (r: Locator, col: string) => r.locator(`[data-col="${col}"]`);

/** A finished race of these desks on the page's own lobby (its host is the viewer). */
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
  await expect(docket(page)).toBeVisible({ timeout: HYDRATION_WAIT });
}

/** No horizontal scroll on the page nor inside the docket (pattern of e2e/landing.spec.ts). */
async function expectNoHorizontalScroll(page: Page) {
  const [page_, docket_] = await Promise.all([
    page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]),
    docket(page).evaluate((el) => [el.scrollWidth, el.clientWidth]),
  ]);
  expect(page_[0], "page scrollWidth").toBeLessThanOrEqual(page_[1]!);
  expect(docket_[0], "docket scrollWidth").toBeLessThanOrEqual(docket_[1]!);
}

test.describe("Dawn report ranking (#301)", () => {
  test.setTimeout(scaled(90_000));

  test("C4 C3 six desks in place order with LINE CUT, UNDER REVIEW, BOT and YOU; the row layout", async ({
    page,
    request,
  }, info) => {
    await report(page, request, six);
    const table = page.getByRole("table", { name: "FORM 5-R · RANKING" });
    await expect(table).toBeVisible();
    for (const name of ["№", "TYPIST", "DESK", "WPM", "ACCURACY", "STATUS"]) {
      await expect(table.getByRole("columnheader", { name, exact: true })).toBeVisible();
    }

    await expect(rows(page)).toHaveCount(6);
    expect(
      await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-place"))),
    ).toEqual(["01", "02", "03", "04", "05", "06"]);
    expect(
      await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-desk"))),
    ).toEqual(["7", "3", "12", "4", "9", "6"]);

    // desk 4: LINE CUT; desk 6: UNDER REVIEW; desk 3: the bot; desk 7: the viewer (the page's host)
    await expect(row(page, 4)).toHaveAttribute("data-status", "LINE_CUT");
    await expect(cell(row(page, 4), "status")).toHaveText("LINE CUT");
    await expect(row(page, 6).getByText("UNDER REVIEW", { exact: true })).toBeVisible();
    await expect(row(page, 3).getByText("BOT", { exact: true })).toBeVisible();
    await expect(row(page, 7)).toHaveAttribute("data-you", "true");
    await expect(row(page, 7).getByText("YOU", { exact: true })).toBeVisible();
    await expect(docket(page).locator('tbody tr[data-you="true"]')).toHaveCount(1);
    await expect(docket(page).getByText("YOU", { exact: true })).toHaveCount(1);
    await expect(docket(page).getByText("UNDER REVIEW", { exact: true })).toHaveCount(1);
    await expect(docket(page).getByText("BOT", { exact: true })).toHaveCount(1);
    // the first row: clean WPM (ADR 0016) and accuracy as a whole percent
    await expect(cell(row(page, 7), "wpm")).toHaveText("61");
    await expect(cell(row(page, 7), "accuracy")).toHaveText("97 %");
    await expect(cell(row(page, 7), "desk")).toHaveText("DESK 07");
    await expect(cell(row(page, 7), "portrait")).toHaveText("L");

    // C3: at 375 desk and accuracy move to a second line of the same row; from 768 one line
    await docket(page).scrollIntoViewIfNeeded();
    for (const desk of [7, 3, 4, 6]) {
      const r = row(page, desk);
      const top = async (col: string) => (await cell(r, col).boundingBox())!;
      const name = await top("name");
      const deskCell = await top("desk");
      const firstLine = [
        await top("place"),
        await top("portrait"),
        await top("wpm"),
        await top("status"),
      ];
      if (info.project.name === "mobile") {
        expect(deskCell.y, `desk ${desk}: desk cell under the name`).toBeGreaterThan(name.y + 8);
        expect((await top("accuracy")).y, `desk ${desk}: accuracy on line two`).toBeGreaterThan(
          name.y + 8,
        );
        for (const b of firstLine) expect(b.y, `desk ${desk}: first line`).toBeLessThan(deskCell.y);
      } else {
        const mid = (b: { y: number; height: number }) => b.y + b.height / 2;
        expect(Math.abs(mid(deskCell) - mid(name)), `desk ${desk}: one line`).toBeLessThan(6);
        expect(Math.abs(mid(await top("accuracy")) - mid(name))).toBeLessThan(6);
        for (const b of firstLine) expect(Math.abs(mid(b) - mid(name))).toBeLessThan(6);
      }
    }
    await expectNoHorizontalScroll(page);
  });

  test("C4 C3 thirty desks: 30 rows in one docket, the header row sticky while it scrolls", async ({
    page,
    request,
  }) => {
    await report(page, request, thirty);
    await expect(rows(page)).toHaveCount(30);
    await expect(page.locator("[data-ranking]")).toHaveCount(1);
    expect(
      await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-place"))),
    ).toEqual(Array.from({ length: 30 }, (_, i) => String(i + 1).padStart(2, "0")));
    await expect(row(page, 1)).toHaveAttribute("data-you", "true");
    for (const status of ["FINISHED", "TIMED_OUT", "REASSIGNED", "ASLEEP", "LINE_CUT", "EXPIRED"]) {
      await expect(
        docket(page).locator(`tbody tr[data-status="${status}"]`).first(),
      ).toBeAttached();
    }

    // the docket scrolls inside itself; scrolled to the end, the column header row still sits on top
    await docket(page).scrollIntoViewIfNeeded();
    const scrolls = await docket(page).evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(scrolls, "30 rows overflow the docket's 60vh").toBe(true);
    await docket(page).evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect.poll(() => docket(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    const head = docket(page).locator("thead");
    const box = (await docket(page).boundingBox())!;
    const headBox = (await head.boundingBox())!;
    expect(Math.abs(headBox.y - box.y), "header row stuck to the docket's top").toBeLessThanOrEqual(
      3,
    );
    await expect(row(page, 30)).toBeInViewport();
    await expect(head.getByRole("columnheader", { name: "WPM" })).toBeInViewport();
    await expectNoHorizontalScroll(page);
  });
});
