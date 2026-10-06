import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AVATAR_SIZES,
  InvalidAvatarKeyError,
  assertUserId,
  avatarFileName,
  type AvatarFiles,
  type AvatarSize,
  type AvatarStore,
} from "./store";

const isMissing = (error: unknown) =>
  (error as NodeJS.ErrnoException | null)?.code === "ENOENT" ||
  (error as NodeJS.ErrnoException | null)?.code === "ENOTDIR";

/**
 * Avatar files on local disk (ADR 0014): `<root>/<userId>/<version>-<size>.webp`. The root is
 * created on first write. Every path is built from validated ids and must resolve inside the root
 * (defense in depth); writes go to a temp file then `rename`, so readers never see half a file.
 */
export class FsAvatarStore implements AvatarStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  async put(userId: string, version: number, files: AvatarFiles): Promise<void> {
    const names = AVATAR_SIZES.map((size) => [size, avatarFileName(version, size)] as const);
    const dir = this.userDir(userId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    for (const [size, name] of names) {
      const target = this.inside(dir, name);
      const temp = this.inside(dir, `.${name}.${randomBytes(6).toString("hex")}.tmp`);
      try {
        await writeFile(temp, files[size], { mode: 0o600, flag: "wx" });
        await rename(temp, target);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
    }
  }

  async get(userId: string, version: number, size: AvatarSize): Promise<Buffer | null> {
    const file = this.inside(this.userDir(userId), avatarFileName(version, size));
    try {
      // Symlinks are never created by us; refuse anything whose real path leaves the real root.
      const [realFile, realRoot] = await Promise.all([realpath(file), realpath(this.root)]);
      if (!realFile.startsWith(realRoot + path.sep)) return null;
      return await readFile(realFile);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async delete(userId: string, options: { keep?: number } = {}): Promise<void> {
    const dir = this.userDir(userId);
    if (options.keep === undefined) {
      await rm(dir, { recursive: true, force: true });
      return;
    }
    const kept = new Set(AVATAR_SIZES.map((size) => avatarFileName(options.keep!, size)));
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    await Promise.all(
      entries
        .filter((name) => !kept.has(name))
        .map((name) => rm(this.inside(dir, name), { recursive: true, force: true })),
    );
  }

  private userDir(userId: string): string {
    assertUserId(userId);
    return this.inside(this.root, userId);
  }

  private inside(parent: string, name: string): string {
    const resolved = path.resolve(parent, name);
    if (path.dirname(resolved) !== parent || !resolved.startsWith(this.root + path.sep)) {
      throw new InvalidAvatarKeyError();
    }
    return resolved;
  }
}
