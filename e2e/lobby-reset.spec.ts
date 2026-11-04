import { randomBytes } from "node:crypto";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { Client } from "pg";
import { ENGINE_VERSION } from "@fifth-copy/engine";
import { DEFAULT_RACE_SETTINGS, PROTOCOL_VERSION } from "@fifth-copy/protocol";
import { expect, expectNoA11yViolations, test } from "./fixtures";
import {
  authForm,
  deleteUsers,
  fill,
  freshUsername,
  openForm,
  PASSWORD,
  seedAccount,
} from "./auth/auth-helpers";
import { createLobby, lobbyIdOf } from "./race/helpers";
import { ACTION_WAIT, HYDRATION_WAIT } from "./timeouts";

// Contract of #790: the host's PASSWORD RESET docket on /lobby/[code] (bible 14.3, 7.4, 7.1, 7.2, 4).
// Accounts are seeded straight into the web server's database; the host signs in through the form and
// creates the room from the landing, so the waiting room is live over the e2e race server. The student
// gets a RaceResult in a race of that lobby, which is what makes them eligible (#788).

const STEM = `rst${randomBytes(2).toString("hex")}`;
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

/** A username account, flagged a teacher when asked (as `scripts/grant-teacher.ts` does). */
async function account(stem: string, teacher = false): Promise<string> {
  const username = freshUsername(stem);
  await seedAccount(username, PASSWORD);
  if (teacher) {
    await withDb((db) =>
      db.query(`UPDATE "User" SET "isTeacher" = true WHERE "usernameNormalized" = $1`, [username]),
    );
  }
  return username;
}

const setTeacher = (username: string, on: boolean) =>
  withDb((db) =>
    db.query(`UPDATE "User" SET "isTeacher" = $2 WHERE "usernameNormalized" = $1`, [username, on]),
  );

/** The student raced in a race of the lobby `code` (one finished RaceResult). */
async function raced(username: string, code: string): Promise<void> {
  const lobbyId = await lobbyIdOf(code);
  const raceId = `e2e_${randomBytes(8).toString("hex")}`;
  await withDb(async (db) => {
    await db.query(
      `INSERT INTO "Race" (id, "lobbyId", "textContent", "textLanguage", "textWordCount", settings,
         "startedAt", "endedAt", "engineVersion", "protocolVersion")
       VALUES ($1, $2, 'the quick fox', 'EN', 3, $3::jsonb, now() - interval '5 min', now(), $4, $5)`,
      [raceId, lobbyId, JSON.stringify(DEFAULT_RACE_SETTINGS), ENGINE_VERSION, PROTOCOL_VERSION],
    );
    await db.query(
      `INSERT INTO "RaceResult" (id, "raceId", "userId", desk, name, "isBot", place, status, wpm,
         "rawWpm", "cleanWpm", "adjustedWpm", accuracy, progress, correct, errors, total, "durationMs",
         "bonusesSent", "bonusesReceived", "bonusLog", "engineVersion")
       SELECT $1, $2, id, 2, username, false, 1, 'FINISHED', 40, 40, 40, 40, 1, 1, 13, 0, 13, 20000,
         0, 0, '[]'::jsonb, $3
       FROM "User" WHERE "usernameNormalized" = $4`,
      [`e2e_${randomBytes(8).toString("hex")}`, raceId, ENGINE_VERSION, username],
    );
  });
}

async function signIn(page: Page, username: string) {
  await openForm(page, "/sign-in");
  await fill(page, username, PASSWORD);
  await authForm(page).getByRole("button", { name: "SIGN IN", exact: true }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: ACTION_WAIT });
}

const docket = (page: Page) => page.getByRole("region", { name: "PASSWORD RESET" });
const student = (page: Page) => docket(page).getByLabel("STUDENT", { exact: true });
const issueButton = (page: Page) =>
  docket(page).getByRole("button", { name: "ISSUE A CODE", exact: true });
const issuedRow = (page: Page) => docket(page).getByRole("status");
const errorLine = (page: Page) => docket(page).getByRole("alert");
/** The room is live (the roll answered), so the client leaf has hydrated. */
const live = (page: Page) =>
  expect(page.getByRole("list", { name: "Typists in the room" })).toBeVisible({
    timeout: HYDRATION_WAIT,
  });

async function issue(page: Page, username: string) {
  await student(page).fill(username);
  await issueButton(page).click();
}

/** A fresh context signed in as `username`, opening the waiting room `code` as a player. */
async function joinAs(browser: Browser, opened: BrowserContext[], username: string, code: string) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  opened.push(context);
  const page = await context.newPage();
  await signIn(page, username);
  await page.goto(`/lobby/${code}`);
  await live(page);
  return page;
}

