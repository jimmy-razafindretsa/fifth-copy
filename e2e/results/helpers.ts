import { createHmac, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { APIRequestContext, Page } from "@playwright/test";
import { Client } from "pg";
import { ENGINE_VERSION } from "@fifth-copy/engine";
import {
  DEFAULT_RACE_SETTINGS,
  INTERNAL_HEADERS,
  MAX_RESULTS_PER_REQUEST,
  PROTOCOL_VERSION,
  type InternalRaceResult,
} from "@fifth-copy/protocol";
import type { Outfit } from "../../src/features/identity/clerk/outfit";
import { expect } from "../fixtures";
import { createLobby, lobbyIdOf } from "../race/helpers";

// The Dawn report seeding (#300, shared with #301): races seeded through the signed internal routes the
// race server calls (POST /api/internal/races, then /results), read back on /results/<raceId>. The
// signature is the internal-api one (src/server/internal-api/sign.ts `internalHeaders`: HMAC-SHA256 over
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
export async function hostOf(code: string): Promise<string> {
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
export async function saveOutfit(userId: string, outfit: Outfit): Promise<void> {
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
export const SAVED: Outfit = {
  hair: "quiff",
  glasses: "monocle",
  hat: "beret",
  clothes: "jacket",
  face: "beard",
  hairCol: "#A4552A",
};

export type Desk = {
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
export async function seedLobby(page: Page) {
  const code = await createLobby(page);
  return { code, lobbyId: await lobbyIdOf(code), hostUserId: await hostOf(code) };
}

export async function startRace(
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

/** The results, in batches of `MAX_RESULTS_PER_REQUEST` as the race server sends them (idempotent per desk). */
export async function postResults(request: APIRequestContext, raceId: string, desks: Desk[]) {
  const endedAt = Date.now();
  for (let i = 0; i < desks.length; i += MAX_RESULTS_PER_REQUEST) {
    await postSigned(request, `/api/internal/races/${raceId}/results`, {
      v: PROTOCOL_VERSION,
      raceId,
      endedAt,
      reason: "all-finished",
      lobbySize: desks.length,
      results: desks.slice(i, i + MAX_RESULTS_PER_REQUEST).map(result),
    });
  }
}

/** Six desks: places 1-6, a bot second, desk 4 LINE_CUT, desk 6 suspicious; desk 7 is the viewer. */
export const six = (host: string): Desk[] => [
  { desk: 7, name: "Lynx-785", place: 1, wpm: 61.4, accuracy: 0.97, userId: host },
  { desk: 3, name: "Typist Bot", place: 2, wpm: 54.2, isBot: true },
  { desk: 12, name: "Heron-302", place: 3, wpm: 47.8 },
  { desk: 4, name: "Otter-417", place: 4, wpm: 38.1, status: "line-cut" },
  { desk: 9, name: "Badger-126", place: 5, wpm: 31 },
  { desk: 6, name: "Crow-559", place: 6, wpm: 29.5, suspicious: true },
];

/** No WebGL in the page or its frames (the clerk slots fall back to the gold stamp, C4). */
export async function withoutWebGL(page: Page): Promise<void> {
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

/** #301: thirty desks, places 1-30, every status in turn, bots on every fifth desk; desk 1 is the viewer. */
// engine statuses on the wire: `typing` is stored TIMED_OUT, `abandoned` REASSIGNED (persist-results.ts)
const STATUSES: NonNullable<Desk["status"]>[] = [
  "finished",
  "typing",
  "abandoned",
  "asleep",
  "line-cut",
  "expired",
];
export const thirty = (host: string): Desk[] =>
  Array.from({ length: 30 }, (_, i) => ({
    desk: i + 1,
    name: i % 5 === 4 ? `Typist Bot ${i + 1}` : `Clerk-${String(101 + i)}`,
    place: i + 1,
    wpm: 90 - i * 2.5,
    isBot: i % 5 === 4,
    userId: i === 0 ? host : null,
    status: i < 12 ? "finished" : STATUSES[i % STATUSES.length],
  }));
