import "dotenv/config";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "../src/server/db-client";
import { CONTENT_FILES } from "../src/features/texts/corpus/manifest";
import {
  CONTENT_DIR,
  contentHashOf,
  importTexts,
  main,
  readCorpus,
  type ImportTextsDeps,
} from "./import-texts";

// #346 C3: the licence-checked, idempotent import of the content files into `Text`.
// ADR 0003: DB-backed tests target the test database. The writes run inside a transaction that is
// rolled back, so parallel test files (startRace) keep seeing an empty `Text` table.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const PASSAGE =
  "The quick brown fox jumps over the lazy dog while the farmer watches from the old wooden gate.";
const valid = {
  language: "en",
  source: "Test Author, A Test Work (1850)",
  licence: "public domain",
  authorType: "public-domain",
  reviewed: "2026-11-03",
  passages: [PASSAGE],
};

let root: string;
function corpusDir(files: Record<string, unknown>): string {
  const dir = mkdtempSync(path.join(root, "corpus-"));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.join(dir, path.dirname(name)), { recursive: true });
    writeFileSync(path.join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
  }
  return dir;
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "import-texts-"));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

type Io = { out: string[]; err: string[] };
function deps(overrides: Partial<ImportTextsDeps> = {}): ImportTextsDeps & Io {
  const io: Io = { out: [], err: [] };
  return {
    ...io,
    databaseUrl: "postgresql://u:hunter2@localhost:5432/app",
    guard: vi.fn(() => true),
    connect: vi.fn(() => {
      throw new Error("must not connect");
    }),
    print: (line: string) => void io.out.push(line),
    printError: (line: string) => void io.err.push(line),
    ...overrides,
  };
}