test.describe("teacher password reset docket (#790)", () => {
  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    await Promise.all(opened.splice(0).map((c) => c.close()));
  });
  test.afterAll(async () => {
    await deleteUsers(`${STEM}_`);
  });

  test("C1 C2 only the lobby's teacher host sees the docket, under the settings docket and above START", async ({
    page,
    browser,
  }) => {
    const host = await account(STEM, true);
    await signIn(page, host);
    const code = await createLobby(page);
    await live(page);
    if (test.info().project.name === "mobile") {
      // phones watch (bible 14.3, 18): rendered for the host, hidden with the settings docket
      const section = page.locator('section[aria-label="PASSWORD RESET"]');
      await expect(section).toHaveCount(1);
      await expect(section).toBeHidden();
      return;
    }
    await expect(docket(page)).toBeVisible();
    await expect(docket(page)).toContainText("FORM 5-R");
    await expect(student(page)).toBeVisible();
    await expect(issueButton(page)).toBeVisible();

    // the dockets column order: settings docket, this docket, START
    const settings = page.getByRole("region", { name: "RACE SETTINGS" });
    const start = page.getByRole("button", { name: "START", exact: true });
    const box = async (l: ReturnType<typeof docket>) => (await l.boundingBox())!;
    const [s, r, st] = [await box(settings), await box(docket(page)), await box(start)];
    expect(r.y).toBeGreaterThanOrEqual(s.y + s.height);
    expect(st.y).toBeGreaterThanOrEqual(r.y + r.height);

    // a player account in the same room, even a teacher, never gets it
    const player = await joinAs(browser, opened, await account(STEM, true), code);
    await expect(player.getByRole("heading", { name: "REPORT TO YOUR DESK" })).toBeVisible();
    await expect(docket(player)).toHaveCount(0);
    await expect(player.getByText("PASSWORD RESET")).toHaveCount(0);
  });

  test("C1 a guest host and an account host without the teacher flag get no docket", async ({
    page,
    browser,
  }) => {
    await createLobby(page);
    await live(page);
    await expect(docket(page)).toHaveCount(0);

    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    opened.push(context);
    const plain = await context.newPage();
    await signIn(plain, await account(STEM));
    await createLobby(plain);
    await live(plain);
    await expect(docket(plain)).toHaveCount(0);
    await expect(plain.getByText("PASSWORD RESET")).toHaveCount(0);
  });

  test("C3 the issued code shows once, in no URL, cookie or storage, and a reload drops it", async ({
    page,
    context,
  }) => {
    test.skip(test.info().project.name === "mobile", "phones hide the docket (bible 14.3, 18)");
    const host = await account(STEM, true);
    const pupil = await account(STEM);
    await signIn(page, host);
    const code = await createLobby(page);
    await raced(pupil, code);
    await live(page);
    await expectNoA11yViolations(page);

    await issue(page, pupil);
    await expect(issuedRow(page)).toContainText("CODE ISSUED", { timeout: ACTION_WAIT });
    const shown = (await issuedRow(page).locator("[data-reset-code]").textContent())!.trim();
    expect(shown).toMatch(CODE_RE);
    await expect(issuedRow(page)).toContainText("EXPIRES IN 30 MIN");
    await expect(issuedRow(page)).toContainText("HAND IT OVER IN PRIVATE");
    // the input is cleared, so the name never sits beside its code
    await expect(student(page)).toHaveValue("");
    await expectNoA11yViolations(page);

    const bare = shown.replace("-", "");
    const leaks = [
      page.url(),
      ...(await context.cookies()).map((c) => `${c.name}=${c.value}`),
      await page.evaluate(() => JSON.stringify({ ...localStorage })),
      await page.evaluate(() => JSON.stringify({ ...sessionStorage })),
    ].join("\n");
    expect(leaks).not.toContain(shown);
    expect(leaks).not.toContain(bare);

    await page.reload();
    await live(page);
    await expect(docket(page)).toBeVisible();
    await expect(issueButton(page)).toBeEnabled();
    await expect(issuedRow(page)).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(shown);
  });

  test("C4 refusals: not eligible and not host, on the inline error line without the name", async ({
    page,
  }) => {
    test.skip(test.info().project.name === "mobile", "phones hide the docket (bible 14.3, 18)");
    const host = await account(STEM, true);
    await signIn(page, host);
    await createLobby(page);
    await live(page);

    // a name that never raced here
    const stranger = `${STEM}_nobody`;
    await issue(page, stranger);
    await expect(errorLine(page)).toHaveText(
      "RETURNED · That username is not one of your students.",
      { timeout: ACTION_WAIT },
    );
    const lineId = await errorLine(page).getAttribute("id");
    await expect(student(page)).toHaveAttribute("aria-describedby", lineId!);
    await expect(student(page)).toHaveAttribute("aria-invalid", "true");
    await expect(errorLine(page)).not.toContainText(stranger);
    await expectNoA11yViolations(page);

    // no longer a teacher (the flag withdrawn mid-session): the action answers not-host
    await setTeacher(host, false);
    await issue(page, stranger);
    await expect(errorLine(page)).toHaveText(
      "RETURNED · Only the teacher hosting this room can issue a code.",
      { timeout: ACTION_WAIT },
    );
    await expect(errorLine(page)).not.toContainText(stranger);
    await setTeacher(host, true);

    // rate-limited: the e2e web server runs with WEB_RATE_LIMIT=off (playwright.config.ts), so that
    // answer's line is covered by src/features/lobby/components/reset-docket.test.tsx
  });
});
