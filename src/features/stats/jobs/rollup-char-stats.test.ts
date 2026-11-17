import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Keystroke } from "@fifth-copy/engine";
import { durationMs, type JobContext } from "@/worker/job";
import { createPrismaClient } from "@/server/db-client";
import { ROLLUP_BATCH, rollupCharStats, rollupKeystrokes } from "./rollup-char-stats";

// #314: the rollup job turns unrolled RaceKeystrokes into CharStatDaily and BigramStatDaily rows
// (ADR 0008, 0011, 0024). DB-backed tests target the test database (ADR 0003) and scope every run
// to their own typists, since other test files share that database.

// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const silent = { info: () => undefined, error: () => undefined };
const NOW = new Date("2026-11-17T12:00:00Z");

describe("rollupCharStats job (C1)", () => {
  it("is named, starts at most one minute apart, and takes at most 200 oldest unrolled rows", async () => {
    expect(rollupCharStats.name).toBe("stats.rollup");
    expect(durationMs(rollupCharStats.every)).toBe(60 * 1000);
    expect(ROLLUP_BATCH).toBe(200);

    const calls: unknown[] = [];
    const db = {
      raceKeystrokes: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return [];
        },
      },
    };
    await rollupCharStats.run({ db, now: NOW, log: silent } as unknown as JobContext);
    expect(calls).toEqual([
      expect.objectContaining({
        where: { rolledUpAt: null },
        orderBy: [{ createdAt: "asc" }, { raceId: "asc" }, { desk: "asc" }],
        take: 200,
      }),
    ]);
  });

  it("C6 only the worker registry imports the job", () => {
    const registry = readFileSync(path.join(__dirname, "../../../worker/registry.ts"), "utf8");
    expect(registry).toMatch(/import \{ rollupCharStats \} from "@\/features\/stats\/jobs\/rollup-char-stats";/);
    const source = readFileSync(path.join(__dirname, "rollup-char-stats.ts"), "utf8");
    // trace decoding and effective text come from the results feature's public server entry
    expect(source).toMatch(/from "@\/features\/results\/server"/);
    expect(source).not.toMatch(/gunzip|effectiveText\(|normalizeTypeable/);
  });
});

