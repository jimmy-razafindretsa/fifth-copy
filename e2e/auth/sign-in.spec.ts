import { ACTION_WAIT, HYDRATION_WAIT } from "../timeouts";
import { LANDING, expect, expectNoA11yViolations, test } from "../fixtures";
import {
  PASSWORD,
  authForm,
  deleteUsers,
  fill,
  freshUsername,
  header,
  openForm,
  plantGuest,
  seedAccount,
  sessionCookie,
  signOutButton,
  landSignedIn,
} from "./auth-helpers";

// #36 C12, C14, C15: the header account control in its three states, a session that survives a reload
// and a new context, and sign-out with the proxy redirect of /settings.

const PREFIX = `si_${Date.now().toString(36)}`;

test.describe("sign-in, session and sign-out (#36)", () => {
  test.afterAll(async () => deleteUsers(PREFIX));

  test("C12 header: signed out, guest, account", async ({ page, context }) => {
    await page.goto(LANDING);
    const signInLink = header(page).getByRole("link", { name: "SIGN IN", exact: true });
    await expect(signInLink).toHaveAttribute("href", "/sign-in");
    await expect(signOutButton(page)).toHaveCount(0);
    await expect(header(page).getByText("GUEST", { exact: true })).toHaveCount(0);

    const guestName = `${PREFIX}_g${test.info().project.name[0]}`;
    await plantGuest(context, guestName);
    await page.reload();
    await expect(header(page)).toContainText(guestName);
    await expect(header(page).getByText("GUEST", { exact: true })).toBeVisible();
    await expect(signInLink).toBeVisible();
    await expect(signOutButton(page)).toHaveCount(0);

    const account = `${PREFIX}_a${test.info().project.name[0]}`;
    await seedAccount(account, PASSWORD);
    await openForm(page, "/sign-in");
    await fill(page, account, PASSWORD);
    await authForm(page).getByRole("button", { name: "SIGN IN", exact: true }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: ACTION_WAIT });
    // `/` is the Home menu for a viewer (#943): the site header lives on the landing
    await page.goto(LANDING);
    await expect(header(page)).toContainText(account);
    await expect(signOutButton(page)).toBeVisible();
    await expect(header(page).getByRole("link", { name: "SIGN IN", exact: true })).toHaveCount(0);
    await expect(header(page).getByText("GUEST", { exact: true })).toHaveCount(0);
    // the guest was merged into the account: its cookie is gone
    expect((await context.cookies()).find((c) => c.name === "fc_guest")).toBeUndefined();
    // the control fits the header at every viewport: nothing scrolls sideways
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    const box = await signOutButton(page).boundingBox();
    if ((page.viewportSize()?.width ?? 0) <= 768) expect(box!.height).toBeGreaterThanOrEqual(44);
    await expectNoA11yViolations(page);
  });

  test("C14 the session survives a reload and a new context from the storage state", async ({
    page,
    context,
    browser,
  }) => {
    const account = freshUsername(PREFIX);
    await seedAccount(account, PASSWORD);
    await openForm(page, "/sign-in?callbackUrl=/design");
    await fill(page, account, PASSWORD);
    await authForm(page).getByRole("button", { name: "SIGN IN", exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: ACTION_WAIT }).toBe("/design");
    const cookie = await sessionCookie(context);
    expect(cookie).toBeDefined();
    // 30 days (ADR 0009): the cookie expires about 2,592,000 s from now
    const lifetime = cookie!.expires - Date.now() / 1000;
    expect(lifetime).toBeGreaterThan(2_592_000 - 3600);
    expect(lifetime).toBeLessThanOrEqual(2_592_000 + 60);

    await page.goto(LANDING);
    await page.reload();
    await expect(header(page)).toContainText(account);
    await expect(signOutButton(page)).toBeVisible();

    const fresh = await browser.newContext({ storageState: await context.storageState() });
    const freshPage = await fresh.newPage();
    await freshPage.goto(LANDING);
    await expect(header(freshPage)).toContainText(account, { timeout: HYDRATION_WAIT });
    await expect(signOutButton(freshPage)).toBeVisible();
    await fresh.close();
  });

  test("C15 sign-out clears the session; /settings then redirects to /sign-in", async ({
    page,
    context,
  }) => {
    const account = freshUsername(PREFIX);
    await seedAccount(account, PASSWORD);
    await openForm(page, "/sign-in");
    await fill(page, account, PASSWORD);
    await authForm(page).getByRole("button", { name: "SIGN IN", exact: true }).click();
    await landSignedIn(page, ACTION_WAIT);

    await signOutButton(page).click();
    await expect(header(page).getByRole("link", { name: "SIGN IN", exact: true })).toBeVisible({
      timeout: ACTION_WAIT,
    });
    await expect.poll(() => sessionCookie(context)).toBeUndefined();

    await page.goto("/settings");
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fsettings$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("SIGN IN");
  });

  test("C15 the wrong password stays on the form with the generic error", async ({ page }) => {
    const account = freshUsername(PREFIX);
    await seedAccount(account, PASSWORD);
    await openForm(page, "/sign-in");
    await fill(page, account, `${PASSWORD}-nope`);
    await authForm(page).getByRole("button", { name: "SIGN IN", exact: true }).click();
    await expect(
      authForm(page).getByRole("alert").filter({ hasText: "Wrong username or password." }),
    ).toBeVisible({ timeout: ACTION_WAIT });
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});
