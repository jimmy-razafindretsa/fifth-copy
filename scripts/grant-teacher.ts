/**
 * Owner script (#788, owner decision 2026-11-04): flags an account as a teacher, so it may issue
 * password reset codes from its lobbies. The only writer of `User.isTeacher`: no action or route sets it.
 *
 *   npx tsx scripts/grant-teacher.ts <username>
 *
 * Runs scripts/db-guard.sh on DATABASE_URL, then looks the username up (case-insensitive, as
 * sign-in does). Refuses guests and unknown names. Prints only `<user id> teacher` on stdout; never
 * the URL, a hash or any other column.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPrismaClient } from "../src/server/db-client";
import { normalizeUsername } from "../src/features/identity/schema";

type Db = ReturnType<typeof createPrismaClient>;

export type GrantTeacherDeps = {
  databaseUrl: string | undefined;
  /** true when scripts/db-guard.sh accepts the URL. */
  guard: (databaseUrl: string) => boolean;
  connect: (databaseUrl: string) => Db;
  print: (line: string) => void;
  printError: (line: string) => void;
};

const USAGE = "usage: scripts/grant-teacher.ts <username>";

export async function main(argv: readonly string[], deps: GrantTeacherDeps): Promise<number> {
  const username = argv.length === 1 ? normalizeUsername(argv[0]!) : "";
  if (!username) {
    deps.printError(`grant-teacher: give exactly one username. ${USAGE}`);
    return 2;
  }
  if (!deps.databaseUrl) {
    deps.printError("grant-teacher: DATABASE_URL is not set");
    return 2;
  }
  if (!deps.guard(deps.databaseUrl)) return 1;

  const db = deps.connect(deps.databaseUrl);
  try {
    const user = await db.user.findUnique({
      where: { usernameNormalized: username },
      select: { id: true, isGuest: true },
    });
    if (!user) {
      deps.printError("grant-teacher: no account has this username");
      return 1;
    }
    if (user.isGuest) {
      deps.printError("grant-teacher: refusing a guest account");
      return 1;
    }
    await db.user.update({ where: { id: user.id }, data: { isTeacher: true } });
    deps.print(`${user.id} teacher`);
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
      console.error(`grant-teacher: failed (${error instanceof Error ? error.name : "error"})`);
      process.exit(1);
    },
  );
}
