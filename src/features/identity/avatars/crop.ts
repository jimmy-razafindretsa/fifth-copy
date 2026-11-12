// The square crop of the picture dialog (#60), in source pixels of the picture as the browser shows it
// (EXIF orientation applied, as storeAvatar reads it). Pure: the dialog's drag, wheel, slider and
// arrow keys all go through these.

export type CropRect = { x: number; y: number; size: number };
export type Picture = { width: number; height: number };

export const MAX_ZOOM = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Rounded to whole pixels and kept inside the picture (what `cropSchema` and storeAvatar accept). */
export function fitCrop(rect: CropRect, pic: Picture): CropRect {
  const short = Math.min(pic.width, pic.height);
  const size = clamp(Math.round(rect.size), Math.max(1, Math.ceil(short / MAX_ZOOM)), short);
  return {
    size,
    x: clamp(Math.round(rect.x), 0, pic.width - size),
    y: clamp(Math.round(rect.y), 0, pic.height - size),
  };
}

/** The largest centred square: the starting frame. */
export function centredCrop(pic: Picture): CropRect {
  const size = Math.min(pic.width, pic.height);
  return fitCrop({ x: (pic.width - size) / 2, y: (pic.height - size) / 2, size }, pic);
}

/** Zoom 1 = the short side fills the frame; zooming keeps the frame's centre. */
export function zoomOf(rect: CropRect, pic: Picture): number {
  return Math.min(pic.width, pic.height) / rect.size;
}

export function withZoom(rect: CropRect, zoom: number, pic: Picture): CropRect {
  const size = Math.min(pic.width, pic.height) / clamp(zoom, 1, MAX_ZOOM);
  const cx = rect.x + rect.size / 2;
  const cy = rect.y + rect.size / 2;
  return fitCrop({ x: cx - size / 2, y: cy - size / 2, size }, pic);
}

/** Moves the picture under the frame by (dx, dy) frame pixels; the frame is `frame` px wide. */
export function panBy(
  rect: CropRect,
  dx: number,
  dy: number,
  frame: number,
  pic: Picture,
): CropRect {
  const perPixel = rect.size / frame;
  return fitCrop({ ...rect, x: rect.x - dx * perPixel, y: rect.y - dy * perPixel }, pic);
}

/** One arrow-key nudge: about 1/32 of the frame, at least one source pixel. */
export function nudgeStep(rect: CropRect): number {
  return Math.max(1, Math.round(rect.size / 32));
}
