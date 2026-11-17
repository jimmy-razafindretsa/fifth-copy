import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { COUNTED_RACE } from "@/features/results";
import { createPrismaClient } from "@/server/db-client";
import { emptyProfile } from "../view/profile";
import { getProfile } from "./get-profile";

// The results index pulls in auth, which validates env at import; CI has no AUTH_SECRET (like route.test.ts).
vi.mock("@/env", () => ({ env: { NODE_ENV: "test" } }));

// #931 C3, C4: getProfile reads the viewer's own counted results only, in a constant number of queries.
const NOW = new Date("2026-11-13T17:00:00Z");
const VIEWER = { id: "viewer-1" };

type Call = { op: string; args: Record<string, unknown> };

/** A stand-in client that records every call and answers with `rows` (honouring `take`). */
function fakeDb(
  rows: {
    createdAt: Date;
    cleanWpm: number;
    accuracy: number;
    lang: "FR" | "EN";
    place?: number;
    durationMs?: number;
    lobby?: { code: string; type: "PRIVATE" | "PUBLIC" } | null;
    lobbySize?: number | null;
    otherHumans?: number;
  }[],
) {
  const calls: Call[] = [];
  const selected = rows.map((r) => ({
    createdAt: r.createdAt,
    cleanWpm: r.cleanWpm,
    accuracy: r.accuracy,
    durationMs: r.durationMs ?? 60_000,
    place: r.place ?? 2,
    race: {
      textLanguage: r.lang,
      lobbySize: r.lobbySize ?? null,
      lobby: r.lobby ?? null,
      _count: { results: r.otherHumans ?? 0 },
    },
  }));
  const raceResult = {
    findMany: vi.fn(async (args: { take: number; orderBy: { createdAt: string }[] }) => {
      calls.push({ op: "findMany", args });
      const dir = args.orderBy[0]?.createdAt === "desc" ? -1 : 1;
      return [...selected]
        .sort((a, b) => dir * (a.createdAt.getTime() - b.createdAt.getTime()))
        .slice(0, args.take);
    }),
    aggregate: vi.fn(async (args: { where: { race: { textLanguage?: string } } }) => {
      calls.push({ op: "aggregate", args });
      const lang = args.where.race.textLanguage;
      const mine = selected.filter((r) => !lang || r.race.textLanguage === lang);
      const wpm = mine.map((r) => r.cleanWpm);
      const acc = mine.map((r) => r.accuracy);
      const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
      return {
        _count: { _all: mine.length },
        _sum: { durationMs: mine.length ? mine.reduce((a, r) => a + r.durationMs, 0) : null },
        _max: {
          cleanWpm: wpm.length ? Math.max(...wpm) : null,
          accuracy: acc.length ? Math.max(...acc) : null,
        },
        _avg: { cleanWpm: mean(wpm), accuracy: mean(acc) },
      };
    }),
    groupBy: vi.fn(async (args: { where: { place: { in: number[] } } }) => {
      calls.push({ op: "groupBy", args });
      const counts = new Map<number, number>();
      for (const r of selected)
        if (args.where.place.in.includes(r.place))
          counts.set(r.place, (counts.get(r.place) ?? 0) + 1);
      return [...counts].map(([place, n]) => ({ place, _count: { _all: n } }));
    }),
  };
  return { db: { raceResult } as never, calls };
}

const COUNTED_WHERE = {
  userId: VIEWER.id,
  isBot: false,
  suspicious: false,
  status: { in: ["FINISHED", "TIMED_OUT"] },
};

const ROW_SELECT = {
  createdAt: true,
  cleanWpm: true,
  accuracy: true,
  durationMs: true,
  place: true,
  race: { select: { textLanguage: true } },
};
// #936 C2: the streak read selects only accuracy, clean WPM and date
const STREAK_SELECT = { createdAt: true, cleanWpm: true, accuracy: true };
// #936 C2: the archive reads its own row, the room, and a count of the other humans (never their rows)
const ARCHIVE_SELECT = {
  createdAt: true,
  cleanWpm: true,
  accuracy: true,
  place: true,
  race: {
    select: {
      textLanguage: true,
      lobbySize: true,
      lobby: { select: { code: true, type: true } },
      _count: { select: { results: { where: { isBot: false, NOT: { userId: VIEWER.id } } } } },
    },
  },
};

