import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  cleanAndAdjustedWpm,
  effectiveText,
  normalizeTypeable,
  replayTrace,
  type Keystroke,
} from "@fifth-copy/engine";
import { getPersonalReplay, getRaceSeries, getRaceSeriesForAll } from "./get-race-series";

vi.mock("server-only", () => ({}));

// Contract of #865 C2: the viewer's own WPM series and received-bonus marks, replayed on their
// effective text; null without a keystroke row; never another user's trace. An in-memory Race table
// stands in for Prisma and applies the query's own `where` on the nested rows, so a query that forgot
// to filter on the viewer would read (and be caught reading) another desk's trace.

const RACE_ID = "3b241101-e2bb-4255-8caf-4136c566a962";
const BASE = "the clerk files the fifth copy";
const CONTINUE = { errorMode: "continue", backspace: true } as const;

/** One key every 250 ms through `text`. */
const typed = (text: string, every = 250): Keystroke[] =>
  Array.from(text, (key, i) => ({ t: (i + 1) * every, key }));
const blob = (keys: Keystroke[]) => ({ data: gzipSync(JSON.stringify(keys)), count: keys.length });

type Result = {
  desk: number;
  userId: string | null;
  durationMs: number;
  overlay: unknown;
  bonusLog: unknown;
};
type Trace = { desk: number; userId: string; data: Uint8Array; count: number };
type RaceRow = {
  id: string;
  textContent: string;
  settings: unknown;
  endReason: "ALL_FINISHED" | "VOID";
  results: Result[];
  keystrokes: Trace[];
};

const OVERLAY = { extra: ["memo"], removed: [] };
const MINE_TEXT = effectiveText(normalizeTypeable(BASE), OVERLAY);
const MINE_KEYS = typed(MINE_TEXT);
const OTHER_KEYS = typed(BASE, 100);

const race = (over: Partial<RaceRow> = {}): RaceRow => ({
  id: RACE_ID,
  textContent: BASE,
  settings: { language: "en", errorMode: "continue", backspace: true, bonuses: true },
  endReason: "ALL_FINISHED",
  results: [
    {
      desk: 3,
      userId: "u-me",
      durationMs: MINE_KEYS.at(-1)!.t,
      overlay: OVERLAY,
      bonusLog: [
        { t: 9_000, kind: "smoke-break", from: 5, to: 3 },
        { t: 2_000, kind: "extra-paperwork", from: 5, to: 3 },
        { t: 4_000, kind: "exemption", from: 3, to: 3 }, // on oneself: sent, not received
        { t: 5_000, kind: "smoke-break", from: 3, to: 5 }, // sent
      ],
    },
    { desk: 5, userId: "u-other", durationMs: OTHER_KEYS.at(-1)!.t, overlay: null, bonusLog: [] },
    { desk: 7, userId: null, durationMs: 30_000, overlay: null, bonusLog: [] },
  ],
  keystrokes: [
    { desk: 3, userId: "u-me", ...blob(MINE_KEYS) },
    { desk: 5, userId: "u-other", ...blob(OTHER_KEYS) },
  ],
  ...over,
});

type Where = { userId?: string };
type FindArgs = {
  where: { id: string };
  select: { results: { where: Where }; keystrokes: { where: Where } };
};

function fakeDb(rows: RaceRow[]) {
  const read: Trace[] = [];
  const findUnique = vi.fn(async ({ where, select }: FindArgs) => {
    const r = rows.find((x) => x.id === where.id);
    if (!r) return null;
    const keep = <T extends { userId: string | null }>(xs: T[], w: Where) =>
      xs.filter((x) => w.userId === undefined || x.userId === w.userId);
    const keystrokes = keep(r.keystrokes, select.keystrokes.where);
    read.push(...keystrokes);
    return { ...r, results: keep(r.results, select.results.where), keystrokes };
  });
  return { db: { race: { findUnique } } as never, findUnique, read };
}

