import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import {
  deleteUsers,
  freshUsername,
  PASSWORD,
  plantGuest,
  signUpThroughForm,
} from "../auth/auth-helpers";
import { expect, test } from "../fixtures";
import {
  BLUE,
  choose,
  colourJpeg,
  GREEN,
  headerAvatar,
  openPictureDialog,
  RED,
  textAsPng,
  tooLarge,
  type Fixture,
} from "./avatar-helpers";

// #60 C10, C11, C12: the picture flow end to end, through the real upload, store and route.

const STORED = /^\/api\/avatars\/([^?]+)\?size=64&v=\d+$/;

/** Uploads a fixture through the dialog with the default (centred) frame. */
async function upload(page: Page, fixture: Fixture) {
  const dialog = await openPictureDialog(page);
  await choose(dialog, fixture);
  await dialog.getByRole("button", { name: "SIGN & FILE" }).click();
  return dialog;
}

/** The header picture is the stored 64 px file of `userId`, and it loads. */
async function expectStored(page: Page): Promise<string> {
  const img = headerAvatar(page);
  await expect(img).toHaveAttribute("src", STORED);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(64);
  return STORED.exec((await img.getAttribute("src"))!)![1]!;
}

test.describe("#60 picture flow", () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "a server flow: desktop project only");

  test("C10 a signed-in user uploads a 1200x800 JPEG, crops, saves; the header shows it", async ({
    page,
  }) => {
    const username = freshUsername("pic");
    try {
      await signUpThroughForm(page, username, PASSWORD);
      await page.goto("/settings");
      await expect(headerAvatar(page)).toHaveAttribute("data-avatar", "portrait");
      const dialog = await openPictureDialog(page);
      await choose(dialog, await colourJpeg("desk.jpg", 1200, 800, GREEN));
      await dialog.getByRole("slider", { name: "ZOOM" }).fill("1.5");
      await dialog.getByRole("button", { name: "SIGN & FILE" }).click();
      await expect(dialog).toBeHidden();
      await expectStored(page);
    } finally {
      await deleteUsers(username);
    }
  });

  test.describe("C11 refused pictures keep the portrait", () => {
    let name = "";
    test.beforeEach(async ({ context }) => {
      name = `Kodak-${1000 + (randomBytes(2).readUInt16BE() % 9000)}`;
      await deleteUsers(name);
      await plantGuest(context, name);
    });
    test.afterEach(async () => {
      if (name) await deleteUsers(name);
    });

    const cases: [string, () => Promise<Fixture>, RegExp, boolean][] = [
      ["a 6 MB file", async () => tooLarge(), /over 5 MB/, false],
      ["a .txt renamed .png", async () => textAsPng(), /not a picture we take/, false],
      [
        "the red (reject) picture",
        () => colourJpeg("red.jpg", 300, 300, RED),
        /was refused.*Ask your teacher/,
        true,
      ],
    ];
    for (const [label, make, message, moderated] of cases) {
      test(label, async ({ page }) => {
        test.skip(
          moderated && !!process.env.CI,
          "the fake moderator runs only on the dev server (ADR 0015)",
        );
        const dialog = await openPictureDialog(page);
        await choose(dialog, await make());
        if (moderated) await dialog.getByRole("button", { name: "SIGN & FILE" }).click();
        await expect(dialog.getByRole("alert")).toHaveText(
          new RegExp(`RETURNED · .*${message.source}`),
        );
        await page.reload();
        await expect(headerAvatar(page)).toHaveAttribute("data-avatar", "portrait");
      });
    }

    test("the blue (flag) picture is review pending, not an error", async ({ page }) => {
      test.skip(!!process.env.CI, "the fake moderator runs only on the dev server (ADR 0015)");
      const dialog = await upload(page, await colourJpeg("blue.jpg", 300, 300, BLUE));
      await expect(dialog.getByRole("status").filter({ hasText: "UNDER REVIEW" })).toContainText(
        "Your picture is being reviewed",
      );
      await expect(dialog.getByRole("alert")).toHaveCount(0);
      await page.reload();
      await expect(headerAvatar(page)).toHaveAttribute("data-avatar", "portrait");
    });

    test("in French too", async ({ page, context }) => {
      await context.addCookies([
        { name: "locale", value: "fr", url: test.info().project.use.baseURL! },
      ]);
      await page.goto("/settings");
      const dialog = await openPictureDialog(page);
      await choose(dialog, tooLarge());
      await expect(dialog.getByRole("alert")).toHaveText(/RETOURNÉ · .*dépasse 5 Mo/);
    });
  });

  test("C12 a guest's picture survives sign-up", async ({ page, context }) => {
    const guest = `Daguerre-${1000 + (randomBytes(2).readUInt16BE() % 9000)}`;
    const username = freshUsername("merge");
    await deleteUsers(guest);
    try {
      const guestId = await plantGuest(context, guest);
      const dialog = await upload(page, await colourJpeg("guest.jpg", 500, 500, GREEN));
      await expect(dialog).toBeHidden();
      expect(await expectStored(page)).toBe(guestId);

      await signUpThroughForm(page, username, PASSWORD);
      await page.goto("/settings");
      const accountId = await expectStored(page);
      expect(accountId).not.toBe(guestId);
    } finally {
      await deleteUsers(guest);
      await deleteUsers(username);
    }
  });
});