describe("getProfile (stand-in client)", () => {
  it("a null viewer gets the empty profile without a query", async () => {
    const { db, calls } = fakeDb([]);
    expect(await getProfile(null, { db, now: NOW })).toEqual(emptyProfile(NOW));
    expect(calls).toHaveLength(0);
  });

  it("every query is keyed by the viewer and carries the counted filters and COUNTED_RACE", async () => {
    const { db, calls } = fakeDb([
      { createdAt: new Date("2026-11-13T15:00:00Z"), cleanWpm: 40, accuracy: 0.9, lang: "FR" },
    ]);
    await getProfile(VIEWER, { db, now: NOW });
    expect(calls.map((c) => c.op).sort()).toEqual([
      "aggregate",
      "aggregate",
      "aggregate",
      "findMany",
      "findMany",
      "findMany",
      "findMany",
      "groupBy",
    ]);
    for (const { args } of calls) {
      const where = args.where as Record<string, unknown> & { race: Record<string, unknown> };
      expect(where).toMatchObject(COUNTED_WHERE);
      expect(where.race).toMatchObject(COUNTED_RACE);
      expect(where.race.endReason).toEqual({ in: ["ALL_FINISHED", "TIMER"] });
    }
    const languages = calls
      .filter((c) => c.op === "aggregate")
      .map((c) => (c.args.where as { race: { textLanguage?: string } }).race.textLanguage ?? "ALL");
    expect(languages.sort()).toEqual(["ALL", "EN", "FR"]);
  });

  it("selects cleanWpm and never wpm, rawWpm or adjustedWpm, nor the keystrokes", async () => {
    const { db, calls } = fakeDb([]);
    await getProfile(VIEWER, { db, now: NOW });
    for (const { op, args } of calls) {
      const sent = JSON.stringify(args);
      expect(sent).not.toMatch(/"(wpm|rawWpm|adjustedWpm|keystrokes)"/);
      expect(sent).not.toContain("RaceKeystrokes");
      if (op === "findMany") {
        expect([ROW_SELECT, STREAK_SELECT, ARCHIVE_SELECT]).toContainEqual(args.select);
      } else if (op === "aggregate") {
        expect(args).toMatchObject({ _max: { cleanWpm: true }, _avg: { cleanWpm: true } });
      } else {
        expect(args).toMatchObject({ by: ["place"], _count: { _all: true } });
      }
    }
  });

  it("#932 C3: the service record counts wins (place 1) and podiums (places 1 to 3) over the whole file", async () => {
    const at = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
    const { db } = fakeDb([
      { createdAt: at(1), cleanWpm: 40, accuracy: 0.9, lang: "FR", place: 1, durationMs: 30_000 },
      { createdAt: at(2), cleanWpm: 50, accuracy: 0.96, lang: "EN", place: 3, durationMs: 45_000 },
      { createdAt: at(3), cleanWpm: 30, accuracy: 0.84, lang: "FR", place: 5, durationMs: 60_000 },
    ]);
    const p = await getProfile(VIEWER, { db, now: NOW });
    expect(p.service).toEqual({
      totalMs: 135_000,
      races: 3,
      bestWpm: 50,
      meanWpm: 40,
      bestAccuracy: 0.96,
      meanAccuracy: expect.closeTo(0.9, 6),
      wins: 1,
      podiums: 2,
      keystrokes: 0,
      errors: 0,
      sabotagesSent: 0,
      sabotagesReceived: 0,
    });
  });

  it("#936 C2: the archive holds the 8 latest, newest first, with room, mode, place and lobby size", async () => {
    const at = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
    const rows = Array.from({ length: 10 }, (_, i) => ({
      createdAt: at(i + 1),
      cleanWpm: 40 + i,
      accuracy: 0.9,
      lang: "FR" as const,
      place: (i % 4) + 1,
      lobbySize: 6,
      lobby:
        i === 1
          ? null
          : { code: `ROOM-${i}`, type: i % 2 ? ("PRIVATE" as const) : ("PUBLIC" as const) },
      otherHumans: i === 0 ? 0 : 2,
    }));
    const { db, calls } = fakeDb(rows);
    const p = await getProfile(VIEWER, { db, now: NOW });
    const archiveCall = calls.find((c) => c.args.take === 8);
    expect(archiveCall?.args).toMatchObject({
      take: 8,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(p.archive).toHaveLength(8);
    expect(p.archive.map((e) => e.cleanWpm)).toEqual([40, 41, 42, 43, 44, 45, 46, 47]);
    expect(p.archive[0]).toEqual({
      at: at(1).toISOString(),
      room: "ROOM-0",
      mode: "BOTS",
      place: 1,
      lobbySize: 6,
      cleanWpm: 40,
      accuracy: 0.9,
    });
    expect(p.archive[1]).toMatchObject({ room: null, mode: "RACE", place: 2 });
    expect(p.archive[2]).toMatchObject({ room: "ROOM-2", mode: "RACE" });
    expect(p.archive[3]).toMatchObject({ room: "ROOM-3", mode: "PRIVATE" });
  });

  it("#936 C2: the streaks read the capped scan (5 000 latest), in race order", async () => {
    const at = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
    const { db, calls } = fakeDb(
      [0.99, 0.91, 1, 1, 0.97].map((accuracy, i) => ({
        createdAt: at(5 - i),
        cleanWpm: 30 + i,
        accuracy,
        lang: "EN" as const,
      })),
    );
    const p = await getProfile(VIEWER, { db, now: NOW });
    expect(calls.some((c) => c.args.take === 5_000 && c.args.select !== undefined)).toBe(true);
    expect(p.streaks.map((s) => [s.threshold, s.best, s.current])).toEqual([
      [100, 2, 0],
      [98, 2, 0],
      [95, 3, 3],
      [90, 5, 5],
    ]);
  });

  it("C4: 250 stored results give 200 points in 8 queries, the latest ones, oldest first", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({
      createdAt: new Date(NOW.getTime() - (250 - i) * 60_000),
      cleanWpm: i,
      accuracy: 0.9,
      lang: (i % 2 ? "EN" : "FR") as "FR" | "EN",
    }));
    const { db, calls } = fakeDb(rows);
    const p = await getProfile(VIEWER, { db, now: NOW });
    expect(calls).toHaveLength(8);
    expect(p.progress.series).toHaveLength(200);
    expect(p.progress.series[0]?.cleanWpm).toBe(50);
    expect(p.progress.series[199]?.cleanWpm).toBe(249);
    expect(p.total).toBe(250);
    expect(p.languages.EN.bestWpm).toBe(249);
    // Latest five 245..249 minus the whole file's earliest five 0..4.
    expect(p.progress.gain).toBe(245);
  });

  it("COUNTED_RACE is imported from the results feature, not copied", () => {
    // #943: the counted filter moved to counted-where.ts, shared with getMissions
    const source = readFileSync(path.join(__dirname, "get-profile.ts"), "utf8");
    const filter = readFileSync(path.join(__dirname, "counted-where.ts"), "utf8");
    expect(source).toMatch(/import \{ countedWhere \} from "\.\/counted-where";/);
    expect(filter).toMatch(/import \{ COUNTED_RACE \} from "@\/features\/results\/server";/);
    expect(filter).not.toMatch(/ALL_FINISHED|"TIMER"|VOID/);
    expect(source).not.toMatch(/ALL_FINISHED|"TIMER"|VOID/);
    expect(source).not.toMatch(/raceKeystrokes|adjustedWpm: true|rawWpm: true/);
  });
});

