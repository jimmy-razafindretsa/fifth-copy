import { createHmac, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { APIRequestContext, Page } from "@playwright/test";
import { Client } from "pg";
import { ENGINE_VERSION } from "@fifth-copy/engine";
import {
  DEFAULT_RACE_SETTINGS,
  INTERNAL_HEADERS,
  PROTOCOL_VERSION,
  type InternalRaceResult,
} from "@fifth-copy/protocol";
import { outfitForDesk, type Outfit } from "../../src/features/identity/clerk/outfit";
import { expect, test } from "../fixtures";
import { createLobby, lobbyIdOf } from "../race/helpers";
import { HYDRATION_WAIT, scaled } from "../timeouts";

// Contract of #300 C2, C4, C5 and #688 C2, C5, C6: races seeded through the signed internal routes the race server calls
// (POST /api/internal/races, then /results), read back on /results/<raceId>. The signature is the
// internal-api one (src/server/internal-api/sign.ts `internalHeaders`: HMAC-SHA256 over
// `${timestamp}.${rawBody}`), rebuilt here because that module is server-only.

function signed(rawBody: string): Record<string, string> {
  const secret = process.env.RACE_TOKEN_SECRET;
  if (!secret) throw new Error("RACE_TOKEN_SECRET missing (load the worktree .env)");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return {
    "content-type": "application/json",
    [INTERNAL_HEADERS.timestamp]: timestamp,
    [INTERNAL_HEADERS.signature]: signature,
  };
}

async function postSigned(request: APIRequestContext, path: string, body: unknown) {
  const rawBody = JSON.stringify(body);
  const res = await request.post(path, { data: rawBody, headers: signed(rawBody) });
  expect(res.status(), `${path}: ${await res.text()}`).toBe(200);
}

/** The guest behind the page: the host of the lobby it just created (its desk gets the YOU tag). */
async function hostOf(code: string): Promise<string> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query<{ hostUserId: string }>(
      `SELECT "hostUserId" FROM "Lobby" WHERE code = $1`,
      [code],
    );
    return rows[0]!.hostUserId;
  } finally {
    await db.end();
  }
}

/** #688 C5: the guest's saved outfit, written straight into the test database (as #687's save would). */
async function saveOutfit(userId: string, outfit: Outfit): Promise<void> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query(`UPDATE "User" SET outfit = $1::jsonb WHERE id = $2`, [
      JSON.stringify(outfit),
      userId,
    ]);
  } finally {
    await db.end();
  }
}

/** A saved outfit no desk would draw by itself: beret, monocle, full beard. */
const SAVED: Outfit = {
  hair: "quiff",
  glasses: "monocle",
  hat: "beret",
  clothes: "jacket",
  face: "beard",
  hairCol: "#A4552A",
};

type Desk = {
  desk: number;
  name: string;
  place: number;
  wpm: number;
  accuracy?: number;
  isBot?: boolean;
  userId?: string | null;
  status?: InternalRaceResult["status"];
  suspicious?: boolean;
};

const EMPTY_TRACE = {
  encoding: "gzip+base64" as const,
  data: gzipSync("[]").toString("base64"),
  count: 0,
};

function result(d: Desk): InternalRaceResult {
  const finished = (d.status ?? "finished") === "finished";
  return {
    desk: d.desk,
    userId: d.isBot ? null : (d.userId ?? null),
    name: d.name,
    isBot: !!d.isBot,
    place: d.place,
    status: d.status ?? "finished",
    wpm: d.wpm,
    rawWpm: d.wpm + 3,
    cleanWpm: d.wpm,
    // ADR 0016: the podium shows clean WPM, never this one
    adjustedWpm: d.wpm + 40,
    accuracy: d.accuracy ?? 0.95,
    progress: finished ? 1 : 0.6,
    correct: 100,
    errors: 4,
    total: 104,
    durationMs: 50_000,
    finishedAtMs: finished ? 40_000 + d.place * 1_000 : null,
    bonusesSent: 0,
    bonusesReceived: 0,
    bonusLog: [],
    flags: d.suspicious ? [{ code: "e2e-review" }] : [],
    engineVersion: ENGINE_VERSION,
    trace: EMPTY_TRACE,
  };
}