describe("getRaceSeries (#865 C2)", () => {
  it("the viewer's own series, on their effective text, ending on their scored clean WPM", async () => {
    const { db, read } = fakeDb([race()]);
    const series = await getRaceSeries(RACE_ID, { id: "u-me" }, { db });
    expect(series).not.toBeNull();
    expect(series!.points.length).toBeGreaterThanOrEqual(2);
    expect(series!.points.length).toBeLessThanOrEqual(60);
    const state = replayTrace(MINE_KEYS, MINE_TEXT, CONTINUE);
    expect(state.status).toBe("finished"); // replayed on the overlaid text, not the base
    const { clean, adjusted } = cleanAndAdjustedWpm(
      state,
      normalizeTypeable(BASE),
      OVERLAY,
      state.finishedAt!,
    );
    expect(clean).toBeLessThan(adjusted);
    expect(series!.points.at(-1)!.wpm).toBeCloseTo(clean, 6);
    expect(series!.endMs).toBe(MINE_KEYS.at(-1)!.t);
    // received marks only, in time order
    expect(series!.marks).toEqual([
      { t: 2_000, kind: "extra-paperwork" },
      { t: 9_000, kind: "smoke-break" },
    ]);
    // never another user's trace
    expect(read.map((t) => t.userId)).toEqual(["u-me"]);
  });

  it("caps the series at 60 points", async () => {
    const long = typed(normalizeTypeable(BASE), 5_000); // 150 s
    const { db } = fakeDb([
      race({
        results: [
          { desk: 3, userId: "u-me", durationMs: long.at(-1)!.t, overlay: null, bonusLog: [] },
        ],
        keystrokes: [{ desk: 3, userId: "u-me", ...blob(long) }],
      }),
    ]);
    const series = await getRaceSeries(RACE_ID, { id: "u-me" }, { db });
    expect(series!.points).toHaveLength(60);
  });

  it("null without a keystroke row: purged, bot, spectator, visitor", async () => {
    const purged = fakeDb([race({ keystrokes: [] })]);
    expect(await getRaceSeries(RACE_ID, { id: "u-me" }, { db: purged.db })).toBeNull();
    // a spectator (no desk) reads nothing, even with another user's trace in the race
    const spectator = fakeDb([race()]);
    expect(await getRaceSeries(RACE_ID, { id: "u-nobody" }, { db: spectator.db })).toBeNull();
    expect(spectator.read).toEqual([]);
    const visitor = fakeDb([race()]);
    expect(await getRaceSeries(RACE_ID, null, { db: visitor.db })).toBeNull();
    expect(visitor.findUnique).not.toHaveBeenCalled();
  });

  it("null for a bad id, an unknown or voided race, an empty or corrupt trace", async () => {
    const { db, findUnique } = fakeDb([race()]);
    expect(await getRaceSeries("not-a-uuid", { id: "u-me" }, { db })).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
    expect(
      await getRaceSeries("16fd2706-8baf-433b-82eb-8c7fada847da", { id: "u-me" }, { db }),
    ).toBeNull();
    const voided = fakeDb([race({ endReason: "VOID" })]);
    expect(await getRaceSeries(RACE_ID, { id: "u-me" }, { db: voided.db })).toBeNull();
    const empty = fakeDb([race({ keystrokes: [{ desk: 3, userId: "u-me", ...blob([]) }] })]);
    expect(await getRaceSeries(RACE_ID, { id: "u-me" }, { db: empty.db })).toBeNull();
    const corrupt = fakeDb([
      race({ keystrokes: [{ desk: 3, userId: "u-me", data: Buffer.from("nope"), count: 3 }] }),
    ]);
    expect(await getRaceSeries(RACE_ID, { id: "u-me" }, { db: corrupt.db })).toBeNull();
  });
});

// Contract of #867 C3 (data side): the keys the viewer missed come from their own trace only, replayed
// on their effective text; only the counts leave the query; null without a trace.
describe("getPersonalReplay, missed keys (#867 C3)", () => {
  /** The viewer's text typed with three wrong presses on its "f"s (Continue: the cursor moves on). */
  const missing = (text: string, char: string, times: number): Keystroke[] => {
    let left = times;
    return Array.from(text, (key, i) => {
      const miss = key === char && left > 0;
      if (miss) left -= 1;
      return { t: (i + 1) * 250, key: miss ? "x" : key };
    });
  };

  it("the viewer's own missed keys, most missed first, never another user's", async () => {
    const mine = missing(MINE_TEXT, "f", 3);
    const theirs = missing(BASE, "t", 5);
    const { db, read } = fakeDb([
      race({
        keystrokes: [
          { desk: 3, userId: "u-me", ...blob(mine) },
          { desk: 5, userId: "u-other", ...blob(theirs) },
        ],
      }),
    ]);
    const replay = await getPersonalReplay(RACE_ID, { id: "u-me" }, { db });
    expect(replay!.missed).toEqual([{ char: "f", count: 3 }]);
    expect(replay!.series).not.toBeNull();
    expect(read.map((t) => t.userId)).toEqual(["u-me"]);
  });

  it("a clean trace misses nothing; no trace on file is null", async () => {
    const clean = fakeDb([race()]);
    expect((await getPersonalReplay(RACE_ID, { id: "u-me" }, { db: clean.db }))!.missed).toEqual(
      [],
    );
    const purged = fakeDb([race({ keystrokes: [] })]);
    expect(await getPersonalReplay(RACE_ID, { id: "u-me" }, { db: purged.db })).toBeNull();
    const empty = fakeDb([race({ keystrokes: [{ desk: 3, userId: "u-me", ...blob([]) }] })]);
    expect(await getPersonalReplay(RACE_ID, { id: "u-me" }, { db: empty.db })).toBeNull();
    expect(await getPersonalReplay(RACE_ID, null, { db: clean.db })).toBeNull();
  });
});

