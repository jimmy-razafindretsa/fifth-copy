// Image type from magic bytes only (ADR 0014): never the file name or the declared MIME type.
// Four signatures; anything else (SVG, HEIC, HTML, other RIFF files) is not an avatar.
export type ImageType = "jpeg" | "png" | "webp" | "gif";

const startsWith = (bytes: Uint8Array, offset: number, signature: readonly number[]) =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF87 = ascii("GIF87a");
const GIF89 = ascii("GIF89a");
const RIFF = ascii("RIFF");
const WEBP = ascii("WEBP");

export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, 0, JPEG)) return "jpeg";
  if (startsWith(bytes, 0, PNG)) return "png";
  if (startsWith(bytes, 0, GIF87) || startsWith(bytes, 0, GIF89)) return "gif";
  if (startsWith(bytes, 0, RIFF) && startsWith(bytes, 8, WEBP)) return "webp";
  return null;
}
