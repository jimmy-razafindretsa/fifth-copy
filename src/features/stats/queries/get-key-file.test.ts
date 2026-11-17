import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addDays } from "@/lib/time";
import { createPrismaClient } from "@/server/db-client";
import { emptyKeyFile, KEY_FILE_DAYS, keyFileOf } from "../view/key-file";
import { getKeyFile } from "./get-key-file";

// #961 C5: getKeyFile reads only the viewer's CharStatDaily and BigramStatDaily rows (ADR 0008, 0009),
// in at most three queries whatever the file's length, and never a keystroke table.

describe("getKeyFile: source", () => {
  it("names no keystroke table and starts server-only", () => {
    const source = readFileSync(path.join(__dirname, "get-key-file.ts"), "utf8");
    expect(source.startsWith('import "server-only";')).toBe(true);
    expect(source).not.toMatch(/raceKeystrokes/i);
  });

  it("is exported through the stats index", () => {
    const index = readFileSync(path.join(__dirname, "..", "index.ts"), "utf8");
    expect(index).toContain('export { getKeyFile } from "./queries/get-key-file";');
  });

  it("a null viewer gets the empty file without a query", async () => {
    const db = new Proxy({} as never, {
      get: () => {
        throw new Error("no query expected");
      },
    });
    expect(await getKeyFile(null, { db })).toEqual(emptyKeyFile());
  });
});

// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const date = (key: string) => new Date(`${key}T00:00:00.000Z`);
const START = "2026-08-01";

describe.skipIf(!testDatabaseUrl)("getKeyFile (needs TEST_DATABASE_URL)", () => {
  const prisma = createPrismaClient(testDatabaseUrl ?? "postgresql://unused");
  const PREFIX = "test-key-file-";
  let me: string;
  let other: string;

  /** The test client behind a counter: only the two stats delegates exist; any other access throws. */
  function counted() {
    const calls: string[] = [];
    const wrap = <T extends object>(name: string, delegate: T): T =>
      new Proxy(delegate, {
        get(target, op: string) {
          const fn = Reflect.get(target, op) as (...a: unknown[]) => unknown;
          return (...args: unknown[]) => {
            calls.push(`${name}.${op}`);
            return fn.apply(target, args);
          };
        },
      });
    const db = new Proxy({} as never, {
      get(_, prop: string) {
        if (prop === "charStatDaily") return wrap(prop, prisma.charStatDaily);
        if (prop === "bigramStatDaily") return wrap(prop, prisma.bigramStatDaily);
        if (prop === "then") return undefined;
        throw new Error(`unexpected access to ${prop}`);
      },
    });
    return { db, calls };
  }

  const cleanup = () => prisma.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });

  beforeEach(async () => {
    await cleanup();
    const stamp = Date.now();
    me = (await prisma.user.create({ data: { typistName: `${PREFIX}me-${stamp}` } })).id;
    other = (await prisma.user.create({ data: { typistName: `${PREFIX}other-${stamp}` } })).id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("a viewer with no row gets the empty file", async () => {
    const { db, calls } = counted();
    expect(await getKeyFile({ id: me }, { db })).toEqual(emptyKeyFile());
    expect(calls.length).toBeLessThanOrEqual(3);
  });

  it("only the viewer's rows, the 40 latest days, in at most three queries", async () => {
    const days = Array.from({ length: KEY_FILE_DAYS + 5 }, (_, i) => addDays(START, i));
    const counts = { hits: 10, errors: 1, timedHits: 9, totalMs: 2_700 };
    await prisma.charStatDaily.createMany({
      data: days.flatMap((d) => [
        { userId: me, day: date(d), char: "a", layout: "FR_CA" as const, ...counts },
        { userId: me, day: date(d), char: "a", layout: "CSA" as const, ...counts },
        { userId: me, day: date(d), char: "é", layout: "FR_CA" as const, ...counts },
      ]),
    });
    await prisma.bigramStatDaily.createMany({
      data: days.map((d) => ({ userId: me, day: date(d), pair: "qu", ...counts })),
    });
    // another typist, on the same days and a later one: never read
    await prisma.charStatDaily.createMany({
      data: [...days, addDays(START, 99)].map((d) => ({
        userId: other,
        day: date(d),
        char: "z",
        layout: "FR_CA" as const,
        hits: 500,
        errors: 0,
        timedHits: 500,
        totalMs: 50_000,
      })),
    });
    await prisma.bigramStatDaily.create({
      data: { userId: other, day: date(days[0]!), pair: "zz", ...counts, hits: 900 },
    });

    const { db, calls } = counted();
    const file = await getKeyFile({ id: me }, { db });
    expect(calls.length).toBeLessThanOrEqual(3);

    const window = days.slice(-KEY_FILE_DAYS);
    expect(file.days).toEqual(window);
    expect(file.byChar.z).toBeUndefined();
    expect(file.keys.find((k) => k.char === "z")!.hits).toBe(0);
    expect(file.keys.find((k) => k.char === "a")!.hits).toBe(20 * KEY_FILE_DAYS);
    expect(file.pairs.map((p) => p.pair)).toEqual(["qu"]);
    // the pair rows read are those of the window only
    expect(file).toEqual(
      keyFileOf(
        window.flatMap((d) => [
          { day: d, char: "a", ...counts },
          { day: d, char: "a", ...counts },
          { day: d, char: "é", ...counts },
        ]),
        window.map(() => ({ pair: "qu", ...counts })),
      ),
    );
  });

  it("the query count does not grow with the file", async () => {
    const counts = { hits: 4, errors: 0, timedHits: 4, totalMs: 1_200 };
    await prisma.charStatDaily.create({
      data: { userId: me, day: date(START), char: "b", layout: "FR_CA", ...counts },
    });
    const small = counted();
    await getKeyFile({ id: me }, { db: small.db });
    await prisma.charStatDaily.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        userId: me,
        day: date(addDays(START, i + 1)),
        char: "b",
        layout: "FR_CA" as const,
        ...counts,
      })),
    });
    const large = counted();
    await getKeyFile({ id: me }, { db: large.db });
    expect(large.calls).toEqual(small.calls);
    expect(large.calls.length).toBeLessThanOrEqual(3);
  });
});
