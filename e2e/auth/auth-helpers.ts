import { createHmac, randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";
import type { BrowserContext, Page } from "@playwright/test";
import { Client } from "pg";
import { HYDRATION_WAIT } from "../timeouts";
import { expect, test } from "../fixtures";

// Shared steps of the #36 auth specs: the username form as a person fills it.

/** Auth.js's session cookie over http (the `__Secure-` prefix applies on https only). */
export const SESSION_COOKIE = "authjs.session-token";

/** A fresh username of the sign-up rules (<= 20 chars, [a-z0-9_]). */
export const freshUsername = (stem = "e2e") => `${stem}_${randomBytes(4).toString("hex")}`;
export const PASSWORD = `pw-${randomBytes(6).toString("hex")}`;

export const authForm = (page: Page) =>
  page.locator("form[aria-label]").filter({
    has: page.locator('input[name="username"]'),
  });

/** Opens an auth screen and waits until its form has hydrated. */
export async function openForm(page: Page, path: "/sign-in" | "/sign-up" | string) {
  await page.goto(path);
  await expect(authForm(page)).toHaveAttribute("data-hydrated", "true", {
    timeout: HYDRATION_WAIT,
  });
}

export async function fill(page: Page, username: string, password: string) {
  const form = authForm(page);
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="password"]').fill(password);
}

export async function sessionCookie(context: BrowserContext) {
  return (await context.cookies()).find((c) => c.name.endsWith(SESSION_COOKIE));
}

/** The header's account control. */
export const header = (page: Page) => page.getByRole("banner");
export const signOutButton = (page: Page) =>
  header(page).getByRole("button", { name: "SIGN OUT", exact: true });

/** Signs up through the form and waits for the landing with the name in the header. */
export async function signUpThroughForm(page: Page, username: string, password: string) {
  await openForm(page, "/sign-up");
  await fill(page, username, password);
  await authForm(page).getByRole("button", { name: "OPEN MY FILE" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: HYDRATION_WAIT });
  await expect(header(page)).toContainText(username, { timeout: HYDRATION_WAIT });
}

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

/** Seeds a username account (Argon2id as src/server/auth/password.ts) into the web server's DB. */
export async function seedAccount(username: string, password: string): Promise<void> {
  const passwordHash = await hash(password, {
    algorithm: 2, // Argon2id
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  await withDb((db) =>
    db.query(
      `INSERT INTO "User" (id, "isGuest", "typistName", username, "usernameNormalized", "passwordHash")
       VALUES ($1, false, $2, $2, $3, $4)`,
      [`e2e_${randomBytes(8).toString("hex")}`, username, username.toLowerCase(), passwordHash],
    ),
  );
}

/** Seeds a guest row and plants its signed `fc_guest` cookie (format of src/server/auth/guest-cookie.ts). */
export async function plantGuest(context: BrowserContext, typistName: string): Promise<string> {
  const id = `e2e_${randomBytes(8).toString("hex")}`;
  await withDb((db) =>
    db.query(`INSERT INTO "User" (id, "isGuest", "typistName") VALUES ($1, true, $2)`, [
      id,
      typistName,
    ]),
  );
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set for the e2e process");
  const mac = createHmac("sha256", secret).update(id).digest("base64url");
  const url = test.info().project.use.baseURL!;
  await context.addCookies([{ name: "fc_guest", value: `${id}.${mac}`, url }]);
  return id;
}

export async function deleteUsers(prefix: string): Promise<void> {
  await withDb((db) => db.query(`DELETE FROM "User" WHERE "typistName" LIKE $1`, [`${prefix}%`]));
}