// Against real Postgres (ADR 0003): rows that are not the viewer's counted results never reach the
// profile, and the query count does not grow with the file.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)(
  "getProfile (needs TEST_DATABASE_URL, run scripts/test-db.sh)",
  () => {
    const base = createPrismaClient(testDatabaseUrl ?? "postgresql://unused");
    let queries = 0;
    const db = base.$extends({
      query: {
        async $allOperations({ args, query }) {
          queries += 1;
          return query(args);
        },
      },
    }) as unknown as Parameters<typeof getProfile>[1] extends infer O
      ? O extends { db?: infer D }
        ? D
        : never
      : never;
    const PREFIX = "test-get-profile-";
    const raceIds: string[] = [];
    const HOUR = 3_600_000;

    const cleanup = async () => {
      await base.race.deleteMany({ where: { id: { in: raceIds.splice(0) } } });
      await base.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });
    };
    const user = async (name: string) =>
      (await base.user.create({ data: { isGuest: true, typistName: `${PREFIX}${name}` } })).id;

    type Desk = {
      userId: string | null;
      cleanWpm: number;
      isBot?: boolean;
      suspicious?: boolean;
      status?: "FINISHED" | "TIMED_OUT" | "REASSIGNED" | "ASLEEP";
    };

    /** One race `hoursAgo` before NOW, ended with `endReason`, one result per desk. */
    async function race(
      hoursAgo: number,
      desks: Desk[],
      endReason: "ALL_FINISHED" | "TIMER" | "VOID" | null = "ALL_FINISHED",
      lang: "FR" | "EN" = "FR",
    ) {
      const id = randomUUID();
      raceIds.push(id);
      const at = new Date(NOW.getTime() - hoursAgo * HOUR);
      await base.race.create({
        data: {
          id,
          textContent: "le chat dort",
          textLanguage: lang,
          textWordCount: 3,
          settings: { mode: "classic", durationS: 60 },
          startedAt: at,
          endedAt: endReason ? at : null,
          endReason,
          engineVersion: "0.1.0",
          protocolVersion: 2,
        },
      });
      await base.raceResult.createMany({
        data: desks.map((d, desk) => ({
          raceId: id,
          desk,
          userId: d.userId,
          name: `${PREFIX}desk${desk}`,
          isBot: d.isBot ?? d.userId === null,
          place: desk + 1,
          status: d.status ?? "FINISHED",
          wpm: 999,
          rawWpm: 999,
          cleanWpm: d.cleanWpm,
          adjustedWpm: 999,
          accuracy: 0.95,
          progress: 1,
          correct: 10,
          errors: 0,
          total: 10,
          durationMs: 30_000,
          bonusesSent: 0,
          bonusesReceived: 0,
          bonusLog: [],
          suspicious: d.suspicious ?? false,
          engineVersion: "0.1.0",
          createdAt: at,
        })),
      });
    }

    beforeEach(async () => {
      await cleanup();
      queries = 0;
    });
    afterAll(async () => {
      await cleanup();
      await base.$disconnect();
    });

    it("C3: another user's, a bot's, a flagged, a voided, an open and a REASSIGNED row never count", async () => {
      const me = await user("me");
      const other = await user("other");
      await race(1, [
        { userId: me, cleanWpm: 40 },
        { userId: other, cleanWpm: 90 },
        { userId: null, cleanWpm: 91 },
      ]);
      await race(2, [{ userId: me, cleanWpm: 50, status: "TIMED_OUT" }], "TIMER", "EN");
      await race(3, [{ userId: me, cleanWpm: 92, isBot: true }]);
      await race(4, [{ userId: me, cleanWpm: 93, suspicious: true }]);
      await race(5, [{ userId: me, cleanWpm: 94 }], "VOID");
      await race(6, [{ userId: me, cleanWpm: 95 }], null);
      await race(7, [{ userId: me, cleanWpm: 96, status: "REASSIGNED" }]);
      await race(8, [{ userId: me, cleanWpm: 97, status: "ASLEEP" }]);

      const p = await getProfile({ id: me }, { db, now: NOW });
      expect(p.total).toBe(2);
      expect(p.progress.series.map((s) => s.cleanWpm)).toEqual([50, 40]);
      expect(p.languages.FR).toEqual({ races: 1, bestWpm: 40, meanWpm: 40 });
      expect(p.languages.EN).toEqual({ races: 1, bestWpm: 50, meanWpm: 50 });
      // #932: the service record counts the same two rows (both at desk 0, so place 1).
      expect(p.service).toMatchObject({ races: 2, totalMs: 60_000, wins: 2, podiums: 2 });
      expect(p.service.bestWpm).toBe(50);
      // The other typist sees only their own row.
      const theirs = await getProfile({ id: other }, { db, now: NOW });
      expect(theirs.progress.series.map((s) => s.cleanWpm)).toEqual([90]);
    });

    it("#936 C2: the archive names the mode from a count of the other humans and reads only my row", async () => {
      const me = await user("archive-me");
      const other = await user("archive-other");
      await race(1, [
        { userId: me, cleanWpm: 40 },
        { userId: null, cleanWpm: 91 },
      ]);
      await race(2, [
        { userId: other, cleanWpm: 90 },
        { userId: me, cleanWpm: 50 },
      ]);
      const p = await getProfile({ id: me }, { db, now: NOW });
      expect(p.archive).toEqual([
        expect.objectContaining({ room: null, mode: "BOTS", place: 1, cleanWpm: 40 }),
        expect.objectContaining({ room: null, mode: "RACE", place: 2, cleanWpm: 50 }),
      ]);
      // the other typist's figures never reach the archive
      expect(p.archive.map((e) => e.cleanWpm)).toEqual([40, 50]);
    });

    it("C4: 250 stored results give at most 200 points in the same number of queries as 1", async () => {
      const me = await user("busy");
      await race(100, [{ userId: me, cleanWpm: 1 }]);
      queries = 0;
      await getProfile({ id: me }, { db, now: NOW });
      const forOne = queries;
      for (let i = 2; i <= 250; i += 1) await race(i / 10, [{ userId: me, cleanWpm: i }]);
      queries = 0;
      const p = await getProfile({ id: me }, { db, now: NOW });
      expect(queries).toBe(forOne);
      // #932's six and #936's streak scan and archive
      expect(queries).toBe(8);
      expect(p.total).toBe(250);
      expect(p.progress.series).toHaveLength(200);
      // The latest 200 are the races 0.2 h .. 20.1 h ago (wpm 2..201), oldest first.
      expect(p.progress.series[0]?.cleanWpm).toBe(201);
      expect(p.progress.series.at(-1)?.cleanWpm).toBe(2);
      // The whole file's earliest result (wpm 1, 100 h ago) still feeds the gain.
      expect(p.progress.gain).toBe(
        Math.round((2 + 3 + 4 + 5 + 6) / 5 - (1 + 250 + 249 + 248 + 247) / 5),
      );
      expect(p.languages.FR.bestWpm).toBe(250);
    }, 60_000);
  },
);
