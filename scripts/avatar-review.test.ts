import "dotenv/config";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "../src/server/db-client";
import { FsAvatarStore } from "../src/features/identity/avatars/fs-store";
import { main, type ReviewDeps } from "./avatar-review";

// C7 (#64, ADR 0015): operator review of a held avatar, docs/privacy/moderation.md "Avatars".
// ADR 0003: DB-backed tests target the test database, not the app env.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules/.bin/tsx");
const REMOTE = "postgresql://u:hunter2@db.prod.example.com:5432/app";
/** The real-command cases start tsx in a child process: slow on a busy machine. */
const SPAWN_TIMEOUT_MS = 30_000;

type Io = { out: string[]; err: string[] };
function deps(overrides: Partial<ReviewDeps> = {}): ReviewDeps & Io {
  const io: Io = { out: [], err: [] };
  return {
    ...io,
    databaseUrl: "postgresql://u:p@localhost:5432/app",
    avatarDir: "/nonexistent-avatar-dir",
    guard: vi.fn(() => true),
    connect: vi.fn(() => {
      throw new Error("must not connect");
    }),
    print: (line: string) => void io.out.push(line),
    printError: (line: string) => void io.err.push(line),
    ...overrides,
  };
}

describe("avatar-review CLI guards", () => {
  it.each([
    ["no arguments", []],
    ["no decision", ["user1"]],
    ["an unknown decision", ["user1", "delete"]],
    ["too many arguments", ["user1", "approve", "--version=1", "extra"]],
    ["approve without --version", ["user1", "approve"]],
    ["an id with a path in it", ["../etc", "reject"]],
    ["an unknown flag", ["user1", "approve", "--version=1", "--force"]],
    ["a bad --version", ["user1", "approve", "--version=abc"]],
    ["a hex --version", ["user1", "approve", "--version=0x10"]],
    ["an exponent --version", ["user1", "reject", "--version=1e3"]],
    ["a zero --version", ["user1", "reject", "--version=0"]],
  ])("refuses %s before touching the database", async (_label, argv) => {
    const d = deps();
    expect(await main(argv, d)).toBe(2);
    expect(d.guard).not.toHaveBeenCalled();
    expect(d.connect).not.toHaveBeenCalled();
    expect(d.out).toEqual([]);
    expect(d.err.join("\n")).toMatch(/usage|user id/i);
  });

  it("approve names --version as required (decide only the picture looked at)", async () => {
    const d = deps();
    expect(await main(["user1", "approve"], d)).toBe(2);
    expect(d.err.join("\n")).toMatch(/approve needs --version/);
  });

  it("refuses without DATABASE_URL", async () => {
    const d = deps({ databaseUrl: undefined });
    expect(await main(["user1", "approve", "--version=1"], d)).toBe(2);
    expect(d.connect).not.toHaveBeenCalled();
  });

  it("runs db-guard on the target URL and stops when it refuses", async () => {
    const d = deps({ databaseUrl: REMOTE, guard: vi.fn(() => false) });
    expect(await main(["user1", "reject"], d)).not.toBe(0);
    expect(d.guard).toHaveBeenCalledWith(REMOTE);
    expect(d.connect).not.toHaveBeenCalled();
    expect(d.out).toEqual([]);
  });

  it(
    "the real command runs scripts/db-guard.sh and refuses a remote database",
    () => {
      const r = spawnSync(TSX, ["scripts/avatar-review.ts", "user1", "reject"], {
        cwd: ROOT,
        env: {
          NODE_ENV: "test",
          PATH: process.env.PATH ?? "",
          DATABASE_URL: REMOTE,
          DB_GUARD_ALLOWED_HOSTS: "",
        },
        encoding: "utf8",
      });
      expect(r.status).not.toBe(0);
      expect(r.stdout).toBe("");
      expect(r.stderr).toMatch(/db-guard: REFUSED/);
      expect(r.stdout + r.stderr).not.toContain("hunter2");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "the real command prints usage and nothing on stdout without a decision",
    () => {
      const r = spawnSync(TSX, ["scripts/avatar-review.ts", "user1"], {
        cwd: ROOT,
        env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", DATABASE_URL: REMOTE },
        encoding: "utf8",
      });
      expect(r.status).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toMatch(/usage/);
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe.skipIf(!testDatabaseUrl)(
  "avatar-review on the test database (needs TEST_DATABASE_URL, run scripts/test-db.sh)",
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    let dir: string;
    let store: FsAvatarStore;
    const PREFIX = "test-avatar-review-";
    const VERSION = 1_700_000_000_000;
    const ids: string[] = [];

    const cleanup = async () => {
      await db.user.deleteMany({
        where: { OR: [{ typistName: { startsWith: PREFIX } }, { id: { in: ids.splice(0) } }] },
      });
    };
    const run = (argv: string[]) => {
      const d = deps({
        databaseUrl: testDatabaseUrl!,
        avatarDir: dir,
        connect: (url: string) => createPrismaClient(url),
      });
      return main(argv, d).then((code) => ({ code, out: d.out, err: d.err, guard: d.guard }));
    };
    const typist = async (
      suffix: string,
      avatarStatus: "NONE" | "PENDING" | "APPROVED" | "REJECTED",
      withFiles = avatarStatus !== "NONE",
    ) => {
      const user = await db.user.create({
        data: { typistName: `${PREFIX}${suffix}`, avatarStatus },
      });
      ids.push(user.id);
      if (withFiles) {
        await store.put(user.id, VERSION, { 256: Buffer.from("big"), 64: Buffer.from("small") });
        await db.user.update({
          where: { id: user.id },
          data: { avatarKey: `${user.id}/${VERSION}` },
        });
      }
      return user;
    };
    const row = (id: string) =>
      db.user.findUniqueOrThrow({ where: { id }, select: { avatarKey: true, avatarStatus: true } });
    const filesOf = async (id: string) =>
      (await readdir(path.join(dir, id)).catch(() => [] as string[])).sort();

    beforeAll(async () => {
      db = createPrismaClient(testDatabaseUrl!);
      dir = await mkdtemp(path.join(tmpdir(), "fc-avatar-review-"));
      store = new FsAvatarStore(dir);
    });
    beforeEach(cleanup);
    afterAll(async () => {
      await cleanup();
      await db.$disconnect();
      await rm(dir, { recursive: true, force: true });
    });

    it("approve: a PENDING avatar becomes APPROVED, files kept, stdout is id and status only", async () => {
      const u = await typist("approve", "PENDING");
      const r = await run([u.id, "approve", `--version=${VERSION}`]);
      expect(r.code).toBe(0);
      expect(r.guard).toHaveBeenCalledWith(testDatabaseUrl);
      expect(await row(u.id)).toEqual({
        avatarKey: `${u.id}/${VERSION}`,
        avatarStatus: "APPROVED",
      });
      expect(await filesOf(u.id)).toEqual([`${VERSION}-256.webp`, `${VERSION}-64.webp`]);
      expect(r.out).toEqual([`${u.id} APPROVED`]);
      expect(r.out.join("\n") + r.err.join("\n")).not.toContain(PREFIX);
    });

    it.each(["PENDING", "APPROVED"] as const)(
      "reject: a %s avatar's files are deleted, status REJECTED, key cleared",
      async (status) => {
        const u = await typist(`reject-${status}`, status);
        const r = await run([u.id, "reject"]);
        expect(r.code).toBe(0);
        expect(await row(u.id)).toEqual({ avatarKey: null, avatarStatus: "REJECTED" });
        expect(await filesOf(u.id)).toEqual([]);
        expect(r.out).toEqual([`${u.id} REJECTED`]);
      },
    );

    it("reject leaves other users' files alone", async () => {
      const target = await typist("target", "PENDING");
      const other = await typist("other", "APPROVED");
      expect((await run([target.id, "reject"])).code).toBe(0);
      expect(await filesOf(other.id)).toHaveLength(2);
      expect(await row(other.id)).toMatchObject({ avatarStatus: "APPROVED" });
    });

    it.each([
      ["an APPROVED avatar", "APPROVED"],
      ["a REJECTED account", "REJECTED"],
      ["an account with no avatar", "NONE"],
    ] as const)("approve refuses %s and changes nothing", async (_label, status) => {
      const u = await typist(`noop-${status}`, status, status === "APPROVED");
      const before = await row(u.id);
      const r = await run([u.id, "approve", `--version=${VERSION}`]);
      expect(r.code).toBe(1);
      expect(r.out).toEqual([]);
      expect(r.err.join("\n")).toMatch(/not pending/i);
      expect(await row(u.id)).toEqual(before);
    });

    it("reject with no file under AVATAR_DIR: row hidden, exit 1, AVATAR_DIR named, nothing on stdout", async () => {
      const u = await typist("missing-files", "PENDING");
      const elsewhere = await mkdtemp(path.join(tmpdir(), "fc-avatar-review-other-"));
      try {
        const d = deps({
          databaseUrl: testDatabaseUrl!,
          avatarDir: elsewhere,
          connect: (url: string) => createPrismaClient(url),
        });
        expect(await main([u.id, "reject"], d)).toBe(1);
        expect(d.out).toEqual([]);
        expect(d.err.join("\n")).toMatch(/AVATAR_DIR/);
        expect(d.err.join("\n")).not.toContain(elsewhere);
        // Fail safe: the row is hidden anyway; the files under the real dir are untouched.
        expect(await row(u.id)).toEqual({ avatarKey: null, avatarStatus: "REJECTED" });
        expect(await filesOf(u.id)).toHaveLength(2);
      } finally {
        await rm(elsewhere, { recursive: true, force: true });
      }
    });

    it("reject deletes only the version it read: a newer upload's files stay", async () => {
      const u = await typist("only-read-version", "PENDING");
      // Files of a newer version written by a concurrent upload (its row update not yet committed).
      await store.put(u.id, VERSION + 5, { 256: Buffer.from("n"), 64: Buffer.from("n") });
      expect((await run([u.id, "reject"])).code).toBe(0);
      expect(await filesOf(u.id)).toEqual([`${VERSION + 5}-256.webp`, `${VERSION + 5}-64.webp`]);
      expect(await row(u.id)).toEqual({ avatarKey: null, avatarStatus: "REJECTED" });
    });

    it("reject --version refuses a version that is not the stored one", async () => {
      const u = await typist("reject-version", "APPROVED");
      const r = await run([u.id, "reject", `--version=${VERSION + 1}`]);
      expect(r.code).toBe(1);
      expect(await row(u.id)).toMatchObject({ avatarStatus: "APPROVED" });
      expect(await filesOf(u.id)).toHaveLength(2);
    });

    it("reject refuses an account with no avatar", async () => {
      const u = await typist("none", "NONE");
      const r = await run([u.id, "reject"]);
      expect(r.code).toBe(1);
      expect(r.out).toEqual([]);
      expect(await row(u.id)).toEqual({ avatarKey: null, avatarStatus: "NONE" });
    });

    it("--version: approves only the version the operator looked at", async () => {
      const u = await typist("version", "PENDING");
      const stale = await run([u.id, "approve", `--version=${VERSION - 1}`]);
      expect(stale.code).toBe(1);
      expect(stale.err.join("\n")).toMatch(/not that version/);
      expect(await row(u.id)).toMatchObject({ avatarStatus: "PENDING" });
      const r = await run([u.id, "approve", `--version=${VERSION}`]);
      expect(r.code).toBe(0);
      expect(await row(u.id)).toMatchObject({ avatarStatus: "APPROVED" });
    });

    it("an unknown user id is refused", async () => {
      const r = await run(["no-such-user-0000", "approve", `--version=${VERSION}`]);
      expect(r.code).toBe(1);
      expect(r.err.join("\n")).toMatch(/no account/i);
    });
  },
);
