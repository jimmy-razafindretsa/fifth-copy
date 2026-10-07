/**
 * Operator review of avatars (docs/privacy/moderation.md, Avatars; card #64, ADR 0015).
 *
 *   npx tsx scripts/avatar-review.ts <userId> approve --version=<v>
 *   npx tsx scripts/avatar-review.ts <userId> reject [--version=<v>]
 *
 * Runs scripts/db-guard.sh on DATABASE_URL first. Files live under AVATAR_DIR (same variable and
 * default as the app, `.data/avatars` relative to the working directory): run it with the app's.
 * `<v>` is the version of the `<v>-256.webp` file the operator looked at; the change happens only
 * if that is still the stored version, so a picture uploaded since is never decided unseen.
 * - approve (needs --version): a PENDING avatar becomes APPROVED (files kept). Else refused.
 * - reject: the row is set to REJECTED with no avatarKey first (hidden right away), then the files
 *   of the version read are deleted (a newer upload's files are left alone). Works on PENDING and
 *   on reported APPROVED avatars. If no file of that version was found under AVATAR_DIR, the row
 *   stays hidden but the command exits 1 and says so: the files must be found and removed.
 * Updates are conditional on the row read, so a concurrent upload makes them fail instead.
 * Prints only `<user id> <APPROVED|REJECTED>` on stdout, never names or file contents.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPrismaClient } from "../src/server/db-client";
import { FsAvatarStore } from "../src/features/identity/avatars/fs-store";
import { AVATAR_SIZES } from "../src/features/identity/avatars/store";

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

const USAGE =
  "usage: scripts/avatar-review.ts <userId> approve --version=<v> | reject [--version=<v>]";
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
    const raw = versionFlag.slice("--version=".length);
    version = /^[1-9][0-9]{0,15}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(version)) {
      deps.printError(`avatar-review: --version must be a positive integer. ${USAGE}`);
      return 2;
    }
  }
  if (decision === "approve" && version === undefined) {
    deps.printError(
      `avatar-review: approve needs --version=<v> (the file you looked at). ${USAGE}`,
    );
    return 2;
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
    if (decision === "approve" && (row.avatarStatus !== "PENDING" || row.avatarKey === null)) {
      deps.printError("avatar-review: the avatar is not pending; nothing to approve");
      return 1;
    }
    if (decision === "reject" && row.avatarKey === null) {
      deps.printError("avatar-review: the account has no stored avatar; nothing to reject");
      return 1;
    }
    const storedVersion = Number(row.avatarKey!.slice(userId!.length + 1));
    if (row.avatarKey !== `${userId}/${storedVersion}` || !Number.isSafeInteger(storedVersion)) {
      deps.printError("avatar-review: the stored avatar key is malformed; fix it by hand");
      return 1;
    }
    if (version !== undefined && version !== storedVersion) {
      deps.printError("avatar-review: the stored picture is not that version; look again");
      return 1;
    }
    // Conditional on what was read: a picture uploaded meanwhile makes the update match nothing.
    const where = { id: userId!, avatarKey: row.avatarKey, avatarStatus: row.avatarStatus };

    if (decision === "approve") {
      const { count } = await db.user.updateMany({ where, data: { avatarStatus: "APPROVED" } });
      if (count !== 1) return changed(deps);
      deps.print(`${userId} APPROVED`);
      return 0;
    }

    // Hide first (row), delete after (files): a crash in between leaves orphans never served.
    const { count } = await db.user.updateMany({
      where,
      data: { avatarStatus: "REJECTED", avatarKey: null },
    });
    if (count !== 1) return changed(deps);
    // Only the version read: a concurrent upload's newer files (and its row) stay consistent.
    const store = new FsAvatarStore(deps.avatarDir);
    const found = await Promise.all(
      AVATAR_SIZES.map((size) => store.get(userId!, storedVersion, size)),
    );
    await store.delete(userId!, { version: storedVersion });
    if (found.every((file) => file === null)) {
      deps.printError(
        "avatar-review: row set to REJECTED, but no file of that version was found under " +
          "AVATAR_DIR; run again with the app's AVATAR_DIR and delete the files by hand",
      );
      return 1;
    }
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
