import { ACTION_WAIT } from "../timeouts";
import { expect, test } from "../fixtures";
import {
  PASSWORD,
  authForm,
  fill,
  freshUsername,
  header,
  openForm,
  sessionCookie,
} from "./auth-helpers";

// #36 C13: the sign-up form in a browser: pending while the action runs, the action's field errors
// with aria-invalid and linked messages, then signed in on success.

test.describe("sign-up form (#36)", () => {
  test("C13 pending, field errors from the action, then signed in", async ({ page, context }) => {
    await openForm(page, "/sign-up");
    const form = authForm(page);
    const username = form.locator('input[name="username"]');

    // a refused username: the server's answer, linked to the field
    await fill(page, "bad-name!", "short");
    await form.getByRole("button", { name: "OPEN MY FILE" }).click();
    const usernameError = form
      .getByRole("alert")
      .filter({ hasText: "Use only letters, numbers and _." });
    await expect(usernameError).toBeVisible({ timeout: ACTION_WAIT });
    await expect(username).toHaveAttribute("aria-invalid", "true");
    const errorId = await usernameError.getAttribute("id");
    expect((await username.getAttribute("aria-describedby"))?.split(" ")).toContain(errorId);
    const password = form.locator('input[name="password"]');
    await expect(password).toHaveAttribute("aria-invalid", "true");
    await expect(
      form.getByRole("alert").filter({ hasText: "Use 8 to 128 characters." }),
    ).toBeVisible();
    // what was typed stays, and no error line echoes it
    await expect(username).toHaveValue("bad-name!");
    await expect(form.getByRole("alert").filter({ hasText: "bad-name!" })).toHaveCount(0);

    // pending: hold the action's request so the state is observable
    const name = freshUsername("su");
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/sign-up", async (route) => {
      if (route.request().method() === "POST") await held;
      await route.continue();
    });
    await fill(page, name, PASSWORD);
    await form.getByRole("button", { name: "OPEN MY FILE" }).click();
    const busy = form.getByRole("button", { name: "FILING…" });
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute("aria-busy", "true");
    await expect(form).toHaveAttribute("aria-busy", "true");
    release();

    await expect(page).toHaveURL(/\/$/, { timeout: ACTION_WAIT });
    await expect(header(page)).toContainText(name, { timeout: ACTION_WAIT });
    expect(await sessionCookie(context)).toBeDefined();
  });

  test("C13 a taken username gets its own error", async ({ page }) => {
    const name = freshUsername("tk");
    const first = await page.context().browser()!.newContext();
    const firstPage = await first.newPage();
    await openForm(firstPage, "/sign-up");
    await fill(firstPage, name, PASSWORD);
    await authForm(firstPage).getByRole("button", { name: "OPEN MY FILE" }).click();
    await expect(firstPage).toHaveURL(/\/$/, { timeout: ACTION_WAIT });
    await first.close();

    await openForm(page, "/sign-up");
    await fill(page, name.toUpperCase(), PASSWORD);
    await authForm(page).getByRole("button", { name: "OPEN MY FILE" }).click();
    await expect(
      authForm(page).getByRole("alert").filter({ hasText: "That username is already on file." }),
    ).toBeVisible({ timeout: ACTION_WAIT });
    await expect(page).toHaveURL(/\/sign-up$/);
  });
});
