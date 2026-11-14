import { ACTION_WAIT, HYDRATION_WAIT } from "../timeouts";
import { LANDING, expect, test } from "../fixtures";
import {
  PASSWORD,
  authForm,
  deleteUsers,
  fill,
  header,
  openForm,
  sessionCookie,
  signOutButton,
  signUpThroughForm,
} from "./auth-helpers";

// #36 C16: the whole username flow in one browser run: sign up, sign out, sign in again in a fresh
// context, a reload keeps the session, sign out, and /settings sends a signed-out visitor to /sign-in.

const RUN = Date.now().toString(36);

test.describe("username credentials end to end (#36)", () => {
  test("C16 sign up, sign out, sign in in a fresh context, reload, sign out", async ({
    page,
    context,
    browser,
  }, info) => {
    const username = `comrade_e2e_${RUN.slice(-5)}${info.project.name[0]}`;
    await deleteUsers(username);

    await signUpThroughForm(page, username, PASSWORD);
    expect(await sessionCookie(context)).toBeDefined();
    await signOutButton(page).click();
    await expect(header(page).getByRole("link", { name: "SIGN IN", exact: true })).toBeVisible({
      timeout: ACTION_WAIT,
    });
    await expect.poll(() => sessionCookie(context)).toBeUndefined();

    const fresh = await browser.newContext();
    const freshPage = await fresh.newPage();
    await openForm(freshPage, "/sign-in");
    await fill(freshPage, username, PASSWORD);
    await authForm(freshPage).getByRole("button", { name: "SIGN IN", exact: true }).click();
    await expect(freshPage).toHaveURL(/\/$/, { timeout: ACTION_WAIT });
    // `/` is the Home menu for a viewer (#943): the site header lives on the landing
    await freshPage.goto(LANDING);
    await expect(header(freshPage)).toContainText(username, { timeout: HYDRATION_WAIT });

    await freshPage.reload();
    await expect(header(freshPage)).toContainText(username);
    await expect(signOutButton(freshPage)).toBeVisible();

    await signOutButton(freshPage).click();
    await expect(header(freshPage).getByRole("link", { name: "SIGN IN", exact: true })).toBeVisible(
      { timeout: ACTION_WAIT },
    );
    await expect.poll(() => sessionCookie(fresh)).toBeUndefined();
    await freshPage.goto("/settings");
    await expect(freshPage).toHaveURL(/\/sign-in\?callbackUrl=%2Fsettings$/);
    await fresh.close();
    await deleteUsers(username);
  });
});
