import { randomBytes } from "node:crypto";
import { deleteUsers, plantGuest } from "../auth/auth-helpers";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import {
  BLUE,
  choose,
  colourJpeg,
  cropOf,
  frame,
  GREEN,
  headerAvatar,
  openPictureDialog,
  pictureDialog,
  RED,
  textAsPng,
  tooLarge,
  trigger,
} from "./avatar-helpers";

// #60 C4, C5, C6: the picture dialog in /settings, driven as a guest (uploadAvatar takes guests).

const desktopOnly = (width: number | undefined) => width !== 1280;

test.describe("#60 picture dialog", () => {
  let name = "";
  test.beforeEach(async ({ context }) => {
    // Not a guest-name word (src/features/identity/guest/words.ts): deleteUsers is a LIKE prefix, and
    // other specs delete generated guests such as "Heron-123", which would match "Heron-1234".
    name = `Pictor-${1000 + (randomBytes(2).readUInt16BE() % 9000)}`;
    await deleteUsers(name);
    await plantGuest(context, name);
  });
  test.afterEach(async () => {
    if (name) await deleteUsers(name);
  });

  test("C4 file input, square frame with drag, wheel, slider and arrows, live previews, save sends the crop", async ({
    page,
  }) => {
    const dialog = await openPictureDialog(page);
    await expect(dialog).toHaveAttribute("aria-labelledby", /.+/);
    await expect(dialog.locator('input[type="file"]')).toHaveAttribute("accept", "image/*");
    await expect(dialog.getByRole("button", { name: "SIGN & FILE" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "CANCEL" })).toBeEnabled();

    await choose(dialog, await colourJpeg("wide.jpg", 1200, 800, GREEN));
    await expect(frame(page)).toBeVisible();
    await expect(dialog.locator('[data-preview="64"]')).toBeVisible();
    expect(await cropOf(page)).toEqual({ x: 200, y: 0, size: 800 });

    // slider: zoom 2 = a 400 px square around the centre
    await dialog.getByRole("slider", { name: "ZOOM" }).fill("2");
    expect(await cropOf(page)).toEqual({ x: 400, y: 200, size: 400 });
    // wheel zooms in further
    await frame(page).hover();
    await page.mouse.wheel(0, -100);
    expect((await cropOf(page)).size).toBeLessThan(400);
    // drag right: the picture follows the pointer, the frame moves left over it
    const before = await cropOf(page);
    const box = (await frame(page).boundingBox())!;
    await page.mouse.move(box.x + 128, box.y + 128);
    await page.mouse.down();
    await page.mouse.move(box.x + 188, box.y + 128, { steps: 4 });
    await page.mouse.up();
    expect((await cropOf(page)).x).toBeLessThan(before.x);
    // arrows nudge the frame
    const dragged = await cropOf(page);
    await frame(page).focus();
    await page.keyboard.press("ArrowDown");
    expect((await cropOf(page)).y).toBeGreaterThan(dragged.y);

    // A multipart body with a file is not exposed by Playwright: read the crop field off the action's FormData.
    await page.evaluate(() => {
      const w = window as unknown as { __crop?: string };
      const original = window.fetch;
      window.fetch = (input, init) => {
        if (init?.body instanceof FormData)
          for (const [key, value] of init.body.entries())
            if (key.endsWith("crop") && typeof value === "string") w.__crop = value;
        return original(input, init);
      };
    });
    const crop = await cropOf(page);
    await dialog.getByRole("button", { name: "SIGN & FILE" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __crop?: string }).__crop))
      .toBe(JSON.stringify(crop));
    await expect(dialog).toBeHidden();
  });

  test("C5 idle, chosen, pending, errors, review pending and success", async ({ page }) => {
    const dialog = await openPictureDialog(page);
    const body = dialog.locator("[data-phase]");
    const error = dialog.getByRole("alert");
    await expect(body).toHaveAttribute("data-phase", "idle");
    await expect(dialog.locator('[data-avatar="portrait"]')).toBeVisible();

    await choose(dialog, tooLarge());
    await expect(error).toContainText("over 5 MB");
    await choose(dialog, textAsPng());
    await expect(error).toContainText("not a picture we take");
    await choose(dialog, await colourJpeg("tiny.jpg", 40, 40, GREEN));
    await expect(error).toContainText("too small");

    await choose(dialog, await colourJpeg("ok.jpg", 600, 600, GREEN));
    await expect(body).toHaveAttribute("data-phase", "chosen");
    await expect(error).toHaveCount(0);

    // hold the upload so the pending state shows
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/settings*", async (route) => {
      if (route.request().method() === "POST") await held;
      await route.continue();
    });
    await dialog.getByRole("button", { name: "SIGN & FILE" }).click();
    await expect(dialog).toHaveAttribute("aria-busy", "true");
    await expect(dialog.getByRole("button", { name: "FILING…" })).toBeDisabled();
    release();
    await expect(dialog).toBeHidden();
    await page.unroute("**/settings*");
    // success: the header shows the stored picture, the section says FILED
    await expect(headerAvatar(page)).toHaveAttribute(
      "src",
      /^\/api\/avatars\/[^?]+\?size=64&v=\d+$/,
    );
    await expect(
      page.locator("main").getByRole("status").filter({ hasText: "FILED" }),
    ).toBeVisible();
  });

  test("C5 moderation: flagged is review pending, rejected is an error", async ({ page }) => {
    test.skip(!!process.env.CI, "the fake moderator runs only on the dev server (ADR 0015)");
    const dialog = await openPictureDialog(page);
    await choose(dialog, await colourJpeg("blue.jpg", 300, 300, BLUE));
    await dialog.getByRole("button", { name: "SIGN & FILE" }).click();
    await expect(dialog.locator("[data-phase]")).toHaveAttribute("data-phase", "review");
    await expect(dialog.getByRole("status").filter({ hasText: "UNDER REVIEW" })).toContainText(
      "being reviewed",
    );
    await expect(dialog.getByRole("alert")).toHaveCount(0);

    await choose(dialog, await colourJpeg("red.jpg", 300, 300, RED));
    await dialog.getByRole("button", { name: "SIGN & FILE" }).click();
    await expect(dialog.getByRole("alert")).toContainText("was refused");
    await expect(dialog.getByRole("alert")).toContainText("Ask your teacher");
    await expect(headerAvatar(page)).toHaveAttribute("data-avatar", "portrait");
  });

  test("C6 keyboard only: open, choose, nudge, save; focus back on the trigger; axe clean", async ({
    page,
  }, info) => {
    test.skip(desktopOnly(info.project.use.viewport?.width), "one keyboard run is enough");
    await page.goto("/settings");
    await expect(async () => {
      await trigger(page).focus();
      await page.keyboard.press("Enter");
      await expect(pictureDialog(page)).toBeVisible({ timeout: 1_000 });
    }).toPass();
    const dialog = pictureDialog(page);
    await choose(dialog, await colourJpeg("keys.jpg", 900, 600, GREEN));
    await expectNoA11yViolations(page);

    for (
      let i = 0;
      i < 12 && !(await frame(page).evaluate((el) => el === document.activeElement));
      i++
    ) {
      await page.keyboard.press("Tab");
    }
    await expect(frame(page)).toBeFocused();
    const start = await cropOf(page);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    expect((await cropOf(page)).x).toBeLessThan(start.x);

    const save = dialog.getByRole("button", { name: "SIGN & FILE" });
    for (let i = 0; i < 12 && !(await save.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press("Tab");
    }
    await expect(save).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(trigger(page)).toBeFocused();
    await expectNoA11yViolations(page);
  });
});