/** A lobby hosted by the page's guest; returns what a race start needs. */
async function seedLobby(page: Page) {
  const code = await createLobby(page);
  return { code, lobbyId: await lobbyIdOf(code), hostUserId: await hostOf(code) };
}

async function startRace(
  request: APIRequestContext,
  lobby: { lobbyId: string; hostUserId: string },
  desks: Desk[],
) {
  const raceId = randomUUID();
  await postSigned(request, "/api/internal/races", {
    v: PROTOCOL_VERSION,
    raceId,
    lobbyId: lobby.lobbyId,
    hostUserId: lobby.hostUserId,
    settings: { ...DEFAULT_RACE_SETTINGS, language: "en", wordCount: 20 },
    desks: desks.map((d) => ({
      desk: d.desk,
      userId: d.isBot ? null : (d.userId ?? null),
      name: d.name,
      isBot: !!d.isBot,
    })),
  });
  return raceId;
}

const postResults = (request: APIRequestContext, raceId: string, desks: Desk[]) =>
  postSigned(request, `/api/internal/races/${raceId}/results`, {
    v: PROTOCOL_VERSION,
    raceId,
    endedAt: Date.now(),
    reason: "all-finished",
    lobbySize: desks.length,
    results: desks.map(result),
  });

/** Six desks: places 1-6, a bot second, desk 4 LINE_CUT, desk 6 suspicious; desk 7 is the viewer. */
const six = (host: string): Desk[] => [
  { desk: 7, name: "Lynx-785", place: 1, wpm: 61.4, accuracy: 0.97, userId: host },
  { desk: 3, name: "Typist Bot", place: 2, wpm: 54.2, isBot: true },
  { desk: 12, name: "Heron-302", place: 3, wpm: 47.8 },
  { desk: 4, name: "Otter-417", place: 4, wpm: 38.1, status: "line-cut" },
  { desk: 9, name: "Badger-126", place: 5, wpm: 31 },
  { desk: 6, name: "Crow-559", place: 6, wpm: 29.5, suspicious: true },
];

/** No WebGL in the page or its frames (the clerk slots fall back to the gold stamp, C4). */
async function withoutWebGL(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      id: string,
      ...rest: unknown[]
    ) {
      if (id === "webgl2" || id === "webgl") return null;
      return (original as (...a: unknown[]) => unknown).call(this, id, ...rest);
    } as typeof original;
  });
}

const plinths = (page: Page) => page.locator("[data-podium] > [data-plinth]");
const plinth = (page: Page, place: number) => page.locator(`[data-plinth="${place}"]`);
const clerkDoc = (page: Page, place: number) =>
  page.frameLocator(`[data-plinth="${place}"] iframe`).locator("html");

/** Each plinth frame: mounted or idle, and its document's `data-ready` (same origin, read in the page). */
const frameStates = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLIFrameElement>("[data-plinth] iframe")].map((f) => ({
      mounted: f.dataset.embed === "mounted",
      ready: f.contentDocument?.documentElement.dataset.ready === "1",
    })),
  );

const hasWebGL2 = (page: Page) =>
  page.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));

/** Bring every plinth near the viewport once (the near-viewport mount latches), then back to the top. */
async function visitPlinths(page: Page) {
  for (const n of [3, 2, 1]) await plinth(page, n).scrollIntoViewIfNeeded();
}

