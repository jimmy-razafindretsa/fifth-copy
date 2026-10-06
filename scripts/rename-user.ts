/**
 * Operator moderation script (docs/privacy/moderation.md, Usernames, step 4; card #528).
 *
 *   npx tsx scripts/rename-user.ts <username|typist name|id> --yes
 *
 * Runs scripts/db-guard.sh on DATABASE_URL, then replaces the account's public name with a fresh
 * generated typist name (same generator as guests). An account with a username gets the same new
 * name as its username, so the offensive name is gone everywhere; the student signs in with it.
 * Only the name columns change: the row, stats, history, password and sessions stay.
 * Prints only `<user id> <new name>` on stdout, never the old name.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Prisma } from "../src/generated/prisma/client";
import { createPrismaClient } from "../src/server/db-client";
import { withUniqueTypistName, type Rng } from "../src/features/identity/guest/names";
import { normalizeUsername } from "../src/features/identity/schema";

type Db = ReturnType<typeof createPrismaClient>;

export type RenameDeps = {
  databaseUrl: string | undefined;
  /** true when scripts/db-guard.sh accepts the URL. */
  guard: (databaseUrl: string) => boolean;
  connect: (databaseUrl: string) => Db;
  rng: Rng;
  print: (line: string) => void;
  printError: (line: string) => void;
};

const USAGE = "usage: scripts/rename-user.ts <username|id> --yes";

export async function main(argv: readonly string[], deps: RenameDeps): Promise<number> {
  const targets = argv.filter((a) => !a.startsWith("--"));
  const target = targets[0]?.trim();
  if (!argv.includes("--yes")) {
    deps.printError(`rename-user: refusing without --yes. ${USAGE}`);
    return 2;
  }
  if (!target || targets.length !== 1) {
    deps.printError(`rename-user: give exactly one account. ${USAGE}`);
    return 2;
  }
  if (!deps.databaseUrl) {
    deps.printError("rename-user: DATABASE_URL is not set");
    return 2;
  }
  if (!deps.guard(deps.databaseUrl)) return 1;

  const db = deps.connect(deps.databaseUrl);
  try {
    const matches = await db.user.findMany({
      where: {
        OR: [
          { id: target },
          { typistName: target },
          { usernameNormalized: normalizeUsername(target) },
        ],
      },
      select: { id: true, username: true },
      take: 2,
    });
    if (matches.length === 0) {
      deps.printError("rename-user: no account matches");
      return 1;
    }
    if (matches.length > 1) {
      deps.printError("rename-user: several accounts match; pass the user id");
      return 1;
    }
    const user = matches[0]!;
    const name = await withUniqueTypistName(deps.rng, (candidate) =>
      tryRename(db, user, candidate),
    );
    deps.print(`${user.id} ${name}`);
    return 0;
  } finally {
    await db.$disconnect();
  }
}

// null = the name is already someone's typist name or username, so the caller draws again.
async function tryRename(
  db: Db,
  user: { id: string; username: string | null },
  name: string,
): Promise<string | null> {
  const normalized = normalizeUsername(name);
  const taken = await db.user.findFirst({
    where: {
      id: { not: user.id },
      OR: [{ typistName: name }, { usernameNormalized: normalized }],
    },
    select: { id: true },
  });
  if (taken) return null;
  try {
    await db.user.update({
      where: { id: user.id },
      data:
        user.username === null
          ? { typistName: name }
          : { typistName: name, username: name, usernameNormalized: normalized },
    });
    return name;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return null;
    throw error;
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
    rng: Math.random,
    print: (line) => console.log(line),
    printError: (line) => console.error(line),
  }).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`rename-user: failed (${error instanceof Error ? error.name : "error"})`);
      process.exit(1);
    },
  );
}
