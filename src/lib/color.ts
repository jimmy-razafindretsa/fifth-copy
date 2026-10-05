/** Pure sRGB helpers for contrast checks (WCAG 2.1). Reused by the token tests and #27. */
export type Rgb = readonly [number, number, number];

/** `#rgb` or `#rrggbb` (any case) to integer channels. */
export function parseHex(hex: string): Rgb {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a hex colour: ${hex}`);
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as Rgb;
}

/** `color-mix(in srgb, a shareA, b)`: channels rounded to integers, as Chromium resolves them. */
export function mixSrgb(a: string | Rgb, b: string | Rgb, shareA: number): Rgb {
  const ca = typeof a === "string" ? parseHex(a) : a;
  const cb = typeof b === "string" ? parseHex(b) : b;
  return ca.map((v, i) => Math.round(v * shareA + cb[i] * (1 - shareA))) as unknown as Rgb;
}

function luminance(c: Rgb): number {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio, 1 to 21. */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const la = luminance(typeof a === "string" ? parseHex(a) : a);
  const lb = luminance(typeof b === "string" ? parseHex(b) : b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
