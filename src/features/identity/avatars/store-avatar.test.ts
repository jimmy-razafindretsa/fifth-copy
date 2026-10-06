import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvatarError, BadCrop, TooLarge, TooSmall, Undecodable, WrongType } from "./errors";
import { FsAvatarStore } from "./fs-store";
import { MAX_AVATAR_BYTES, storeAvatar, type Crop } from "./store-avatar";

// Fixtures are generated with sharp in the test: no binary files in the repo.
type Format = "jpeg" | "png" | "webp" | "gif";
const RED = { r: 255, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };

function solid(width: number, height: number, background = RED) {
  return sharp({ create: { width, height, channels: 3, background } });
}
const encode = (format: Format, width = 300, height = 200) =>
  solid(width, height)[format]().toBuffer();

/** Left half red, right half blue. */
async function halves(width: number, height: number) {
  const right = await solid(width / 2, height, BLUE)
    .png()
    .toBuffer();
  return solid(width, height).composite([{ input: right, left: width / 2, top: 0 }]);
}

async function meanColor(bytes: Buffer) {
  const { channels } = await sharp(bytes).stats();
  return { r: channels[0]!.mean, g: channels[1]!.mean, b: channels[2]!.mean };
}

const CROP: Crop = { x: 10, y: 10, size: 150 };

