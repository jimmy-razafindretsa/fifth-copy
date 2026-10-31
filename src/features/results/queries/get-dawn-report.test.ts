import { describe, expect, it, vi } from "vitest";

// The identity barrel (outfitForDesk, parseOutfit) is server code: importing it validates the env, which
// these tests do not need.
vi.mock("@/env", () => ({ env: {} }));
const { OUTFIT_CATALOGUE, outfitForDesk } = await import("@/features/identity");
const { getDawnReport } = await import("./get-dawn-report");

// Contract of #300 C1: `getDawnReport(raceId, viewer)` validates the id as a uuid before any query, then
// answers null (unknown), filing (no rows yet) or the report (entries in place order, clean WPM, the
// viewer's desk). An in-memory Race table stands in for Prisma (the select shape is the query's own).
type Row = {
  desk: number;
  userId: string | null;
  name: string;
  isBot: boolean;
  place: number;
  status: "FINISHED" | "LINE_CUT";
  wpm: number;
  rawWpm: number;
  cleanWpm: number;
  adjustedWpm: number;
  accuracy: number;
  progress: number;
  finishedAtMs: number | null;
  suspicious: boolean;
  /** The `user` relation as the nested select returns it: null for a bot. */
  user: { outfit: unknown } | null;
};
type RaceRow = {
  id: string;
  textLanguage: "FR" | "EN";
  endedAt: Date | null;
  endReason: "ALL_FINISHED" | "TIMER" | null;
  lobby: { code: string } | null;
  results: Row[];
};

const RACE_ID = "3b241101-e2bb-4255-8caf-4136c566a962";
const FILING_ID = "9c5b94b1-35ad-49bb-b118-8e8fc24abf80";
const UNKNOWN_ID = "16fd2706-8baf-433b-82eb-8c7fada847da";
const ENDED = new Date("2026-10-08T08:14:00Z");

const row = (over: Partial<Row>): Row => ({
  desk: 1,
  userId: null,
  name: "Bot",
  isBot: true,
  place: 1,
  status: "FINISHED",
  wpm: 50,
  rawWpm: 55,
  cleanWpm: 48,
  adjustedWpm: 70,
  accuracy: 0.95,
  progress: 1,
  finishedAtMs: 40_000,
  suspicious: false,
  user: null,
  ...over,
});

/** A saved outfit the catalogue accepts (bible 10.1 ids). */
const SAVED = {
  hair: "quiff",
  glasses: "monocle",
  hat: "beret",
  clothes: "jacket",
  face: "beard",
  hairCol: OUTFIT_CATALOGUE.hairCol[1]!,
};
const OUTFITS_ID = "0b1e8a52-77a4-4f0e-9d3b-2c8f5e6a1d44";

const RACES: RaceRow[] = [
  {
    id: RACE_ID,
    textLanguage: "FR",
    endedAt: ENDED,
    endReason: "ALL_FINISHED",
    lobby: { code: "KGB-4821" },
    // stored out of order: the query orders by place, then desk
    results: [
      row({ desk: 5, place: 3, name: "Otter-417", isBot: false, userId: "u-otter", cleanWpm: 31 }),
      row({ desk: 2, place: 1, name: "Lynx-785", isBot: false, userId: "u-lynx", cleanWpm: 61 }),
      row({ desk: 9, place: 2, name: "Typist Bot 2", cleanWpm: 44, suspicious: true }),
      row({ desk: 4, place: 4, status: "LINE_CUT", finishedAtMs: null, progress: 0.4 }),
    ],
  },
  { id: FILING_ID, textLanguage: "EN", endedAt: null, endReason: null, lobby: null, results: [] },
  {
    // #688 C1: one of each outfit case, six desks
    id: OUTFITS_ID,
    textLanguage: "EN",
    endedAt: ENDED,
    endReason: "ALL_FINISHED",
    lobby: null,
    results: [
      row({ desk: 7, place: 1, isBot: false, userId: "u-saved", user: { outfit: SAVED } }),
      row({ desk: 3, place: 2 }),
      row({ desk: 12, place: 3, isBot: false, userId: "u-none", user: { outfit: null } }),
      row({
        desk: 5,
        place: 4,
        isBot: false,
        userId: "u-stale",
        user: { outfit: { ...SAVED, hat: "tricorne" } },
      }),
      row({ desk: 9, place: 5, isBot: false, userId: "u-junk", user: { outfit: "beret" } }),
      row({ desk: 6, place: 6 }),
    ],
  },
];