// Contract of #999 C51 (ADR 0027): the series of every result of one race, for the decided audience
// only (a viewer with a result in the race, or the race's host). The audience is checked by a first
// query that reads no series at all; only then are the stored `RaceResult.wpmSeries` columns read, and
// never a `RaceKeystrokes` row. A flagged row and the viewer's own desk (their card replays their own
// trace) are left out; a bot is a flat line at its clean WPM, simulated.
type StoredResult = {
  desk: number;
  userId: string | null;
  name: string;
  isBot: boolean;
  place: number;
  cleanWpm: number;
  durationMs: number;
  suspicious: boolean;
  wpmSeries: unknown;
};
type StoredRace = {
  id: string;
  endReason: "ALL_FINISHED" | "VOID" | null;
  /** The host when the race started (`Race.hostUserId`); null for races started before it was recorded. */
  hostUserId: string | null;
  lobbyId: string | null;
  /** The lobby's current host, which can change after the race. */
  lobby: { hostUserId: string } | null;
  results: StoredResult[];
};

const stored = (over: Partial<StoredRace> = {}): StoredRace => ({
  id: RACE_ID,
  endReason: "ALL_FINISHED",
  hostUserId: "u-host",
  lobbyId: "lob-1",
  lobby: { hostUserId: "u-host" },
  results: [
    {
      desk: 5,
      userId: "u-win",
      name: "Lynx-785",
      isBot: false,
      place: 1,
      cleanWpm: 61.4,
      durationMs: 40_000,
      suspicious: false,
      wpmSeries: [
        [10_000, 55],
        [40_000, 61.4],
      ],
    },
    {
      desk: 3,
      userId: "u-me",
      name: "Otter-12",
      isBot: false,
      place: 2,
      cleanWpm: 48,
      durationMs: 42_000,
      suspicious: false,
      wpmSeries: [[42_000, 48]],
    },
    {
      desk: 9,
      userId: null,
      name: "Typist Bot 9",
      isBot: true,
      place: 3,
      cleanWpm: 40,
      durationMs: 50_000,
      suspicious: false,
      wpmSeries: null,
    },
    {
      desk: 11,
      userId: "u-flag",
      name: "Heron-404",
      isBot: false,
      place: 4,
      cleanWpm: 99,
      durationMs: 30_000,
      suspicious: true,
      wpmSeries: [[30_000, 99]],
    },
    {
      desk: 12,
      userId: "u-old",
      name: "Stoat-31",
      isBot: false,
      place: 5,
      cleanWpm: 20,
      durationMs: 50_000,
      suspicious: false,
      wpmSeries: null, // purged after 30 days, or filed before #999
    },
    {
      desk: 14,
      userId: "u-bad",
      name: "Crane-77",
      isBot: false,
      place: 6,
      cleanWpm: 18,
      durationMs: 50_000,
      suspicious: false,
      wpmSeries: [["x", 1]], // a stored value the schema rejects
    },
  ],
  ...over,
});

type ResultWhere = { userId?: string; suspicious?: boolean; desk?: { not: number } };
type AllArgs = {
  where: { id: string };
  select: Record<string, unknown> & { results?: { where?: ResultWhere; select: object } };
};

/** An in-memory Race table that applies the nested `where` and records every select it was asked. */
function storedDb(rows: StoredRace[]) {
  const selects: AllArgs["select"][] = [];
  const findUnique = vi.fn(async ({ where, select }: AllArgs) => {
    selects.push(select);
    const r = rows.find((x) => x.id === where.id);
    if (!r) return null;
    const w = select.results?.where ?? {};
    const results = r.results.filter(
      (x) =>
        (w.userId === undefined || x.userId === w.userId) &&
        (w.suspicious === undefined || x.suspicious === w.suspicious) &&
        (w.desk === undefined || x.desk !== w.desk.not),
    );
    return { ...r, results };
  });
  return { db: { race: { findUnique } } as never, findUnique, selects };
}

const readsSeries = (s: AllArgs["select"]) => JSON.stringify(s).includes("wpmSeries");
const readsTrace = (s: AllArgs["select"]) => JSON.stringify(s).includes("keystrokes");