describe("storeAvatar", () => {
  let root: string;
  let store: FsAvatarStore;
  let clock: number;
  const now = () => clock++;
  const files = async () => (await readdir(path.join(root, "user1")).catch(() => [])).sort();
  const store1 = (bytes: Buffer, crop: Crop = CROP, extra = {}) =>
    storeAvatar("user1", bytes, crop, { store, now, ...extra });

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "fc-store-avatar-"));
    store = new FsAvatarStore(root);
    clock = 1_700_000_000_000;
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it.each(["jpeg", "png", "webp", "gif"] as const)(
    "C4: accepts %s and writes WebP at 256 and 64 px",
    async (format) => {
      const result = await store1(await encode(format));
      expect(result).toEqual({
        version: 1_700_000_000_000,
        key: "user1/1700000000000",
        status: "APPROVED",
      });
      expect(await files()).toEqual(["1700000000000-256.webp", "1700000000000-64.webp"]);
      for (const size of [256, 64] as const) {
        const meta = await sharp((await store.get("user1", result.version, size))!).metadata();
        expect(meta).toMatchObject({ format: "webp", width: size, height: size });
      }
    },
  );

  it("C4: an animated GIF keeps only its first frame", async () => {
    const frames = await Promise.all([RED, BLUE].map((c) => solid(100, 100, c).png().toBuffer()));
    const gif = await sharp(frames, { join: { animated: true } })
      .gif()
      .toBuffer();
    expect((await sharp(gif).metadata()).pages).toBe(2);

    const { version } = await store1(gif, { x: 0, y: 0, size: 100 });
    const out = (await store.get("user1", version, 256))!;
    expect((await sharp(out).metadata()).pages ?? 1).toBe(1);
    const color = await meanColor(out);
    expect(color.r).toBeGreaterThan(200);
    expect(color.b).toBeLessThan(50);
  });

  it("C4: strips EXIF, XMP and ICC metadata", async () => {
    const tagged = await solid(300, 300)
      .jpeg()
      .withExif({ IFD0: { Copyright: "secret-owner", Artist: "child name" } })
      .withIccProfile("p3")
      .toBuffer();
    const inMeta = await sharp(tagged).metadata();
    expect(inMeta.exif).toBeDefined();
    expect(inMeta.icc).toBeDefined();

    const { version } = await store1(tagged);
    for (const size of [256, 64] as const) {
      const out = (await store.get("user1", version, size))!;
      const meta = await sharp(out).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(out.includes("secret-owner")).toBe(false);
    }
  });

  it("C4: the crop is validated and applied on the EXIF-oriented image", async () => {
    // Stored 200x100 (red | blue), orientation 6 = displayed rotated 90° clockwise: 100x200,
    // red on top, blue at the bottom.
    const rotated = await (await halves(200, 100)).jpeg().withExif({ IFD0: {} }).toBuffer();
    const oriented = await sharp(rotated).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    expect((await sharp(oriented).metadata()).orientation).toBe(6);

    const { version } = await store1(oriented, { x: 0, y: 100, size: 100 });
    const color = await meanColor((await store.get("user1", version, 64))!);
    expect(color.b).toBeGreaterThan(200);
    expect(color.r).toBeLessThan(50);

    // In bounds of the stored (unrotated) pixels but outside the displayed image.
    await expect(store1(oriented, { x: 100, y: 0, size: 100 })).rejects.toBeInstanceOf(BadCrop);
  });

  it("C4: exactly 64x64 is accepted", async () => {
    await expect(
      store1(await encode("png", 64, 64), { x: 0, y: 0, size: 64 }),
    ).resolves.toMatchObject({
      status: "APPROVED",
    });
  });

  it("C4: the previous version's files are removed, other users untouched", async () => {
    await storeAvatar("user2", await encode("png"), CROP, { store, now });
    const first = await store1(await encode("png"));
    const second = await store1(await encode("jpeg"));
    expect(second.version).toBeGreaterThan(first.version);
    expect(await files()).toEqual([`${second.version}-256.webp`, `${second.version}-64.webp`]);
    expect(await readdir(path.join(root, "user2"))).toHaveLength(2);
  });

  it("C4: commit runs after the files are written and before the old version is removed", async () => {
    const first = await store1(await encode("png"));
    const seen: string[][] = [];
    const commit = vi.fn(async () => void seen.push(await files()));
    const second = await store1(await encode("png"), CROP, { commit });
    expect(commit).toHaveBeenCalledWith({
      version: second.version,
      key: second.key,
      status: "APPROVED",
    });
    expect(seen[0]).toHaveLength(4);
    expect(await files()).toEqual([`${second.version}-256.webp`, `${second.version}-64.webp`]);
    expect(first.version).not.toBe(second.version);
  });

  it("C4: a failed commit removes the new files and keeps the previous version", async () => {
    const first = await store1(await encode("png"));
    const commit = vi.fn().mockRejectedValue(new Error("db down"));
    await expect(store1(await encode("png"), CROP, { commit })).rejects.toThrow("db down");
    expect(await files()).toEqual([`${first.version}-256.webp`, `${first.version}-64.webp`]);
  });

  it("the moderator hook sees the 256 px output and decides the status", async () => {
    const moderator = vi.fn(async () => "PENDING" as const);
    const result = await store1(await encode("png"), CROP, { moderator });
    expect(result.status).toBe("PENDING");
    expect(moderator).toHaveBeenCalledWith({ userId: "user1", image: expect.any(Buffer) });
  });

  describe("C5: rejections are typed and write nothing", () => {
    const bigPng = () => {
      const bytes = Buffer.alloc(MAX_AVATAR_BYTES + 1, 0);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
      return bytes;
    };

    it.each<[string, () => Promise<Buffer> | Buffer, Crop, new () => AvatarError]>([
      ["5 MB + 1 byte (rejected before decoding)", bigPng, CROP, TooLarge],
      [
        "SVG",
        () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"/>'),
        CROP,
        WrongType,
      ],
      [
        "HEIC-like ftyp box",
        () => Buffer.from("\0\0\0\x18ftypheic\0\0\0\0mif1heic", "latin1"),
        CROP,
        WrongType,
      ],
      ["empty", () => Buffer.alloc(0), CROP, WrongType],
      ["63 px wide", () => encode("png", 63, 200), { x: 0, y: 0, size: 63 }, TooSmall],
      ["63 px tall", () => encode("jpeg", 200, 63), { x: 0, y: 0, size: 63 }, TooSmall],
      [
        "truncated PNG",
        async () => {
          const png = await sharp({
            create: {
              width: 300,
              height: 300,
              channels: 3,
              noise: { type: "gaussian", mean: 128, sigma: 30 },
            },
          })
            .png()
            .toBuffer();
          return png.subarray(0, Math.floor(png.length / 2));
        },
        CROP,
        Undecodable,
      ],
      [
        "truncated JPEG header",
        async () => (await encode("jpeg")).subarray(0, 40),
        CROP,
        Undecodable,
      ],
      [
        "PNG magic with garbage",
        () =>
          Buffer.concat([
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            Buffer.alloc(500, 7),
          ]),
        CROP,
        Undecodable,
      ],
      ["crop outside the right edge", () => encode("png"), { x: 200, y: 0, size: 150 }, BadCrop],
      ["crop outside the bottom edge", () => encode("png"), { x: 0, y: 100, size: 150 }, BadCrop],
      ["negative crop", () => encode("png"), { x: -1, y: 0, size: 100 }, BadCrop],
      ["fractional crop", () => encode("png"), { x: 0.5, y: 0, size: 100 }, BadCrop],
      ["crop under 64 px", () => encode("png"), { x: 0, y: 0, size: 63 }, BadCrop],
      ["NaN crop", () => encode("png"), { x: Number.NaN, y: 0, size: 100 }, BadCrop],
    ])("%s", async (_label, make, crop, ErrorType) => {
      const error = await store1(await make(), crop).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ErrorType);
      expect(error).toBeInstanceOf(AvatarError);
      expect(await readdir(root)).toEqual([]);
    });

    it("a pixel bomb over the decoder's pixel limit is TooLarge", async () => {
      const error = await store1(await encode("png", 300, 300), CROP, {
        maxPixels: 250 * 250,
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TooLarge);
      expect(await readdir(root)).toEqual([]);
    });

    it("a rejection keeps the previous avatar", async () => {
      const first = await store1(await encode("png"));
      await expect(store1(await encode("png"), { x: 500, y: 0, size: 100 })).rejects.toBeInstanceOf(
        BadCrop,
      );
      expect(await files()).toEqual([`${first.version}-256.webp`, `${first.version}-64.webp`]);
    });
  });
});
