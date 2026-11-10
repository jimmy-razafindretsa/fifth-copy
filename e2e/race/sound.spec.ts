import type { BrowserContext, Page, Response } from "@playwright/test";
import { expect, test } from "../fixtures";
import { ACTION_WAIT, scaled } from "../timeouts";
import { hostRoom } from "./helpers";

// Contract of #243 C4 and C6, over the real seat view and race server: the sound toggle is muted by
// default, files the choice through `updatePreferences({ sound })`, and the page initialises from
// `getPreferences` after a reload; the audio module (the only code that calls `decodeAudioData`) and the
// sound files are requested only after the first unmute (network assertion). The toggle's strings come
// from `race.sound.*` in both catalogs; its segments are 44px tall. Tablet and desktop only (#561 C5).

const AUDIO_MARK = "decodeAudioData";

/** Every script the page loads (with whether its body is the audio module) and every sound file request. */
function watchNetwork(page: Page) {
  const seen = { audioChunks: 0, sounds: [] as string[], pending: [] as Promise<void>[] };
  page.on("request", (req) => {
    if (new URL(req.url()).pathname.startsWith("/sounds/")) seen.sounds.push(req.url());
  });
  page.on("response", (res: Response) => {
    if (res.request().resourceType() !== "script") return;
    seen.pending.push(
      res
        .text()
        .then((body) => {
          if (body.includes(AUDIO_MARK)) seen.audioChunks++;
        })
        .catch(() => undefined),
    );
  });
  return {
    async settled() {
      await Promise.all(seen.pending);
      return { audioChunks: seen.audioChunks, sounds: [...seen.sounds] };
    },
  };
}

const sound = (page: Page, name = "SOUND") => page.getByRole("group", { name, exact: true });
const segment = (page: Page, label: string, group = "SOUND") =>
  sound(page, group).getByRole("button", { name: label, exact: true });

test.describe("#243 sound toggle", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 768, "the seat view is tablet+ (#561 C5)");

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  async function seat(page: Page, browser: Parameters<typeof hostRoom>[0]) {
    const room = await hostRoom(browser, opened);
    await page.goto(`/race/${room.lobbyId}`);
    // seated = hydrated and connected
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^SEAT VIEW · DESK \d{2}$/, {
      timeout: scaled(30_000),
    });
    return room;
  }

  test("C4 muted by default: no audio chunk or sound file until the first unmute; the choice is filed", async ({
    page,
    browser,
  }) => {
    const net = watchNetwork(page);
    const room = await seat(page, browser);
    await expect(segment(page, "OFF")).toHaveAttribute("aria-pressed", "true");
    await expect(segment(page, "ON")).toHaveAttribute("aria-pressed", "false");
    await page.waitForLoadState("networkidle");
    expect(await net.settled(), "nothing of the audio while muted").toEqual({
      audioChunks: 0,
      sounds: [],
    });

    await segment(page, "ON").click();
    await expect(segment(page, "ON")).toHaveAttribute("aria-pressed", "true");
    // filed: the pending word comes and goes
    await expect(sound(page)).not.toHaveAttribute("aria-busy", "true", { timeout: ACTION_WAIT });
    await expect
      .poll(async () => (await net.settled()).audioChunks, { timeout: ACTION_WAIT })
      .toBeGreaterThan(0);
    await expect
      .poll(async () => (await net.settled()).sounds.map((u) => new URL(u).pathname).sort(), {
        timeout: ACTION_WAIT,
      })
      .toEqual(["/sounds/clack.ogg", "/sounds/jam.ogg", "/sounds/stamp.ogg"]);

    // the page initialises from getPreferences: ON after a reload, and the audio loads at once
    await page.goto(`/race/${room.lobbyId}`);
    await expect(segment(page, "ON")).toHaveAttribute("aria-pressed", "true", {
      timeout: ACTION_WAIT,
    });

    // back OFF, filed, and a reload is muted again with no audio requested
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^SEAT VIEW · DESK \d{2}$/, {
      timeout: scaled(30_000),
    });
    await segment(page, "OFF").click();
    await expect(sound(page)).not.toHaveAttribute("aria-busy", "true", { timeout: ACTION_WAIT });
    const fresh = watchNetwork(page);
    await page.goto(`/race/${room.lobbyId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^SEAT VIEW · DESK \d{2}$/, {
      timeout: scaled(30_000),
    });
    await expect(segment(page, "OFF")).toHaveAttribute("aria-pressed", "true");
    await page.waitForLoadState("networkidle");
    expect(await fresh.settled()).toEqual({ audioChunks: 0, sounds: [] });
  });

  test("C6 the toggle reads race.sound in French and its segments are 44px tall", async ({
    page,
    browser,
  }) => {
    const url = test.info().project.use.baseURL!;
    await page.context().addCookies([{ name: "locale", value: "fr", url }]);
    const room = await hostRoom(browser, opened);
    await page.goto(`/race/${room.lobbyId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /^VUE DE TA PLACE · BUREAU \d{2}$/,
      { timeout: scaled(30_000) },
    );
    await expect(segment(page, "NON", "SON")).toHaveAttribute("aria-pressed", "true");
    await expect(segment(page, "OUI", "SON")).toHaveAttribute("aria-pressed", "false");
    for (const label of ["NON", "OUI"]) {
      const box = await segment(page, label, "SON").boundingBox();
      expect(box!.height, label).toBeGreaterThanOrEqual(44);
      expect(box!.width, label).toBeGreaterThanOrEqual(44);
    }
  });
});