test.describe("Dawn report podium (#300)", () => {
  test.setTimeout(scaled(120_000));

  test("C2 C5 filing first, then the podium within 5 s of the post, no reload", async ({
    page,
    request,
  }, info) => {
    // The timing under test is the data path (filing -> podium). Three medals booting software WebGL
    // (headless CI, no GPU) block the page's thread for ~9 s right after the swap, so this test draws the
    // medal slots as their stamp; the live medals are proven by the C4 tests below.
    await withoutWebGL(page);
    const lobby = await seedLobby(page);
    const desks = six(lobby.hostUserId);
    const raceId = await startRace(request, lobby, desks);
    await page.goto(`/results/${raceId}`);
    await expect(
      page.getByRole("status").filter({ hasText: "FILING THE REPORT · ONE MOMENT" }),
    ).toBeVisible({ timeout: HYDRATION_WAIT });
    // the poll is a client leaf: let it hydrate before the post, so "no reload" is the refresh
    await page.waitForLoadState("networkidle");
    // a marker on the window survives router.refresh() and dies with a reload
    await page.evaluate(() => Object.assign(window, { __beforePost: true }));
    await postResults(request, raceId, desks);
    await expect(plinths(page)).toHaveCount(3, { timeout: scaled(5_000) });
    expect(
      await page.evaluate(() => (window as { __beforePost?: boolean }).__beforePost),
      "no reload",
    ).toBe(true);

    await expect(page.getByText("DAWN REPORT · FORM 5-R", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "RACE OVER" })).toBeVisible();
    expect(
      await plinths(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-plinth"))),
    ).toEqual(["1", "2", "3"]);
    await expect(plinth(page, 1)).toContainText("DESK 07 · Lynx-785");
    await expect(plinth(page, 1)).toContainText("61");
    await expect(plinth(page, 1)).toContainText("97 %");
    await expect(plinth(page, 1)).not.toContainText("101");
    await expect(plinth(page, 1)).toHaveAttribute("data-you", "true");
    await expect(plinth(page, 2)).toContainText("Typist Bot");
    await expect(plinth(page, 2).getByText("BOT", { exact: true })).toBeVisible();
    await expect(plinth(page, 3)).toContainText("DESK 12 · Heron-302");
    await expect(page.locator("[data-podium]")).not.toContainText("Otter-417");

    // from 768px the plinths stand 2 | 1 | 3, the first tallest
    if (info.project.name !== "mobile") {
      const box = async (n: number) => (await plinth(page, n).boundingBox())!;
      const [one, two, three] = [await box(1), await box(2), await box(3)];
      expect(two.x).toBeLessThan(one.x);
      expect(one.x).toBeLessThan(three.x);
      expect(one.height).toBeGreaterThan(two.height);
      expect(two.height).toBeGreaterThan(three.height);
    }
  });

  test("C5 two finishers: the third plinth is UNFILLED", async ({ page, request }) => {
    const lobby = await seedLobby(page);
    const desks: Desk[] = [
      { desk: 4, name: "Marmot-233", place: 1, wpm: 44.6 },
      { desk: 8, name: "Sparrow-482", place: 2, wpm: 39.9 },
    ];
    const raceId = await startRace(request, lobby, desks);
    await postResults(request, raceId, desks);
    await page.goto(`/results/${raceId}`);
    await expect(plinths(page)).toHaveCount(3, { timeout: HYDRATION_WAIT });
    await expect(plinth(page, 3)).toHaveAttribute("data-unfilled", "true");
    await expect(plinth(page, 3)).toContainText("UNFILLED");
    await expect(plinth(page, 1)).toContainText("Marmot-233");
  });

  test("C5 podium clerk: the host's saved outfit, the bot's desk outfit, mounted one at a time", async ({
    page,
    request,
  }) => {
    const lobby = await seedLobby(page);
    await saveOutfit(lobby.hostUserId, SAVED);
    const desks = six(lobby.hostUserId);
    const raceId = await startRace(request, lobby, desks);
    await postResults(request, raceId, desks);
    await page.goto(`/results/${raceId}`);
    test.skip(
      !(await hasWebGL2(page)),
      "no WebGL2 in this browser (the no-WebGL path has its own test)",
    );
    await expect(plinths(page)).toHaveCount(3, { timeout: HYDRATION_WAIT });
    await visitPlinths(page);

    // the stagger (C4): until all three are drawn, never more than one mounted frame still booting
    const deadline = Date.now() + scaled(30_000);
    let states = await frameStates(page);
    while (!(states.length === 3 && states.every((f) => f.mounted && f.ready))) {
      expect(
        states.filter((f) => f.mounted && !f.ready).length,
        JSON.stringify(states),
      ).toBeLessThanOrEqual(1);
      expect(Date.now(), `frames ${JSON.stringify(states)}`).toBeLessThan(deadline);
      await page.waitForTimeout(100);
      states = await frameStates(page);
    }

    // the host (desk 7, first) wears the saved outfit and the gold medal
    await expect(plinth(page, 1).locator("iframe")).toHaveAttribute(
      "src",
      /^\/3d\/podium-clerk\.html\?embed=1&variant=gold&cfg=/,
    );
    const host = clerkDoc(page, 1);
    await expect(host).toHaveAttribute("data-ready", "1");
    await expect(host).toHaveAttribute("data-variant", "gold");
    for (const [key, id] of Object.entries(SAVED).filter(([k]) => k !== "hairCol")) {
      await expect(host).toHaveAttribute(`data-${key}`, id);
    }
    // the bot (desk 3, second) wears its desk's fixed outfit and the silver medal
    const bot = clerkDoc(page, 2);
    await expect(bot).toHaveAttribute("data-variant", "silver");
    const desk3 = outfitForDesk(3);
    for (const key of ["hair", "glasses", "hat", "clothes", "face"] as const) {
      await expect(bot).toHaveAttribute(`data-${key}`, desk3[key]);
    }
    // desk 12 saved nothing: its desk's outfit, the bronze medal
    await expect(clerkDoc(page, 3)).toHaveAttribute("data-variant", "bronze");
    await expect(clerkDoc(page, 3)).toHaveAttribute("data-hat", outfitForDesk(12).hat);
    // the frames keep the catalog titles (no new strings)
    await expect(plinth(page, 1).locator("iframe")).toHaveAttribute("title", /gold medal/i);
    await expect(clerkDoc(page, 1)).toHaveAttribute("data-motion", "full");
  });

  test("C6 podium clerk under reduced motion: fc-motion crosses the frame, same layout", async ({
    page,
    request,
  }) => {
    const lobby = await seedLobby(page);
    const desks = six(lobby.hostUserId).slice(0, 3);
    const raceId = await startRace(request, lobby, desks);
    await postResults(request, raceId, desks);
    await page.goto(`/results/${raceId}`);
    test.skip(
      !(await hasWebGL2(page)),
      "no WebGL2 in this browser (the no-WebGL path has its own test)",
    );
    await plinth(page, 1).scrollIntoViewIfNeeded();
    const doc = clerkDoc(page, 1);
    await expect(doc).toHaveAttribute("data-ready", "1", { timeout: scaled(30_000) });
    await expect(doc).toHaveAttribute("data-motion", "full");
    const layout = () =>
      page.evaluate(() =>
        [
          ...document.querySelectorAll("[data-plinth], [data-medal-slot], [data-plinth] iframe"),
        ].map((e) => {
          const r = e.getBoundingClientRect();
          return [
            e.tagName,
            Math.round(r.x),
            Math.round(r.y),
            Math.round(r.width),
            Math.round(r.height),
          ];
        }),
      );
    const before = await layout();
    const html = await page.locator("[data-podium]").innerHTML();
    // the not-found pattern: the page's own motion setting, read by the bridge (bible 8, 15)
    await page.evaluate(() => document.documentElement.setAttribute("data-motion", "reduce"));
    await expect(doc).toHaveAttribute("data-motion", "reduce");
    expect(await layout()).toEqual(before);
    expect(await page.locator("[data-podium]").innerHTML()).toBe(html);
  });

  test("C4 without WebGL2 the slots show the gold HERO OF PAPERWORK stamp", async ({
    page,
    request,
  }) => {
    await withoutWebGL(page);
    const lobby = await seedLobby(page);
    const desks = six(lobby.hostUserId).slice(0, 3);
    const raceId = await startRace(request, lobby, desks);
    await postResults(request, raceId, desks);
    await page.goto(`/results/${raceId}`);
    for (const n of [1, 2, 3]) {
      const slot = plinth(page, n).locator("[data-medal-slot]");
      await expect(slot.locator('[data-medal-view="stamp"]')).toBeVisible({
        timeout: HYDRATION_WAIT,
      });
      await expect(slot).toContainText("HERO OF PAPERWORK");
      await expect(slot.locator("iframe")).toHaveCount(0);
    }
    // the stat cells name the players the clerks would have shown (#688 C5)
    await expect(plinth(page, 1)).toContainText("Lynx-785");
    await expect(plinth(page, 2)).toContainText("Typist Bot");
    await expect(plinth(page, 3)).toContainText("Heron-302");
    await expect(page.getByRole("heading", { level: 1, name: "RACE OVER" })).toBeVisible();
  });

  test("C2 an unknown race or a malformed id is a 404", async ({ page }) => {
    for (const id of [randomUUID(), "not-a-race"]) {
      const res = await page.goto(`/results/${id}`);
      expect(res?.status(), id).toBe(404);
    }
  });
});
