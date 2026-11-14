import { expect, test } from "../fixtures";
import { createLobby, joinAsGuest } from "../race/helpers";
import { withoutWebGL } from "../results/helpers";
import { ACTION_WAIT, scaled } from "../timeouts";
import { hints, locale, openMenu } from "./home-helpers";

// Contract of #943 C22: players online in the key-hint bar. Parallel workers share one race server and
// seat typists of their own, so with this test's room holding two human typists the figure is at least
// 2; the exact sum (bots excluded, every phase and type) and the unanswered race server are proven in
// src/features/lobby/queries/count-typists-online.test.ts and online-count.test.tsx. The page HTML carries
// only the number: never this room's code.

test("two typists seated: the bar reads v<version> · <n> ONLINE with n >= 2, and no room code", async ({
  page,
  context,
  browser,
}) => {
  test.skip(test.info().project.name !== "desktop", "desktop project only");
  test.setTimeout(scaled(90_000));
  await locale(context, "en");
  await withoutWebGL(page);
  // the host (this page's guest) and a second guest, both seated in the waiting room
  const code = await createLobby(page);
  await expect(page.getByRole("list", { name: "Typists in the room" })).toBeVisible({
    timeout: ACTION_WAIT,
  });
  const other = await joinAsGuest(browser, code);
  try {
    const menu = await context.newPage();
    await withoutWebGL(menu);
    await expect(async () => {
      await openMenu(menu);
      const figure = hints(menu).locator("[data-online]");
      await expect(figure).toBeVisible({ timeout: scaled(2_000) });
      expect(Number(await figure.getAttribute("data-online"))).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: ACTION_WAIT });
    const meta = hints(menu).locator("[data-version]");
    await expect(meta).toContainText(/^v\d+\.\d+\.\d+ · \d+ ONLINE/);
    const n = await hints(menu).locator("[data-online]").getAttribute("data-online");
    await expect(hints(menu).locator("[data-online] .sr-only")).toHaveText(`${n} players online`);
    const html = await (await menu.request.get("/")).text();
    expect(html).toContain("data-online");
    expect(html).not.toContain(code);
    await menu.close();
  } finally {
    await other.context.close();
  }
});
