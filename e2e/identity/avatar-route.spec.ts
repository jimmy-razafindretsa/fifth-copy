import sharp from "sharp";
import { expect, test } from "../fixtures";
import { becomeGuest, SEEDED_VERSION as VERSION, seedAvatar } from "./avatar-helpers";

// Contract C8 of #62: GET /api/avatars/[userId] over the real dev server. The owner's avatar is
// seeded the way uploadAvatar leaves it (`seedAvatar`, shared with #880's avatar-access spec).

test.describe("avatar route (#62)", () => {
  // One project is enough: the route has no layout.
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project only");

  test("C8 owner gets the WebP; other guests and anonymous get 404; bad size is 400", async ({
    page,
    browser,
    playwright,
  }) => {
    const ownerId = await becomeGuest(page);
    const cleanup = await seedAvatar(ownerId);
    try {
      const url = (size: number | string) => `/api/avatars/${ownerId}?size=${size}&v=${VERSION}`;

      for (const size of [256, 64]) {
        const res = await page.request.get(url(size));
        expect(res.status(), `owner size=${size}`).toBe(200);
        expect(res.headers()["content-type"]).toBe("image/webp");
        expect(res.headers()["cache-control"]).toBe("private, max-age=31536000, immutable");
        expect(res.headers()["x-content-type-options"]).toBe("nosniff");
        const meta = await sharp(await res.body()).metadata();
        expect(meta).toMatchObject({ format: "webp", width: size, height: size });
      }
      expect((await page.request.get(url(999))).status(), "owner size=999").toBe(400);

      // Another guest, in a separate browser context with its own fc_guest cookie.
      const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
      try {
        const otherPage = await other.newPage();
        const otherId = await becomeGuest(otherPage);
        expect(otherId).not.toBe(ownerId);
        expect((await otherPage.request.get(url(256))).status(), "other guest").toBe(404);
      } finally {
        await other.close();
      }

      // Anonymous: no cookies at all.
      const anonymous = await playwright.request.newContext({
        baseURL: test.info().project.use.baseURL,
      });
      try {
        expect((await anonymous.get(url(256))).status(), "anonymous").toBe(404);
        expect((await anonymous.get(url(999))).status(), "anonymous size=999").toBe(400);
        expect((await anonymous.get(`/api/avatars/..%2F..%2Fetc?size=64&v=1`)).status()).toBe(404);
      } finally {
        await anonymous.dispose();
      }
    } finally {
      await cleanup();
    }
  });
});