describe("getRaceSeriesForAll (#999 C51, ADR 0027)", () => {
  it("a participant gets every other unflagged result's stored series, in place order", async () => {
    const { db, selects } = storedDb([stored()]);
    const lines = await getRaceSeriesForAll(RACE_ID, { id: "u-me" }, { db });
    expect(lines.map((l) => l.desk)).toEqual([5, 9]);
    expect(lines[0]).toEqual({
      desk: 5,
      name: "Lynx-785",
      place: 1,
      isBot: false,
      wpm: 61.4,
      endMs: 40_000,
      points: [
        { t: 10_000, wpm: 55 },
        { t: 40_000, wpm: 61.4 },
      ],
    });
    // never a keystroke row, for anyone
    expect(selects.some(readsTrace)).toBe(false);
  });

  it("a bot is a flat line at its stored clean WPM over its race time", async () => {
    const { db } = storedDb([stored()]);
    const bot = (await getRaceSeriesForAll(RACE_ID, { id: "u-me" }, { db })).find(
      (l) => l.desk === 9,
    )!;
    expect(bot.isBot).toBe(true);
    expect(bot.points).toEqual([
      { t: 0, wpm: 40 },
      { t: 50_000, wpm: 40 },
    ]);
  });

  it("a flagged row is never shown to others, and is not even read", async () => {
    const { db, selects } = storedDb([stored()]);
    const lines = await getRaceSeriesForAll(RACE_ID, { id: "u-me" }, { db });
    expect(lines.some((l) => l.desk === 11)).toBe(false);
    const read = selects.find(readsSeries)!;
    expect(read.results?.where?.suspicious).toBe(false);
  });

  it("the race's host without a desk sees every unflagged line", async () => {
    const { db } = storedDb([stored()]);
    const lines = await getRaceSeriesForAll(RACE_ID, { id: "u-host" }, { db });
    expect(lines.map((l) => l.desk)).toEqual([5, 3, 9]);
  });

  it("the audience is fixed at race time: a member who becomes host later sees no other line", async () => {
    // u-heir joined the lobby and inherited the host role after this race; they had no desk in it
    const { db, selects } = storedDb([stored({ lobby: { hostUserId: "u-heir" } })]);
    expect(await getRaceSeriesForAll(RACE_ID, { id: "u-heir" }, { db })).toEqual([]);
    expect(selects.some(readsSeries)).toBe(false);
  });

  it("the race-time host who did not type still sees every line after handing the role on", async () => {
    const { db } = storedDb([stored({ lobby: { hostUserId: "u-heir" } })]);
    const lines = await getRaceSeriesForAll(RACE_ID, { id: "u-host" }, { db });
    expect(lines.map((l) => l.desk)).toEqual([5, 3, 9]);
  });

  it("a race with no recorded host is shown to its typists only, never to the current host", async () => {
    const { db, selects } = storedDb([stored({ hostUserId: null })]);
    expect(await getRaceSeriesForAll(RACE_ID, { id: "u-host" }, { db })).toEqual([]);
    expect(selects.some(readsSeries)).toBe(false);
    const typist = await getRaceSeriesForAll(RACE_ID, { id: "u-me" }, { db });
    expect(typist.map((l) => l.desk)).toEqual([5, 9]);
  });

  it("the gate reads the race's own host, not the lobby's current one", async () => {
    const { db, selects } = storedDb([stored()]);
    await getRaceSeriesForAll(RACE_ID, { id: "u-host" }, { db });
    expect(selects[0]).toHaveProperty("hostUserId", true);
    expect(JSON.stringify(selects[0])).not.toContain('"lobby":{"select":{"hostUserId"');
  });

  it("an outsider (neither a participant nor the host) gets none, and no series is read", async () => {
    const { db, selects, findUnique } = storedDb([stored()]);
    expect(await getRaceSeriesForAll(RACE_ID, { id: "u-stranger" }, { db })).toEqual([]);
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(selects.some(readsSeries)).toBe(false);
    expect(selects.some(readsTrace)).toBe(false);
  });

  it("fails closed: no viewer, a bad id, no race, a voided race, a race with no lobby", async () => {
    const { db, findUnique } = storedDb([stored()]);
    expect(await getRaceSeriesForAll(RACE_ID, null, { db })).toEqual([]);
    expect(await getRaceSeriesForAll("not-a-uuid", { id: "u-me" }, { db })).toEqual([]);
    expect(findUnique).not.toHaveBeenCalled();
    const other = "0e4f6b1a-6a8f-4c1e-9d0e-1f2a3b4c5d6e";
    expect(await getRaceSeriesForAll(other, { id: "u-me" }, { db })).toEqual([]);
    const voided = storedDb([stored({ endReason: "VOID" })]);
    expect(await getRaceSeriesForAll(RACE_ID, { id: "u-me" }, { db: voided.db })).toEqual([]);
    expect(voided.selects.some(readsSeries)).toBe(false);
    const orphan = storedDb([stored({ lobbyId: null, lobby: null })]);
    expect(await getRaceSeriesForAll(RACE_ID, { id: "u-host" }, { db: orphan.db })).toEqual([]);
    expect(orphan.selects.some(readsSeries)).toBe(false);
  });
});
