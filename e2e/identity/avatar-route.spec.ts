import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { Client } from "pg";
import sharp from "sharp";
import { expect, test } from "../fixtures";

// Contract C8 of #62: GET /api/avatars/[userId] over the real dev server. There is no upload UI yet
// (#60), so the owner's avatar is seeded the way uploadAvatar leaves it: two WebP files under
// AVATAR_DIR (the server's default .data/avatars in this checkout) and the User row's key + status.
const AVATAR_DIR = path.resolve(".data/avatars");
const VERSION = 1_700_000_000_123;
const LOBBY_PATH = /^\/lobby\/[A-HJ-NP-Z]{3}-[0-9]{4}$/;

/** Becomes a guest by creating a private race from the landing; returns the guest's user id. */
async function becomeGuest(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: "CREATE PRIVATE RACE", exact: true }).click();
  await page.waitForURL((url) => LOBBY_PATH.test(url.pathname));
  const cookie = (await page.context().cookies()).find((c) => c.name === "fc_guest");
  expect(cookie, "fc_guest cookie").toBeDefined();
  return cookie!.value.slice(0, cookie!.value.lastIndexOf("."));
}

async function seedAvatar(userId: string) {
  const dir = path.join(AVATAR_DIR, userId);
  await mkdir(dir, { recursive: true });
  for (const size of [256, 64]) {
    const webp = await sharp({
      create: { width: size, height: size, channels: 3, background: "#b4442e" },
    })
      .webp()
      .toBuffer();
    await writeFile(path.join(dir, `${VERSION}-${size}.webp`), webp);
  }
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query(
      `UPDATE "User" SET "avatarKey" = $1, "avatarStatus" = 'APPROVED' WHERE id = $2`,
      [`${userId}/${VERSION}`, userId],
    );
  } finally {
    await db.end();
  }
  return () => rm(dir, { recursive: true, force: true });
}

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
