// Avatar storage port (ADR 0014). The filesystem implementation is fs-store.ts; an object store
// can replace it without touching callers. Ids are validated here, never taken from user input.
export const AVATAR_SIZES = [256, 64] as const;
export type AvatarSize = (typeof AVATAR_SIZES)[number];
export type AvatarFiles = Record<AvatarSize, Buffer>;

export interface AvatarStore {
  /** Writes both sizes of one version (atomic per file). */
  put(userId: string, version: number, files: AvatarFiles): Promise<void>;
  /** The bytes of one size of one version, or null when absent. */
  get(userId: string, version: number, size: AvatarSize): Promise<Buffer | null>;
  /** Removes every file of the user, or every version but `keep`. */
  delete(userId: string, options?: { keep?: number }): Promise<void>;
}

// cuid()s and test ids: letters, digits, `_` and `-`; no dots, slashes or NUL, so no traversal.
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

export class InvalidAvatarKeyError extends Error {
  constructor() {
    super("Invalid avatar key");
  }
  override get name() {
    return "InvalidAvatarKeyError";
  }
}

export function assertUserId(userId: string): void {
  if (!USER_ID.test(userId)) throw new InvalidAvatarKeyError();
}

export function assertVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version <= 0) throw new InvalidAvatarKeyError();
}

export function assertSize(size: number): asserts size is AvatarSize {
  if (!(AVATAR_SIZES as readonly number[]).includes(size)) throw new InvalidAvatarKeyError();
}

/** `User.avatarKey`: `<userId>/<version>`. */
export function avatarKey(userId: string, version: number): string {
  assertUserId(userId);
  assertVersion(version);
  return `${userId}/${version}`;
}

/** File name of one size of one version inside the user's directory. */
export function avatarFileName(version: number, size: AvatarSize): string {
  assertVersion(version);
  assertSize(size);
  return `${version}-${size}.webp`;
}
