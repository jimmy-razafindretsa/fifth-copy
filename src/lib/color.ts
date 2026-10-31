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

/** HSL hue of an sRGB colour in degrees, 0 to 360 (0 for a pure grey). */
export function hue(c: string | Rgb): number {
  const [r, g, b] = (typeof c === "string" ? parseHex(c) : c).map((v) => v / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** A colour in linear-light sRGB, each channel 0..1 (the space the CVD matrices work in). */
export type LinearRgb = readonly [number, number, number];

const toLinear = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** sRGB (hex or integer channels) to linear light. */
export function linearRgb(c: string | Rgb): LinearRgb {
  const [r, g, b] = typeof c === "string" ? parseHex(c) : c;
  return [toLinear(r), toLinear(g), toLinear(b)];
}

type Matrix = readonly [LinearRgb, LinearRgb, LinearRgb];
const apply = (m: Matrix, v: LinearRgb): LinearRgb => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

/**
 * Machado, Oliveira & Fernandes 2009, "A Physiologically-based Model for Simulation of Color Vision
 * Deficiency", severity 1.0 (dichromacy), applied to linear sRGB.
 */
export const CVD_MATRICES = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
} as const satisfies Record<string, Matrix>;
export type Deficiency = keyof typeof CVD_MATRICES;

/** A linear-sRGB colour as a dichromat of `kind` sees it, clamped to the gamut. */
export function simulate(kind: Deficiency, c: LinearRgb): LinearRgb {
  const [r, g, b] = apply(CVD_MATRICES[kind], c);
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return [clamp(r), clamp(g), clamp(b)];
}

/** CIELAB (D65 white) of a linear-sRGB colour: `lab(linearRgb("#3E3A78"))`. */
export function lab([r, g, b]: LinearRgb): readonly [number, number, number] {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference: the Euclidean distance in CIELAB. */
export function deltaE76(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}
