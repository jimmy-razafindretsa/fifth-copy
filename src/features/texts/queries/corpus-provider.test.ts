import { beforeEach, describe, expect, it, vi } from "vitest";
import { fileProvider } from "../corpus/files";
import {
  CORPUS_CACHE_MS,
  CORPUS_MIN_ROWS,
  clearCorpusCache,
  loadCorpusProvider,
  type CorpusDb,
} from "./corpus-provider";

// #346 C4: the database-backed TextProvider, cached 5 minutes, falling back to the content files.

type Row = { content: string; source: string; createdAt: Date };
const rowsOf = (n: number, language: "FR" | "EN" = "EN"): (Row & { language: string })[] =>
  Array.from({ length: n }, (_, i) => ({
    language,
    content: `Passage number ${i} is long enough to be typed by every player in the classroom today.`,
    source: `Work ${i}`,
    createdAt: new Date(Date.UTC(2026, 10, 1, 0, i)),
  }));

function fakeDb(rows: (Row & { language: string })[]) {
  const findMany = vi.fn(async ({ where }: { where: { language: string } }) =>
    rows
      .filter((r) => r.language === where.language)
      .map((r) => ({ content: r.content, source: r.source, createdAt: r.createdAt })),
  );
  return { db: { text: { findMany } } as unknown as CorpusDb, findMany };
}

beforeEach(() => clearCorpusCache());

describe("loadCorpusProvider", () => {
  it("serves the rows of the language with sourceRef db:<rows>:<newest createdAt ISO>", async () => {
    const { db } = fakeDb([...rowsOf(CORPUS_MIN_ROWS), ...rowsOf(3, "FR")]);
    const provider = await loadCorpusProvider(db, "en");
    expect(provider.sourceRef("en")).toBe(
      `db:${CORPUS_MIN_ROWS}:${new Date(Date.UTC(2026, 10, 1, 0, CORPUS_MIN_ROWS - 1)).toISOString()}`,
    );
    expect(provider.sentences("en")).toHaveLength(CORPUS_MIN_ROWS);
    expect(provider.sentences("en")[0]).toEqual({
      text: rowsOf(1)[0]!.content,
      source: "Work 0",
    });
    // Words mode keeps the frequency lists of the files; other languages stay on the files.
    expect(provider.words("en")).toBe(fileProvider.words("en"));
    expect(provider.sourceRef("fr")).toBe(fileProvider.sourceRef("fr"));
    expect(provider.sentences("fr")).toBe(fileProvider.sentences("fr"));
  });

  it(`returns the file provider when the language has fewer than ${CORPUS_MIN_ROWS} rows`, async () => {
    const { db } = fakeDb([...rowsOf(CORPUS_MIN_ROWS - 1), ...rowsOf(CORPUS_MIN_ROWS, "FR")]);
    expect(await loadCorpusProvider(db, "en")).toBe(fileProvider);
    expect((await loadCorpusProvider(db, "fr")).sourceRef("fr")).toMatch(/^db:20:/);
    clearCorpusCache();
    expect(await loadCorpusProvider(fakeDb([]).db, "fr")).toBe(fileProvider);
  });

  it("caches per language for 5 minutes, then reloads", async () => {
    const rows = rowsOf(CORPUS_MIN_ROWS);
    const { db, findMany } = fakeDb(rows);
    let t = 1_000_000;
    const now = () => t;
    const first = await loadCorpusProvider(db, "en", { now });
    t += CORPUS_CACHE_MS - 1;
    expect(await loadCorpusProvider(db, "en", { now })).toBe(first);
    expect(findMany).toHaveBeenCalledTimes(1);
    await loadCorpusProvider(db, "fr", { now });
    expect(findMany).toHaveBeenCalledTimes(2);

    rows.push(
      ...rowsOf(1).map((r) => ({
        ...r,
        content: `${r.content} Again.`,
        createdAt: new Date(Date.UTC(2026, 10, 2)),
      })),
    );
    t += 1;
    const reloaded = await loadCorpusProvider(db, "en", { now });
    expect(findMany).toHaveBeenCalledTimes(3);
    expect(reloaded.sourceRef("en")).toBe(`db:${CORPUS_MIN_ROWS + 1}:2026-11-02T00:00:00.000Z`);
  });

  it("does not cache a failed load", async () => {
    const findMany = vi.fn().mockRejectedValueOnce(new Error("db down"));
    const db = { text: { findMany } } as unknown as CorpusDb;
    await expect(loadCorpusProvider(db, "en")).rejects.toThrow("db down");
    findMany.mockResolvedValueOnce([]);
    expect(await loadCorpusProvider(db, "en")).toBe(fileProvider);
  });
});
