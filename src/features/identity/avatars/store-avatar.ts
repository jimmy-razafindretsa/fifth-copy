import sharp, { type SharpOptions } from "sharp";
import { BadCrop, TooLarge, TooSmall, Undecodable, WrongType } from "./errors";
import { sniffImageType } from "./sniff";
import { AVATAR_SIZES, assertUserId, avatarKey, type AvatarFiles, type AvatarStore } from "./store";

// Avatar bytes in, safe stored files out (ADR 0014). Order matters: cheap checks before decoding,
// the decoder bounded by limitInputPixels and pages: 1, nothing written until every check passed.

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const MIN_AVATAR_PX = 64;
/** Decoder pixel budget (decompression-bomb guard): 25 MP, e.g. 5000x5000. */
export const MAX_AVATAR_PIXELS = 25_000_000;
const WEBP_QUALITY = 82;

/** The square the user chose, in pixels of the image as displayed (after EXIF orientation). */
export type Crop = { x: number; y: number; size: number };
/** `"center"`: the largest centered square, resolved on the oriented image (OAuth import, #52). */
export type CropRequest = Crop | "center";

/** Outcome of moderation; mirrors the AvatarStatus values a fresh upload can take. */
export type AvatarVerdict = "APPROVED" | "PENDING" | "REJECTED";
/** Moderation hook point (#64 replaces the default); sees the 256 px output, never the original. */
export type AvatarModerator = (input: { userId: string; image: Buffer }) => Promise<AvatarVerdict>;
export const approveAll: AvatarModerator = async () => "APPROVED";

export type StoredAvatar = { version: number; key: string; status: AvatarVerdict };

export type StoreAvatarOptions = {
  store?: AvatarStore;
  moderator?: AvatarModerator;
  /** Persists the new key (the DB row); runs after the files are written, before old ones go. */
  commit?: (stored: StoredAvatar) => Promise<void>;
  now?: () => number;
  maxPixels?: number;
};

export async function storeAvatar(
  userId: string,
  bytes: Uint8Array,
  request: CropRequest,
  options: StoreAvatarOptions = {},
): Promise<StoredAvatar> {
  assertUserId(userId);
  if (bytes.byteLength > MAX_AVATAR_BYTES) throw new TooLarge();
  const type = sniffImageType(bytes);
  if (!type) throw new WrongType();

  const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const maxPixels = options.maxPixels ?? MAX_AVATAR_PIXELS;
  const decoder: SharpOptions = {
    limitInputPixels: maxPixels,
    pages: 1,
    autoOrient: true,
    failOn: "warning",
  };

  const meta = await decode(() => sharp(input, decoder).metadata());
  // Polyglot defence: the decoder must agree with the magic bytes.
  if (meta.format !== type) throw new WrongType();
  const width = meta.autoOrient?.width ?? meta.width;
  const height = meta.autoOrient?.height ?? meta.height;
  if (!width || !height) throw new Undecodable();
  if (width * height > maxPixels) throw new TooLarge();
  if (width < MIN_AVATAR_PX || height < MIN_AVATAR_PX) throw new TooSmall();
  const crop = request === "center" ? centerSquare(width, height) : request;
  assertCrop(crop, width, height);

  const files = await decode(() => render(input, decoder, crop));
  const status = await (options.moderator ?? approveAll)({ userId, image: files[256] });

  const store = options.store ?? (await import("./default-store")).avatarStore;
  const version = (options.now ?? Date.now)();
  const stored: StoredAvatar = { version, key: avatarKey(userId, version), status };
  await store.put(userId, version, files);
  try {
    await options.commit?.(stored);
  } catch (error) {
    await store.delete(userId, { version }).catch(() => undefined);
    throw error;
  }
  await store.delete(userId, { keep: version });
  return stored;
}

function centerSquare(width: number, height: number): Crop {
  const size = Math.min(width, height);
  return { x: Math.floor((width - size) / 2), y: Math.floor((height - size) / 2), size };
}

function assertCrop(crop: Crop, width: number, height: number): void {
  const { x, y, size } = crop ?? {};
  const ints = [x, y, size].every((n) => Number.isSafeInteger(n));
  if (!ints || x < 0 || y < 0 || size < MIN_AVATAR_PX || x + size > width || y + size > height) {
    throw new BadCrop();
  }
}

async function render(input: Buffer, decoder: SharpOptions, crop: Crop): Promise<AvatarFiles> {
  const square = sharp(input, decoder).extract({
    left: crop.x,
    top: crop.y,
    width: crop.size,
    height: crop.size,
  });
  // webp() without keepMetadata/withMetadata drops EXIF, XMP and ICC (converted to sRGB).
  const [big, small] = await Promise.all(
    AVATAR_SIZES.map((px) =>
      square.clone().resize(px, px).webp({ quality: WEBP_QUALITY }).toBuffer(),
    ),
  );
  return { 256: big!, 64: small! };
}

/** Maps decoder failures to typed rejections; the decoder's message never reaches the caller. */
async function decode<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Error && /pixel limit/i.test(error.message)) throw new TooLarge();
    throw new Undecodable();
  }
}
