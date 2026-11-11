import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { joinAsGuest } from "../race/helpers";
import { ACTION_WAIT } from "../timeouts";
import { becomeGuest, guestIdOf, SEEDED_VERSION, seedAvatar } from "./avatar-helpers";

// Contract C7 of #880: lobby-scoped avatars over the real dev server and the race server started by
// playwright.config.ts (ADR 0022: the web asks it whether two users share a live room). Two guests
// seated in one private room see each other's avatar; a guest of another room and a request with no
// cookie get 404 for both.

const roll = (page: Page) => page.getByRole("list", { name: "Typists in the room" }).locator("li");
const url = (userId: string, size = 256) =>
  `/api/avatars/${userId}?size=${size}&v=${SEEDED_VERSION}`;

test.describe("lobby-scoped avatar access (#880)", () => {
  // One project is enough: the route has no layout.
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project only");

  const opened: BrowserContext[] = [];
  const cleanups: (() => Promise<void>)[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  test("C7 room mates load each other's avatar; another room's guest and no cookie get 404", async ({
    browser,
    playwright,
  }) => {
    const baseURL = test.info().project.use.baseURL;

    // A hosts a private room, B joins it by code: both names on both rolls.
    const a = await browser.newContext({ baseURL });
    opened.push(a);
    const aPage = await a.newPage();
    const aId = await becomeGuest(aPage);
    const code = /\/lobby\/(.+)$/.exec(new URL(aPage.url()).pathname)![1]!;
    const b = await joinAsGuest(browser, code);
    opened.push(b.context);
    for (const page of [aPage, b.page]) {
      await expect(roll(page)).toHaveCount(2, { timeout: ACTION_WAIT });
    }
    // B's guest cookie is minted when it takes its seat (the race token), so read it once seated.
    const bId = await guestIdOf(b.page);
    expect(bId).not.toBe(aId);

    cleanups.push(await seedAvatar(aId), await seedAvatar(bId));

    for (const [page, owner, who] of [
      [aPage, bId, "A loads B"],
      [b.page, aId, "B loads A"],
      [aPage, aId, "A loads A"],
    ] as const) {
      for (const size of [256, 64]) {
        const res = await page.request.get(url(owner, size));
        expect(res.status(), `${who} size=${size}`).toBe(200);
        expect(res.headers()["content-type"]).toBe("image/webp");
        expect(res.headers()["cache-control"]).toMatch(/^private/);
        expect(res.headers()["vary"]).toMatch(/(^|, )Cookie(,|$)/);
      }
    }

    // C: a guest in another room of its own.
    const c = await browser.newContext({ baseURL });
    opened.push(c);
    const cPage = await c.newPage();
    const cId = await becomeGuest(cPage);
    expect([aId, bId]).not.toContain(cId);
    for (const owner of [aId, bId]) {
      const res = await cPage.request.get(url(owner));
      expect(res.status(), `other room's guest -> ${owner === aId ? "A" : "B"}`).toBe(404);
      expect(res.headers()["cache-control"]).toBe("private, no-store");
      expect(await res.body()).toHaveLength(0);
    }

    // No cookie at all.
    const anonymous = await playwright.request.newContext({ baseURL });
    try {
      for (const owner of [aId, bId]) {
        const res = await anonymous.get(url(owner));
        expect(res.status(), "anonymous").toBe(404);
        expect(res.headers()["vary"]).toMatch(/(^|, )Cookie(,|$)/);
      }
    } finally {
      await anonymous.dispose();
    }
  });
});
