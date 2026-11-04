/**
 * Text corpus import (#346, ARCHITECTURE 8.2 `importCorpus`): loads the attributed content files into
 * the `Text` table, so an operator adds texts (teacher submissions) with an import instead of a deploy.
 *
 *   npx tsx scripts/import-texts.ts [--validate] [--dir <content dir>]
 *
 * Reads every `<dir>/{fr,en}/*.json` through the #351 schema (`parseContentFile`): one refused file
 * (no `source`, no `licence`, a passage that is not typeable...) exits 1 naming it, before anything is
 * written. Each passage goes through the engine's `normalizeTypeable` (ADR 0007), is counted with
 * `wordCount` and upserted by `contentHash` (sha256 of the content): a second run adds no row.
 * `--validate` checks the files and touches no database. Otherwise runs scripts/db-guard.sh on
 * DATABASE_URL first. `prisma/seed.ts` calls `importCorpus` so `npx prisma db seed` fills the dev DB.
 * Default dir: the committed corpus (src/features/texts/corpus/content).
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { normalizeTypeable, wordCount } from "@fifth-copy/engine";
import { raceLanguageSchema } from "@fifth-copy/protocol";
import { parseContentFile } from "../src/features/texts/corpus/files";
import type { ContentFile } from "../src/features/texts/corpus/schema";
import type { Prisma, RaceLanguage, TextAuthor } from "../src/generated/prisma/client";
import { createPrismaClient } from "../src/server/db-client";

type Db = ReturnType<typeof createPrismaClient>;
/** What the import writes through: the app client or a transaction client. */
export type TextDb = Pick<Prisma.TransactionClient, "text">;

export const CONTENT_DIR = fileURLToPath(
  new URL("../src/features/texts/corpus/content", import.meta.url),
);

const TO_DB_LANGUAGE: Record<ContentFile["language"], RaceLanguage> = { fr: "FR", en: "EN" };
const TO_DB_AUTHOR: Record<ContentFile["authorType"], TextAuthor> = {
  "public-domain": "PUBLIC_DOMAIN",
  teacher: "TEACHER",
};

export type TextRow = {
  language: RaceLanguage;
  content: string;
  contentHash: string;
  wordCount: number;
  source: string;
  licence: string;
  authorType: TextAuthor;
};

export const contentHashOf = (content: string) =>
  createHash("sha256").update(content, "utf8").digest("hex");

/**
 * Reads and checks every content file of `dir` (`<language>/<file>.json`); throws naming the first
 * refused file. Returns the passages as rows, one per distinct content.
 */
export function readCorpus(dir: string): { files: number; rows: TextRow[] } {
  const rows = new Map<string, TextRow>();
  let files = 0;
  for (const language of raceLanguageSchema.options) {
    let names: string[];
    try {
      names = readdirSync(path.join(dir, language))
        .filter((n) => n.endsWith(".json"))
        .sort();
    } catch {
      continue; // no folder for this language
    }
    for (const fileName of names) {
      const name = `${language}/${fileName}`;
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
      } catch (error) {
        throw new Error(
          `${name}: not valid JSON (${error instanceof Error ? error.name : "error"})`,
        );
      }
      const file = parseContentFile(name, raw);
      files++;
      for (const passage of file.passages) {
        const content = normalizeTypeable(passage.normalize("NFC"));
        const contentHash = contentHashOf(content);
        if (rows.has(contentHash)) continue;
        rows.set(contentHash, {
          language: TO_DB_LANGUAGE[file.language],
          content,
          contentHash,
          wordCount: wordCount(content),
          source: file.source,
          licence: file.licence,
          authorType: TO_DB_AUTHOR[file.authorType],
        });
      }
    }
  }
  return { files, rows: [...rows.values()] };
}

/** Upserts `rows` by `contentHash` (attribution refreshed, content unchanged). Idempotent. */
export async function importTexts(db: TextDb, rows: readonly TextRow[]) {
  const existing = new Set(
    (
      await db.text.findMany({
        where: { contentHash: { in: rows.map((r) => r.contentHash) } },
        select: { contentHash: true },
      })
    ).map((r) => r.contentHash),
  );
  for (const row of rows) {
    await db.text.upsert({
      where: { contentHash: row.contentHash },
      create: row,
      update: { source: row.source, licence: row.licence, authorType: row.authorType },
    });
  }
  return { created: rows.filter((r) => !existing.has(r.contentHash)).length, total: rows.length };
}

/** The whole import of `dir` (default: the committed corpus): read, check, upsert. */
export async function importCorpus(db: TextDb, dir: string = CONTENT_DIR) {
  const { files, rows } = readCorpus(dir);
  return { files, ...(await importTexts(db, rows)) };
}

export type ImportTextsDeps = {
  databaseUrl: string | undefined;
  /** true when scripts/db-guard.sh accepts the URL. */
  guard: (databaseUrl: string) => boolean;
  connect: (databaseUrl: string) => Db;
  print: (line: string) => void;
  printError: (line: string) => void;
};

const USAGE = "usage: scripts/import-texts.ts [--validate] [--dir <content dir>]";

function parseArgs(argv: readonly string[]): { validate: boolean; dir: string } | null {
  let validate = false;
  let dir = CONTENT_DIR;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--validate") validate = true;
    else if (arg === "--dir" && argv[i + 1]) dir = path.resolve(argv[++i]!);
    else return null;
  }
  return { validate, dir };
}

export async function main(argv: readonly string[], deps: ImportTextsDeps): Promise<number> {
  const args = parseArgs(argv);
  if (!args) {
    deps.printError(`import-texts: unknown argument. ${USAGE}`);
    return 2;
  }
  let corpus: ReturnType<typeof readCorpus>;
  try {
    corpus = readCorpus(args.dir);
  } catch (error) {
    deps.printError(
      `import-texts: refused, nothing written. ${error instanceof Error ? error.message : error}`,
    );
    return 1;
  }
  const summary = `${corpus.files} files, ${corpus.rows.length} passages`;
  if (args.validate) {
    deps.print(`import-texts: ok (${summary}, validate only)`);
    return 0;
  }
  if (!deps.databaseUrl) {
    deps.printError("import-texts: DATABASE_URL is not set");
    return 2;
  }
  if (!deps.guard(deps.databaseUrl)) return 1;

  const db = deps.connect(deps.databaseUrl);
  try {
    const { created } = await importTexts(db, corpus.rows);
    deps.print(`import-texts: ok (${summary}, ${created} new)`);
    return 0;
  } finally {
    await db.$disconnect();
  }
}

/** Runs the shell guard; its "ok" line is dropped so stdout carries only the result. */
function runGuard(databaseUrl: string): boolean {
  const guard = fileURLToPath(new URL("./db-guard.sh", import.meta.url));
  const r = spawnSync(guard, [databaseUrl], { stdio: ["ignore", "ignore", "inherit"] });
  return r.status === 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), {
    databaseUrl: process.env.DATABASE_URL,
    guard: runGuard,
    connect: createPrismaClient,
    print: (line) => console.log(line),
    printError: (line) => console.error(line),
  }).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`import-texts: failed (${error instanceof Error ? error.name : "error"})`);
      process.exit(1);
    },
  );
}
