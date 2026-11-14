import { createHmac, randomBytes } from "node:crypto";
import type { BrowserContext, Page } from "@playwright/test";
import { Client } from "pg";
import {
  authForm,
  fill,
  freshUsername,
  openForm,
  PASSWORD,
  seedAccount,
} from "../auth/auth-helpers";
import { expect, test } from "../fixtures";
import { ACTION_WAIT, HYDRATION_WAIT } from "../timeouts";

// Shared steps of the Home menu specs (#943, #945, #946): the menu's locators and the viewers.

export const menu = (page: Page) => page.locator("nav[data-home-menu]");
export const entries = (page: Page) => menu(page).locator("[data-entry]");
export const entry = (page: Page, id: string) => menu(page).locator(`[data-entry="${id}"]`);
export const hints = (page: Page) => page.locator("[data-key-hints]");
export const description = (page: Page) => page.locator("[data-home-description]");
export const missionDocket = (page: Page) => page.locator("[data-mission-docket]");
export const playerDocket = (page: Page) => page.locator("[data-player-docket]");
export const stage = (page: Page) => page.locator("[data-home-stage]");

/** Loads `/` and waits until the menu's keys are wired. */
export async function openMenu(page: Page, path = "/") {
  await page.goto(path);
  await expect(menu(page)).toHaveAttribute("data-hydrated", "true", { timeout: HYDRATION_WAIT });
}

export async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

/** A signed `fc_guest` cookie for `id` (src/server/auth/guest-cookie.ts), planted on the base URL. */
export async function plantGuestCookie(context: BrowserContext, id: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set for the e2e process");
  const mac = createHmac("sha256", secret).update(id).digest("base64url");
  await context.addCookies([
    { name: "fc_guest", value: `${id}.${mac}`, url: test.info().project.use.baseURL! },
  ]);
}

/** Seeds an account and signs in through the form (a merged guest, if any, is folded in). */
export async function signInAccount(
  page: Page,
  stem = "home",
): Promise<{ username: string; id: string }> {
  const username = freshUsername(stem);
  await seedAccount(username, PASSWORD);
  await openForm(page, "/sign-in");
  await fill(page, username, PASSWORD);
  await authForm(page).getByRole("button", { name: "SIGN IN", exact: true }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: ACTION_WAIT });
  const id = await withDb(async (db) => {
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM "User" WHERE username = $1`, [
      username,
    ]);
    return rows[0]!.id;
  });
  return { username, id };
}

/** A fresh guest row with its cookie; returns its id and name. */
export async function guest(context: BrowserContext): Promise<{ id: string; name: string }> {
  const id = `e2e_${randomBytes(8).toString("hex")}`;
  const name = `Heron-${randomBytes(4).toString("hex")}`;
  await withDb((db) =>
    db.query(`INSERT INTO "User" (id, "isGuest", "typistName") VALUES ($1, true, $2)`, [id, name]),
  );
  await plantGuestCookie(context, id);
  return { id, name };
}

export const locale = (context: BrowserContext, value: "en" | "fr") =>
  context.addCookies([{ name: "locale", value, url: test.info().project.use.baseURL! }]);

/** True when two boxes overlap. */
export function overlaps(
  a: { x: number; y: number; width: number; height: number } | null,
  b: { x: number; y: number; width: number; height: number } | null,
): boolean {
  if (!a || !b) return false;
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
