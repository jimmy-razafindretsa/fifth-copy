/** Pure sRGB helpers for contrast checks (WCAG 2.1). Reused by the token tests and #27. */
export type Rgb = readonly [number, number, number];

/** `#rgb` or `#rrggbb` (any case) to integer channels. */
export function parseHex(hex: string): Rgb {
  const digits = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())?.[1];
  if (!digits) throw new Error(`Not a hex colour: ${hex}`);
  const h = digits.length === 3 ? [...digits].map((c) => c + c).join("") : digits;
  const channel = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [channel(0), channel(2), channel(4)];
}

/** `color-mix(in srgb, a shareA, b)`: channels rounded to integers, as Chromium resolves them. */
export function mixSrgb(a: string | Rgb, b: string | Rgb, shareA: number): Rgb {
  const ca = typeof a === "string" ? parseHex(a) : a;
  const cb = typeof b === "string" ? parseHex(b) : b;
  const channel = (i: 0 | 1 | 2) => Math.round(ca[i] * shareA + cb[i] * (1 - shareA));
  return [channel(0), channel(1), channel(2)];
}

function luminance(c: Rgb): number {
  const linear = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
}

/** WCAG 2.1 contrast ratio, 1 to 21. */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const la = luminance(typeof a === "string" ? parseHex(a) : a);
  const lb = luminance(typeof b === "string" ? parseHex(b) : b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