describe.skipIf(!testDatabaseUrl)(
  "rollupKeystrokes against the test database (needs TEST_DATABASE_URL)",
  () => {
    const db = createPrismaClient(testDatabaseUrl ?? "postgresql://unused");
    const PREFIX = "test-rollup-chars-";
    const raceIds: string[] = [];
    let users: string[] = [];

    const cleanup = async () => {
      await db.race.deleteMany({ where: { id: { in: raceIds } } });
      await db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });
    };

    const user = async (layout?: "US_QWERTY") => {
      const id = (
        await db.user.create({
          data: {
            typistName: `${PREFIX}${randomUUID().slice(0, 8)}`,
            ...(layout ? { preference: { create: { layout } } } : {}),
          },
        })
      ).id;
      users.push(id);
      return id;
    };

    const typed = (text: string): Keystroke[] =>
      [...text].map((key, i) => ({ t: 100 * (i + 1), key }));

    type Stored = {
      userId: string;
      text: string;
      keys?: Keystroke[];
      overlay?: { extra: string[]; removed: number[] };
      endReason?: "ALL_FINISHED" | "TIMER" | "VOID";
      isBot?: boolean;
      suspicious?: boolean;
      status?: "FINISHED" | "TIMED_OUT" | "ASLEEP";
      createdAt?: Date;
      data?: Uint8Array;
      keysAt?: Date;
    };

    /** One race with one desk, its result and its stored trace. */
    const stored = async (s: Stored) => {
      const raceId = randomUUID();
      raceIds.push(raceId);
      const keys = s.keys ?? typed(s.text);
      await db.race.create({
        data: {
          id: raceId,
          textContent: s.text,
          textLanguage: "FR",
          textWordCount: s.text.split(" ").length,
          settings: { errorMode: "continue", backspace: true },
          startedAt: new Date("2026-11-16T10:00:00Z"),
          endedAt: new Date("2026-11-16T10:05:00Z"),
          endReason: s.endReason ?? "ALL_FINISHED",
          engineVersion: "0.1.0",
          protocolVersion: 1,
          results: {
            create: {
              desk: 1,
              userId: s.userId,
              name: "Typist",
              isBot: s.isBot ?? false,
              place: 1,
              status: s.status ?? "FINISHED",
              wpm: 50,
              rawWpm: 50,
              cleanWpm: 50,
              adjustedWpm: 50,
              accuracy: 1,
              progress: 1,
              correct: keys.length,
              errors: 0,
              total: keys.length,
              durationMs: 10_000,
              finishedAtMs: 10_000,
              bonusesSent: 0,
              bonusesReceived: 0,
              bonusLog: [],
              overlay: s.overlay ?? undefined,
              suspicious: s.suspicious ?? false,
              engineVersion: "0.1.0",
              createdAt: s.createdAt ?? new Date("2026-11-17T03:00:00Z"),
            },
          },
          keystrokes: {
            create: {
              desk: 1,
              userId: s.userId,
              data: s.data ?? gzipSync(JSON.stringify(keys)),
              count: keys.length,
              createdAt: s.keysAt ?? new Date("2026-11-17T03:00:01Z"),
            },
          },
        },
      });
      return raceId;
    };

    const run = (limit?: number) => {
      const lines: { msg: string; fields?: Record<string, unknown> }[] = [];
      const log = {
        info: (msg: string, fields?: Record<string, unknown>) => void lines.push({ msg, fields }),
        error: (msg: string, fields?: Record<string, unknown>) => void lines.push({ msg, fields }),
      };
      return rollupKeystrokes(
        { db, now: NOW, log: log as JobContext["log"] },
        { limit, only: { userId: { in: users } } },
      ).then(() => lines);
    };

    const chars = (userId: string) =>
      db.charStatDaily.findMany({
        where: { userId },
        orderBy: [{ day: "asc" }, { char: "asc" }, { layout: "asc" }],
      });
    const pairs = (userId: string) =>
      db.bigramStatDaily.findMany({ where: { userId }, orderBy: [{ day: "asc" }, { pair: "asc" }] });
    const marked = async (raceId: string) =>
      (await db.raceKeystrokes.findFirstOrThrow({ where: { raceId } })).rolledUpAt;

    beforeEach(async () => {
      await cleanup();
      users = [];
    });

    afterAll(async () => {
      await cleanup();
      await db.$disconnect();
    });

    it("C2 one stored race gives the expected rows on the Toronto stats day, layout CSA by default", async () => {
      const u = await user();
      const raceId = await stored({ userId: u, text: "Le le" });
      await run();

      const rows = await chars(u);
      // 2026-11-17T03:00Z is still 2026-11-16 in Toronto
      expect(rows.map((r) => r.day.toISOString().slice(0, 10))).toEqual([
        "2026-11-16",
        "2026-11-16",
        "2026-11-16",
      ]);
      expect(rows.map(({ char, layout, hits, errors, timedHits, totalMs }) => ({
        char,
        layout,
        hits,
        errors,
        timedHits,
        totalMs,
      }))).toEqual([
        { char: " ", layout: "CSA", hits: 1, errors: 0, timedHits: 1, totalMs: 100 },
        { char: "e", layout: "CSA", hits: 2, errors: 0, timedHits: 2, totalMs: 200 },
        { char: "l", layout: "CSA", hits: 2, errors: 0, timedHits: 1, totalMs: 100 },
      ]);
      expect(await marked(raceId)).toEqual(NOW);
    });

    it("C2 uses the typist's saved layout and keeps every character class", async () => {
      const u = await user("US_QWERTY");
      await stored({ userId: u, text: "A1, b!" });
      await run();
      const rows = await chars(u);
      expect(rows.map((r) => r.char).sort()).toEqual([" ", "!", ",", "1", "a", "b"].sort());
      expect(new Set(rows.map((r) => r.layout))).toEqual(new Set(["US_QWERTY"]));
    });

    it("C2 a race with an overlay is replayed on its effective text", async () => {
      const u = await user();
      await stored({
        userId: u,
        text: "le chat",
        keys: typed("le chat zz"),
        overlay: { extra: ["zz"], removed: [] },
      });
      await run();
      const z = (await chars(u)).find((r) => r.char === "z");
      expect(z).toMatchObject({ hits: 2, errors: 0 });
      expect((await pairs(u)).map((p) => p.pair)).toContain("zz");
    });

    it("C3 letter pairs only, lower-cased", async () => {
      const u = await user();
      await stored({ userId: u, text: "Le le, 2a" });
      await run();
      const rows = await pairs(u);
      expect(rows.map(({ pair, hits, timedHits, totalMs }) => ({ pair, hits, timedHits, totalMs })))
        .toEqual([{ pair: "le", hits: 2, timedHits: 2, totalMs: 200 }]);
    });

    it("C4 a second run adds nothing; two traces of one day add up", async () => {
      const u = await user();
      await stored({ userId: u, text: "le" });
      await stored({ userId: u, text: "le", keysAt: new Date("2026-11-17T03:00:05Z") });
      await run();
      const first = { chars: await chars(u), pairs: await pairs(u) };
      expect(first.chars.find((r) => r.char === "e")).toMatchObject({ hits: 2, timedHits: 2 });
      expect(first.pairs).toEqual([expect.objectContaining({ pair: "le", hits: 2 })]);

      const lines = await run();
      expect({ chars: await chars(u), pairs: await pairs(u) }).toEqual(first);
      expect(lines).toEqual([]); // nothing to do: no line
    });

    it("C4 a trace whose write fails stays untouched; the others go on", async () => {
      const bad = await user();
      const good = await user();
      // the write of `bad` overflows an int column: Postgres rejects the transaction
      await db.charStatDaily.create({
        data: {
          userId: bad,
          day: new Date("2026-11-16T00:00:00Z"),
          char: "e",
          layout: "CSA",
          hits: 2_147_483_647,
          errors: 0,
          timedHits: 0,
          totalMs: 0,
        },
      });
      const badRace = await stored({ userId: bad, text: "le" });
      const goodRace = await stored({ userId: good, text: "le" });
      const lines = await run();

      expect(await marked(badRace)).toBeNull();
      expect(await pairs(bad)).toEqual([]);
      expect((await chars(bad)).map((r) => r.char)).toEqual(["e"]);
      expect(await marked(goodRace)).toEqual(NOW);
      expect((await chars(good)).length).toBe(2);
      expect(lines.at(-1)?.fields).toEqual({ rolled: 1, skipped: 0, failed: 1 });
    });

    it("C4 C5 a corrupt blob beside a good one: marked, skipped, no row; the good one rolls up", async () => {
      const u = await user();
      const corrupt = await stored({ userId: u, text: "le", data: Buffer.from("not gzip") });
      const ok = await stored({ userId: u, text: "ab", keysAt: new Date("2026-11-17T03:00:05Z") });
      const lines = await run();
      expect(await marked(corrupt)).toEqual(NOW);
      expect(await marked(ok)).toEqual(NOW);
      expect((await chars(u)).map((r) => r.char)).toEqual(["a", "b"]);
      expect(lines.at(-1)?.fields).toEqual({ rolled: 1, skipped: 1, failed: 0 });
    });

    it("C5 results that do not count are marked and write nothing; one log line, counts only", async () => {
      const u = await user();
      const ids = [
        await stored({ userId: u, text: "le", suspicious: true }),
        await stored({ userId: u, text: "le", isBot: true }),
        await stored({ userId: u, text: "le", endReason: "VOID" }),
        await stored({ userId: u, text: "le", status: "ASLEEP" }),
      ];
      const timedOut = await stored({ userId: u, text: "ab", status: "TIMED_OUT", endReason: "TIMER" });
      const lines = await run();

      for (const id of ids) expect(await marked(id)).toEqual(NOW);
      expect(await marked(timedOut)).toEqual(NOW);
      expect((await chars(u)).map((r) => r.char)).toEqual(["a", "b"]);
      expect(lines).toHaveLength(1);
      expect(lines[0]!.fields).toEqual({ rolled: 1, skipped: 4, failed: 0 });
      const printed = JSON.stringify(lines);
      expect(printed).not.toContain(u);
      expect(printed).not.toContain(PREFIX);
      expect(printed).not.toContain("Typist");
    });

    it("C1 a run takes the oldest unrolled rows first, at most `limit`", async () => {
      const u = await user();
      const newest = await stored({ userId: u, text: "cc", keysAt: new Date("2026-11-17T03:00:09Z") });
      const oldest = await stored({ userId: u, text: "aa", keysAt: new Date("2026-11-17T03:00:01Z") });
      const middle = await stored({ userId: u, text: "bb", keysAt: new Date("2026-11-17T03:00:05Z") });
      await run(2);
      expect(await marked(oldest)).toEqual(NOW);
      expect(await marked(middle)).toEqual(NOW);
      expect(await marked(newest)).toBeNull();
    });
  },
);
