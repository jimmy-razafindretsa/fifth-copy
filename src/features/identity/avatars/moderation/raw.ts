import sharp from "sharp";

/** Side of the square the moderators analyse: 64x64 RGB is enough for colour statistics. */
export const ANALYSIS_PX = 64;

/** The image as 64x64 raw RGB (alpha dropped), or null when it cannot be decoded. */
export async function rawRgb(image: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(image, { limitInputPixels: 1_000_000, pages: 1 })
      .resize(ANALYSIS_PX, ANALYSIS_PX, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer();
  } catch {
    return null;
  }
}
