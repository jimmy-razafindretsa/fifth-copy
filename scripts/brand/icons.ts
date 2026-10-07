/**
 * The site icons (#24), all from public/brand/monogram-paper.svg (docs/design/logo.md: app icon, light):
 *   src/app/icon.svg        the file itself, byte for byte
 *   src/app/apple-icon.png  180x180, flattened on paper (iOS paints transparent corners black; logo.md)
 *   src/app/favicon.ico     PNG frames of 16 and 32 px, transparent corners
 * Rasterised with sharp (already a dependency); the ICO container is written here, no library.
 *
 *   npx tsx scripts/brand/icons.ts          write the three files
 *   npx tsx scripts/brand/icons.ts --check  exit 1 when icon.svg drifted or a raster has the wrong frames
 *
 * PNG bytes differ across platforms (librsvg), so checks read sizes and frames, never bytes.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { parseBrand } from "../lib/colour-coverage";

export const SOURCE = "public/brand/monogram-paper.svg";
export const ICON_SVG = "src/app/icon.svg";
export const APPLE_ICON = "src/app/apple-icon.png";
export const FAVICON = "src/app/favicon.ico";
export const APPLE_SIZE = 180;
export const FAVICON_SIZES = [16, 32] as const;

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(png: Buffer): { width: number; height: number } {
  if (png.readUInt32BE(0) !== 0x89504e47 || png.toString("ascii", 12, 16) !== "IHDR")
    throw new Error("not a PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** An ICO container holding each PNG as one frame (Vista+ PNG-in-ICO). */
export function writeIco(frames: readonly Buffer[]): Buffer {
  const header = Buffer.alloc(6 + 16 * frames.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach((png, i) => {
    const { width, height } = pngSize(png);
    if (width > 256 || height > 256) throw new Error("ICO frames are at most 256 px");
    const at = 6 + 16 * i;
    header.writeUInt8(width % 256, at);
    header.writeUInt8(height % 256, at + 1);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...frames]);
}

/** The frames of an ICO: declared size and the payload's own PNG size. */
export function readIco(ico: Buffer): { width: number; height: number; png: Buffer }[] {
  if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) throw new Error("not an ICO");
  return Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
    const at = 6 + 16 * i;
    const png = ico.subarray(
      ico.readUInt32LE(at + 12),
      ico.readUInt32LE(at + 12) + ico.readUInt32LE(at + 8),
    );
    const declared = { width: ico.readUInt8(at) || 256, height: ico.readUInt8(at + 1) || 256 };
    const actual = pngSize(png);
    if (actual.width !== declared.width || actual.height !== declared.height)
      throw new Error(`frame ${i}: directory says ${declared.width}, PNG is ${actual.width}`);
    return { ...declared, png };
  });
}

/** The square mark at `size` px, drawn 8x larger then downsampled for clean small sizes. */
export async function rasterise(
  svg: Buffer,
  size: number,
  flattenOn?: readonly [number, number, number],
) {
  const { width = size } = await sharp(svg).metadata();
  let img = sharp(svg, { density: (72 * size * 8) / width }).resize(size, size, { fit: "fill" });
  if (flattenOn)
    img = img.flatten({ background: { r: flattenOn[0], g: flattenOn[1], b: flattenOn[2] } });
  return img.png({ compressionLevel: 9 }).toBuffer();
}

export function paper(root = process.cwd()): readonly [number, number, number] {
  const brand = parseBrand(fs.readFileSync(path.join(root, "docs/design/tokens.css"), "utf8"));
  if (!brand.paper) throw new Error("tokens.css has no --brand-paper");
  return brand.paper;
}

/** Problems with the committed icons, empty when they hold. */
export function checkIcons(root = process.cwd()): string[] {
  const at = (p: string) => path.join(root, p);
  const problems: string[] = [];
  for (const p of [ICON_SVG, APPLE_ICON, FAVICON])
    if (!fs.existsSync(at(p))) problems.push(`${p} missing`);
  if (problems.length) return problems;
  if (!fs.readFileSync(at(ICON_SVG)).equals(fs.readFileSync(at(SOURCE))))
    problems.push(`${ICON_SVG} differs from ${SOURCE}`);
  const apple = pngSize(fs.readFileSync(at(APPLE_ICON)));
  if (apple.width !== APPLE_SIZE || apple.height !== APPLE_SIZE)
    problems.push(`${APPLE_ICON} is ${apple.width}x${apple.height}`);
  const sizes = readIco(fs.readFileSync(at(FAVICON))).map((f) => `${f.width}x${f.height}`);
  if (sizes.join() !== FAVICON_SIZES.map((s) => `${s}x${s}`).join())
    problems.push(`${FAVICON} frames ${sizes.join(", ")}`);
  return problems;
}

async function main() {
  const root = process.cwd();
  if (process.argv.includes("--check")) {
    const problems = checkIcons(root);
    for (const p of problems) console.error(`icons: ${p}`);
    if (problems.length) process.exit(1);
    console.log("icons: up to date");
    return;
  }
  const svg = fs.readFileSync(path.join(root, SOURCE));
  fs.copyFileSync(path.join(root, SOURCE), path.join(root, ICON_SVG));
  fs.writeFileSync(path.join(root, APPLE_ICON), await rasterise(svg, APPLE_SIZE, paper(root)));
  const frames = await Promise.all(FAVICON_SIZES.map((s) => rasterise(svg, s)));
  fs.writeFileSync(path.join(root, FAVICON), writeIco(frames));
  console.log(`icons: wrote ${ICON_SVG}, ${APPLE_ICON}, ${FAVICON}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
