import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { Client } from "pg";
import sharp from "sharp";
import { expect, test } from "../fixtures";
import { createLobby } from "../race/helpers";
import { HYDRATION_WAIT, scaled } from "../timeouts";

// Shared steps of the #60 picture specs: generated fixtures (no binary files in the repo) and the
// dialog as a person drives it.

/** A file Playwright can set on the input. */
export type Fixture = { name: string; mimeType: string; buffer: Buffer };

/** A plain square of one colour: green approves, blue flags, red rejects (fake moderator, ADR 0015). */
export async function colourJpeg(
  name: string,
  width: number,
  height: number,
  rgb: { r: number; g: number; b: number },
): Promise<Fixture> {
  const buffer = await sharp({ create: { width, height, channels: 3, background: rgb } })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { name, mimeType: "image/jpeg", buffer };
}

export const GREEN = { r: 40, g: 170, b: 60 };
export const BLUE = { r: 30, g: 60, b: 200 };
export const RED = { r: 210, g: 30, b: 40 };

/** Over the 5 MB cap; a JPEG by its magic bytes. */
export function tooLarge(): Fixture {
  const buffer = Buffer.alloc(6 * 1024 * 1024, 0x20);
  buffer.set([0xff, 0xd8, 0xff, 0xe0]);
  return { name: "huge.jpg", mimeType: "image/jpeg", buffer };
}

/** A text file renamed `.png`. */
export function textAsPng(): Fixture {
  return { name: "notes.png", mimeType: "image/png", buffer: Buffer.from("not a picture\n") };
}

/** Keeps a fixture on disk too (debugging a failed run). */
export async function save(fixture: Fixture): Promise<void> {
  await writeFile(test.info().outputPath(fixture.name), fixture.buffer);
}

export const pictureDialog = (page: Page) => page.locator('dialog[data-dialog="avatar"]');
export const trigger = (page: Page) => page.locator("main [data-avatar-trigger]").first();
export const frame = (page: Page) => pictureDialog(page).locator('[data-preview="256"]');
export const headerAvatar = (page: Page) => page.getByRole("banner").locator("[data-avatar]");

/** Opens `/settings` and the dialog once the trigger has hydrated. */
export async function openPictureDialog(page: Page) {
  await page.goto("/settings");
  const dialog = pictureDialog(page);
  await expect(async () => {
    await trigger(page).click();
    await expect(dialog).toBeVisible({ timeout: scaled(1_000) });
  }).toPass({ timeout: HYDRATION_WAIT });
  return dialog;
}

export async function choose(dialog: Locator, fixture: Fixture) {
  await dialog.locator('input[type="file"]').setInputFiles(fixture);
}

export const cropOf = async (page: Page) =>
  JSON.parse((await frame(page).getAttribute("data-crop")) ?? "null") as {
    x: number;
    y: number;
    size: number;
  };

// Route specs (#62, #880): an avatar seeded the way uploadAvatar leaves it, two WebP files under
// AVATAR_DIR (the server's default .data/avatars in this checkout) and the User row's key + status.
export const AVATAR_DIR = path.resolve(".data/avatars");
export const SEEDED_VERSION = 1_700_000_000_123;

/** The guest id behind the page's `fc_guest` cookie. */
export async function guestIdOf(page: Page): Promise<string> {
  const cookie = (await page.context().cookies()).find((c) => c.name === "fc_guest");
  expect(cookie, "fc_guest cookie").toBeDefined();
  return cookie!.value.slice(0, cookie!.value.lastIndexOf("."));
}

/** Becomes a guest by creating a private race from the landing; returns the guest's user id. */
export async function becomeGuest(page: Page): Promise<string> {
  await createLobby(page);
  return guestIdOf(page);
}

/** Seeds an APPROVED avatar at SEEDED_VERSION for `userId`; returns its cleanup. */
export async function seedAvatar(userId: string) {
  const dir = path.join(AVATAR_DIR, userId);
  await mkdir(dir, { recursive: true });
  for (const size of [256, 64]) {
    const webp = await sharp({
      create: { width: size, height: size, channels: 3, background: "#b4442e" },
    })
      .webp()
      .toBuffer();
    await writeFile(path.join(dir, `${SEEDED_VERSION}-${size}.webp`), webp);
  }
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query(
      `UPDATE "User" SET "avatarKey" = $1, "avatarStatus" = 'APPROVED' WHERE id = $2`,
      [`${userId}/${SEEDED_VERSION}`, userId],
    );
  } finally {
    await db.end();
  }
  return () => rm(dir, { recursive: true, force: true });
}
