import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  cleanAndAdjustedWpm,
  effectiveText,
  normalizeTypeable,
  replayTrace,
  type Keystroke,
} from "@fifth-copy/engine";
import { getRaceSeries } from "./get-race-series";

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