describe("readCorpus", () => {
  it("reads every committed content file through the #351 schema", () => {
    const { files, rows } = readCorpus(CONTENT_DIR);
    expect(files).toBe(CONTENT_FILES.length);
    const passages = CONTENT_FILES.reduce(
      (n, [, raw]) => n + (raw as { passages: unknown[] }).passages.length,
      0,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(passages);
    expect(new Set(rows.map((r) => r.contentHash)).size).toBe(rows.length);
    for (const r of rows.slice(0, 5)) {
      expect(r.contentHash).toBe(contentHashOf(r.content));
      expect(r.content.normalize("NFC")).toBe(r.content);
      expect(r.source.length).toBeGreaterThan(0);
    }
  });

  it("normalises with normalizeTypeable, counts engine words and maps the enums", () => {
    const dir = corpusDir({
      "fr/teacher.json": {
        ...valid,
        language: "fr",
        authorType: "teacher",
        licence: "teacher-written",
        source: "teacher-written",
        passages: [
          `Le chat dort sur le mur et le chien “regarde” les oiseaux qui chantent dans le grand jardin.`,
        ],
      },
    });
    // Curly quotes are refused by the schema (not typeable as written): the file is refused.
    expect(() => readCorpus(dir)).toThrow(/fr\/teacher\.json/);
    const ok = corpusDir({
      "fr/teacher.json": {
        ...valid,
        language: "fr",
        authorType: "teacher",
        licence: "teacher-written",
        source: "teacher-written",
        passages: [
          "Le chat dort sur le mur et le chien regarde les oiseaux qui chantent dans le jardin.",
        ],
      },
    });
    const [row] = readCorpus(ok).rows;
    expect(row).toMatchObject({ language: "FR", authorType: "TEACHER", wordCount: 17 });
  });

  it("refuses a file without source or licence, naming the file", () => {
    for (const missing of ["source", "licence"] as const) {
      const bad: Record<string, unknown> = { ...valid };
      delete bad[missing];
      const dir = corpusDir({ "en/good.json": valid, "en/bad.json": bad });
      expect(() => readCorpus(dir)).toThrow(new RegExp(`en/bad\\.json.*${missing}`));
    }
    expect(() => readCorpus(corpusDir({ "en/empty.json": { ...valid, licence: "  " } }))).toThrow(
      /en\/empty\.json/,
    );
    expect(() => readCorpus(corpusDir({ "en/broken.json": "{ not json" }))).toThrow(
      /en\/broken\.json/,
    );
  });
});

describe("import-texts CLI", () => {
  it("--validate checks the files and never touches the database", async () => {
    const d = deps({ databaseUrl: undefined });
    expect(await main(["--validate"], d)).toBe(0);
    expect(d.connect).not.toHaveBeenCalled();
    expect(d.guard).not.toHaveBeenCalled();
    expect(d.out.join("\n")).toMatch(/ok/);
  });

  it("exits 1 naming the bad file, before the guard or any connection", async () => {
    const bad = { ...valid, source: undefined };
    const dir = corpusDir({ "en/good.json": valid, "en/no-source.json": bad });
    for (const argv of [
      ["--dir", dir],
      ["--validate", "--dir", dir],
    ]) {
      const d = deps();
      expect(await main(argv, d)).toBe(1);
      expect(d.err.join("\n")).toMatch(/en\/no-source\.json/);
      expect(d.connect).not.toHaveBeenCalled();
    }
  });

  it("refuses without DATABASE_URL, and stops when the DB guard refuses", async () => {
    const none = deps({ databaseUrl: undefined });
    expect(await main([], none)).toBe(2);
    const refused = deps({ guard: vi.fn(() => false) });
    expect(await main([], refused)).toBe(1);
    expect(refused.connect).not.toHaveBeenCalled();
    expect([...refused.out, ...refused.err].join("\n")).not.toContain("hunter2");
  });

  it("refuses an unknown argument", async () => {
    const d = deps();
    expect(await main(["--wat"], d)).toBe(2);
    expect(d.err.join("\n")).toMatch(/usage/);
  });
});

describe.skipIf(!testDatabaseUrl)("importTexts (needs TEST_DATABASE_URL)", () => {
  let db: ReturnType<typeof createPrismaClient>;
  class Rollback extends Error {}

  beforeAll(() => {
    db = createPrismaClient(testDatabaseUrl!);
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("upserts by contentHash: a second run changes no row count", async () => {
    const { rows } = readCorpus(CONTENT_DIR);
    const outcome = await db
      .$transaction(
        async (tx) => {
          const before = await tx.text.count();
          const first = await importTexts(tx, rows);
          const afterFirst = await tx.text.count();
          const second = await importTexts(tx, rows);
          const afterSecond = await tx.text.count();
          const stored = await tx.text.findUnique({ where: { contentHash: rows[0]!.contentHash } });
          throw new Rollback(
            JSON.stringify({ before, first, afterFirst, second, afterSecond, stored }),
          );
        },
        { timeout: 120_000, maxWait: 30_000 },
      )
      .catch((e: unknown) => {
        if (e instanceof Rollback) return JSON.parse(e.message);
        throw e;
      });
    expect(outcome.afterFirst - outcome.before).toBe(outcome.first.created);
    expect(outcome.first.created).toBeLessThanOrEqual(rows.length);
    expect(outcome.afterSecond).toBe(outcome.afterFirst);
    expect(outcome.second.created).toBe(0);
    expect(outcome.stored).toMatchObject({
      content: rows[0]!.content,
      source: rows[0]!.source,
      licence: rows[0]!.licence,
    });
  });

  it("writes nothing when a file is refused", async () => {
    const before = await db.text.count();
    const dir = corpusDir({
      "en/good.json": valid,
      "en/no-licence.json": { ...valid, licence: "" },
    });
    const d = deps({ databaseUrl: testDatabaseUrl, connect: createPrismaClient });
    expect(await main(["--dir", dir], d)).toBe(1);
    expect(await db.text.count({ where: { contentHash: contentHashOf(PASSAGE) } })).toBe(0);
    expect(await db.text.count()).toBe(before);
  });
});
