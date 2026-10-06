import { mkdtemp, readdir, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FsAvatarStore } from "./fs-store";
import { avatarKey } from "./store";

const files = (tag: string) => ({ 256: Buffer.from(`${tag}-256`), 64: Buffer.from(`${tag}-64`) });

describe("FsAvatarStore (temp dir)", () => {
  let base: string;
  let root: string;
  let store: FsAvatarStore;

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), "fc-avatars-"));
    root = path.join(base, "not", "yet", "created");
    store = new FsAvatarStore(root);
  });
  afterEach(() => rm(base, { recursive: true, force: true }));

  it("C6: creates the root on first write and stores <userId>/<version>-<size>.webp", async () => {
    await store.put("user1", 1700000000000, files("a"));
    expect((await readdir(path.join(root, "user1"))).sort()).toEqual([
      "1700000000000-256.webp",
      "1700000000000-64.webp",
    ]);
    expect(await store.get("user1", 1700000000000, 256)).toEqual(Buffer.from("a-256"));
    expect(await store.get("user1", 1700000000000, 64)).toEqual(Buffer.from("a-64"));
    expect(avatarKey("user1", 1700000000000)).toBe("user1/1700000000000");
  });

  it("C6: the user directory is private to the process owner", async () => {
    await store.put("user1", 1, files("a"));
    expect((await stat(path.join(root, "user1"))).mode & 0o077).toBe(0);
  });

  it("C6: get returns null for a missing user, version or size", async () => {
    await store.put("user1", 1, files("a"));
    expect(await store.get("nobody", 1, 64)).toBeNull();
    expect(await store.get("user1", 2, 64)).toBeNull();
  });

  it("C6: writes leave no temp files behind", async () => {
    await store.put("user1", 1, files("a"));
    await store.put("user1", 1, files("b")); // overwrite in place via rename
    expect((await readdir(path.join(root, "user1"))).sort()).toEqual(["1-256.webp", "1-64.webp"]);
    expect(await store.get("user1", 1, 256)).toEqual(Buffer.from("b-256"));
  });

  it("C4: delete with keep removes every other version and stray files of that user only", async () => {
    await store.put("user1", 1, files("old"));
    await store.put("user1", 2, files("new"));
    await store.put("user2", 1, files("other"));
    await writeFile(path.join(root, "user1", ".1-256.webp.dead.tmp"), "x");
    await store.delete("user1", { keep: 2 });
    expect((await readdir(path.join(root, "user1"))).sort()).toEqual(["2-256.webp", "2-64.webp"]);
    expect(await store.get("user2", 1, 64)).toEqual(Buffer.from("other-64"));
  });

  it("C4: delete with version removes only that version", async () => {
    await store.put("user1", 1, files("old"));
    await store.put("user1", 2, files("new"));
    await store.delete("user1", { version: 2 });
    expect((await readdir(path.join(root, "user1"))).sort()).toEqual(["1-256.webp", "1-64.webp"]);
  });

  it("C6: delete without keep removes the whole user directory; deleting nothing is fine", async () => {
    await store.put("user1", 1, files("a"));
    await store.delete("user1");
    await expect(stat(path.join(root, "user1"))).rejects.toThrow();
    await expect(store.delete("user1")).resolves.toBeUndefined();
    await expect(store.delete("never-seen", { keep: 3 })).resolves.toBeUndefined();
  });

  it.each([
    "../escape",
    "..",
    ".",
    "a/b",
    "a\\b",
    "",
    "user\u0000",
    "x".repeat(65),
    "/etc",
    "%2e%2e",
  ])("C6: rejects the unsafe user id %j before touching the disk", async (userId) => {
    await expect(store.put(userId, 1, files("a"))).rejects.toThrow(/avatar/i);
    await expect(store.get(userId, 1, 64)).rejects.toThrow(/avatar/i);
    await expect(store.delete(userId)).rejects.toThrow(/avatar/i);
    await expect(readdir(base)).resolves.toEqual([]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2])(
    "C6: rejects the invalid version %s",
    async (version) => {
      await expect(store.put("user1", version, files("a"))).rejects.toThrow(/avatar/i);
      await expect(store.get("user1", version, 64)).rejects.toThrow(/avatar/i);
    },
  );

  it("C6: rejects a size other than 64 or 256", async () => {
    await expect(store.get("user1", 1, 128 as 64)).rejects.toThrow(/avatar/i);
  });

  it("C6: a symlinked user directory pointing outside the root is not followed for reads", async () => {
    const outside = path.join(base, "outside");
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "1-64.webp"), "secret");
    await mkdir(root, { recursive: true });
    const { symlink } = await import("node:fs/promises");
    await symlink(outside, path.join(root, "linked"));
    expect(await store.get("linked", 1, 64)).toBeNull();
  });
});
