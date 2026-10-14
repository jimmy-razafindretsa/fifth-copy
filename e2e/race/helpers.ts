import type { Browser, Page } from "@playwright/test";
import { Client } from "pg";
import { test } from "../fixtures";

// Room helpers shared by the lobby and race specs (#561 C10; first written for #107 in e2e/lobby.spec.ts).
// They drive the real landing and the race server started by playwright.config.ts.

export const LOBBY_PATH = /^\/lobby\/([A-HJ-NP-Z]{3}-[0-9]{4})$/;

/** Creates a private race from the landing and returns its code; the page stays in the waiting room. */
export async function createLobby(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: "CREATE PRIVATE RACE", exact: true }).click();
  await page.waitForURL((url) => LOBBY_PATH.test(url.pathname));
  return LOBBY_PATH.exec(new URL(page.url()).pathname)![1]!;
}

/** A different guest (fresh context) joins with the code from the landing. */
export async function joinAsGuest(browser: Browser, code: string) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await page.goto("/");
  const form = page.getByRole("form", { name: "Join with code" });
  await form.getByLabel("JOIN WITH CODE", { exact: true }).pressSequentially(code);
  await form.getByRole("button", { name: "JOIN →", exact: true }).click();
  await page.waitForURL(`**/lobby/${code}`);
  return { context, page };
}

/** Runs `fn` against the card's dev database (DATABASE_URL from the worktree's .env). */
async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

/** The `Lobby.id` behind a room code: the id `/race/[raceId]` takes before any start. */
export function lobbyIdOf(code: string): Promise<string> {
  return withDb(async (db) => {
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM "Lobby" WHERE code = $1`, [
      code,
    ]);
    if (!rows[0]) throw new Error(`no lobby ${code}`);
    return rows[0].id;
  });
}

/** Marks a lobby closed, as a race start or the retention sweep leaves it (its token mint answers `closed`). */
export function closeLobby(code: string): Promise<void> {
  return withDb(async (db) => {
    await db.query(`UPDATE "Lobby" SET status = 'CLOSED', "closedAt" = now() WHERE code = $1`, [
      code,
    ]);
  });
}

/**
 * A waiting lobby row the race server never opened a room for (as after its last typist left): same
 * host as `code`, a fresh code and cuid-shaped id. Returns both.
 */
export function roomlessLobbyLike(code: string): Promise<{ id: string; code: string }> {
  return withDb(async (db) => {
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const pick = (n: number, from: string) =>
      Array.from({ length: n }, () => from[Math.floor(Math.random() * from.length)]).join("");
    const fresh = `${pick(3, letters)}-${pick(4, "0123456789")}`;
    const id = `c${pick(24, "abcdefghijklmnopqrstuvwxyz0123456789")}`;
    await db.query(
      `INSERT INTO "Lobby" (id, code, "hostUserId") SELECT $1, $2, "hostUserId" FROM "Lobby" WHERE code = $3`,
      [id, fresh, code],
    );
    return { id, code: fresh };
  });
}