function fakeDb() {
  const findUnique = vi.fn(
    async ({
      where,
      select,
    }: {
      where: { id: string };
      select: { results: { orderBy: unknown; select: Record<string, unknown> } };
    }) => {
      const race = RACES.find((r) => r.id === where.id);
      if (!race) return null;
      const keys = Object.keys(select.results.select);
      const results = [...race.results]
        .sort((a, b) => a.place - b.place || a.desk - b.desk)
        .map((r) => Object.fromEntries(keys.map((k) => [k, r[k as keyof Row]])));
      return { ...race, results };
    },
  );
  return { db: { race: { findUnique } } as never, findUnique };
}

describe("getDawnReport (#300 C1)", () => {
  it.each([["not-a-uuid"], [""], ["cmuvut8r2000106r7wf01vr30"], [`${RACE_ID}x`]])(
    "answers null for %j without querying",
    async (id) => {
      const { db, findUnique } = fakeDb();
      await expect(getDawnReport(id, null, { db })).resolves.toBeNull();
      expect(findUnique).not.toHaveBeenCalled();
    },
  );

  it("answers null for an unknown race", async () => {
    const { db } = fakeDb();
    await expect(getDawnReport(UNKNOWN_ID, null, { db })).resolves.toBeNull();
  });

  it("answers filing while the race has no results", async () => {
    const { db } = fakeDb();
    await expect(getDawnReport(FILING_ID, { id: "u-lynx" }, { db })).resolves.toEqual({
      kind: "filing",
      raceId: FILING_ID,
      lobbyCode: null,
    });
  });

  it("answers the report: race, entries by place with clean WPM, never adjustedWpm", async () => {
    const { db, findUnique } = fakeDb();
    const report = await getDawnReport(RACE_ID, null, { db });
    expect(report).toMatchObject({
      kind: "report",
      race: {
        id: RACE_ID,
        language: "fr",
        endedAt: ENDED,
        endReason: "ALL_FINISHED",
        lobbyCode: "KGB-4821",
      },
      viewerDesk: null,
    });
    if (report?.kind !== "report") throw new Error("report expected");
    expect(report.entries.map((e) => [e.place, e.desk, e.wpm])).toEqual([
      [1, 2, 61],
      [2, 9, 44],
      [3, 5, 31],
      [4, 4, 48],
    ]);
    expect(report.entries[0]).toEqual({
      outfit: outfitForDesk(2),
      desk: 2,
      name: "Lynx-785",
      isBot: false,
      place: 1,
      status: "FINISHED",
      wpm: 61,
      accuracy: 0.95,
      progress: 1,
      finishedAtMs: 40_000,
      suspicious: false,
    });
    expect(report.entries[1]!.suspicious).toBe(true);
    for (const e of report.entries) expect(e).not.toHaveProperty("adjustedWpm");
    const select = findUnique.mock.calls[0]![0].select.results.select;
    expect(select).toHaveProperty("cleanWpm", true);
    expect(select).not.toHaveProperty("adjustedWpm");
    expect(select).not.toHaveProperty("wpm");
  });

  it.each([
    ["present", { id: "u-otter" }, 5],
    ["absent", { id: "u-nobody" }, null],
    ["a guest-less visitor", null, null],
  ])("viewer %s -> viewerDesk", async (_, viewer, desk) => {
    const { db } = fakeDb();
    const report = await getDawnReport(RACE_ID, viewer, { db });
    expect(report?.kind === "report" && report.viewerDesk).toBe(desk);
  });
});

describe("getDawnReport outfits (#688 C1)", () => {
  it("one query for a six-desk race, the outfit selected inside the results select", async () => {
    const { db, findUnique } = fakeDb();
    const report = await getDawnReport(OUTFITS_ID, null, { db });
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(report?.kind === "report" && report.entries).toHaveLength(6);
    expect(findUnique.mock.calls[0]![0].select.results.select).toHaveProperty("user", {
      select: { outfit: true },
    });
  });

  it.each([
    ["a saved outfit, returned as stored", 7, SAVED],
    ["a bot (userId null)", 3, outfitForDesk(3)],
    ["a player whose outfit is null", 12, outfitForDesk(12)],
    ["a stored outfit the catalogue rejects", 5, outfitForDesk(5)],
    ["a stored value that is not an outfit", 9, outfitForDesk(9)],
  ])("%s", async (_, desk, outfit) => {
    const { db } = fakeDb();
    const report = await getDawnReport(OUTFITS_ID, null, { db });
    if (report?.kind !== "report") throw new Error("report expected");
    expect(report.entries.find((e) => e.desk === desk)?.outfit).toEqual(outfit);
  });

  it("every entry carries an outfit", async () => {
    const { db } = fakeDb();
    const report = await getDawnReport(OUTFITS_ID, null, { db });
    if (report?.kind !== "report") throw new Error("report expected");
    for (const e of report.entries) expect(Object.keys(e.outfit).sort()).toHaveLength(6);
  });
});
