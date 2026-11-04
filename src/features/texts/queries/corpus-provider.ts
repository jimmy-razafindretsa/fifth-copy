import "server-only";
import type { RaceLanguage } from "@fifth-copy/protocol";
import type { PrismaClient, RaceLanguage as DbRaceLanguage } from "@/generated/prisma/client";
import { fileProvider } from "../corpus/files";
import type { SeedSentence, TextProvider } from "../generate/types";

/**
 * The database-backed `TextProvider` (#346): the `Text` rows of one language (loaded by
 * scripts/import-texts.ts), for `sentences` mode. Words mode keeps the frequency lists of the files,
 * and so does every other language. With fewer than `CORPUS_MIN_ROWS` rows the content files serve
 * the language instead (a fresh or test database needs no import). Each load is cached in memory
 * for `CORPUS_CACHE_MS`, per language and per process.
 */

export const CORPUS_MIN_ROWS = 20;
export const CORPUS_CACHE_MS = 5 * 60 * 1000;

export type CorpusDb = { text: Pick<PrismaClient["text"], "findMany"> };

const TO_DB: Record<RaceLanguage, DbRaceLanguage> = { fr: "FR", en: "EN" };

type Entry = { at: number; provider: Promise<TextProvider> };
const cache = new Map<RaceLanguage, Entry>();

/** Drops every cached load (tests, or after an import in the same process). */
export function clearCorpusCache(): void {
  cache.clear();
}

async function load(db: CorpusDb, language: RaceLanguage): Promise<TextProvider> {
  const rows = await db.text.findMany({
    where: { language: TO_DB[language] },
    select: { content: true, source: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (rows.length < CORPUS_MIN_ROWS) return fileProvider;

  const newest = rows.reduce(
    (max, r) => (r.createdAt > max ? r.createdAt : max),
    rows[0]!.createdAt,
  );
  const sentences: readonly SeedSentence[] = rows.map((r) => ({
    text: r.content,
    source: r.source,
  }));
  const ref = `db:${rows.length}:${newest.toISOString()}`;
  return {
    sourceRef: (lang) => (lang === language ? ref : fileProvider.sourceRef(lang)),
    sentences: (lang) => (lang === language ? sentences : fileProvider.sentences(lang)),
    words: fileProvider.words,
  };
}

/** The text provider for `language`: its `Text` rows, or the content files when too few. */
export function loadCorpusProvider(
  db: CorpusDb,
  language: RaceLanguage,
  { now = Date.now }: { now?: () => number } = {},
): Promise<TextProvider> {
  const t = now();
  const hit = cache.get(language);
  if (hit && t - hit.at < CORPUS_CACHE_MS) return hit.provider;

  const provider = load(db, language);
  const entry = { at: t, provider };
  cache.set(language, entry);
  provider.catch(() => {
    if (cache.get(language) === entry) cache.delete(language);
  });
  return provider;
}
