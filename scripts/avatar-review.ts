/**
 * Operator review of avatars (docs/privacy/moderation.md, Avatars; card #64, ADR 0015).
 *
 *   npx tsx scripts/avatar-review.ts <userId> approve|reject [--version=<v>]
 *
 * Runs scripts/db-guard.sh on DATABASE_URL first.
 * - approve: a PENDING avatar becomes APPROVED (files kept). Anything else is refused.
 * - reject: the row is set to REJECTED with no avatarKey first (hidden right away), then every file
 *   of the user under AVATAR_DIR is deleted. Works on PENDING and on reported APPROVED avatars.
 * `--version=<v>` (the `<v>` of the `<v>-256.webp` file the operator looked at) makes the change
 * only if that is still the stored version, so a picture uploaded since is never decided unseen.
 * The update is conditional on the row read, so a concurrent upload makes it fail instead.
 * Prints only `<user id> <APPROVED|REJECTED>` on stdout, never names or file contents.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPrismaClient } from "../src/server/db-client";
import { FsAvatarStore } from "../src/features/identity/avatars/fs-store";

type Db = ReturnType<typeof createPrismaClient>;

export type ReviewDeps = {
  databaseUrl: string | undefined;
  /** Root of the avatar files (AVATAR_DIR, same default as src/env.ts). */
  avatarDir: string;
  /** true when scripts/db-guard.sh accepts the URL. */
  guard: (databaseUrl: string) => boolean;
  connect: (databaseUrl: string) => Db;
  print: (line: string) => void;
  printError: (line: string) => void;
};

const USAGE = "usage: scripts/avatar-review.ts <userId> approve|reject [--version=<v>]";
// Same id shape the avatar store accepts (src/features/identity/avatars/store.ts).
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DECISIONS = ["approve", "reject"] as const;
type Decision = (typeof DECISIONS)[number];

export async function main(argv: readonly string[], deps: ReviewDeps): Promise<number> {
  const flags = argv.filter((a) => a.startsWith("--"));
  const args = argv.filter((a) => !a.startsWith("--"));
  const [userId, decision] = args;
  const versionFlag = flags.find((f) => f.startsWith("--version="));
  const unknownFlags = flags.filter((f) => f !== versionFlag);
  if (args.length !== 2 || !DECISIONS.includes(decision as Decision) || unknownFlags.length) {
    deps.printError(`avatar-review: ${USAGE}`);
    return 2;
  }
  if (!USER_ID.test(userId!)) {
    deps.printError(`avatar-review: not a user id. ${USAGE}`);
    return 2;
  }
  let version: number | undefined;
  if (versionFlag) {
    version = Number(versionFlag.slice("--version=".length));
    if (!Number.isSafeInteger(version) || version <= 0) {
      deps.printError(`avatar-review: --version must be a positive integer. ${USAGE}`);
      return 2;
    }
  }
  if (!deps.databaseUrl) {
    deps.printError("avatar-review: DATABASE_URL is not set");
    return 2;
  }
  if (!deps.guard(deps.databaseUrl)) return 1;

  const db = deps.connect(deps.databaseUrl);
  try {
    const row = await db.user.findUnique({
      where: { id: userId },
      select: { avatarKey: true, avatarStatus: true },
    });
    if (!row) {
      deps.printError("avatar-review: no account has this id");
      return 1;
    }
    if (version !== undefined && row.avatarKey !== `${userId}/${version}`) {
      deps.printError("avatar-review: the stored picture is not that version; look again");
      return 1;
    }
    // Conditional on what was read: a picture uploaded meanwhile makes the update match nothing.
    const where = { id: userId!, avatarKey: row.avatarKey, avatarStatus: row.avatarStatus };

    if (decision === "approve") {
      if (row.avatarStatus !== "PENDING" || row.avatarKey === null) {
        deps.printError("avatar-review: the avatar is not pending; nothing to approve");
        return 1;
      }
      const { count } = await db.user.updateMany({ where, data: { avatarStatus: "APPROVED" } });
      if (count !== 1) return changed(deps);
      deps.print(`${userId} APPROVED`);
      return 0;
    }

    if (row.avatarKey === null) {
      deps.printError("avatar-review: the account has no stored avatar; nothing to reject");
      return 1;
    }
    // Hide first (row), delete after (files): a crash in between leaves orphans never served.
    const { count } = await db.user.updateMany({
      where,
      data: { avatarStatus: "REJECTED", avatarKey: null },
    });
    if (count !== 1) return changed(deps);
    await new FsAvatarStore(deps.avatarDir).delete(userId!);
    deps.print(`${userId} REJECTED`);
    return 0;
  } finally {
    await db.$disconnect();
  }
}

function changed(deps: ReviewDeps): number {
  deps.printError("avatar-review: the avatar changed while reviewing; look again");
  return 1;
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
    avatarDir: process.env.AVATAR_DIR || ".data/avatars",
    guard: runGuard,
    connect: createPrismaClient,
    print: (line) => console.log(line),
    printError: (line) => console.error(line),
  }).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`avatar-review: failed (${error instanceof Error ? error.name : "error"})`);
      process.exit(1);
    },
  );
}
