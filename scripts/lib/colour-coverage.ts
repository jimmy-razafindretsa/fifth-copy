/**
 * Pure colour coverage maths (#15): bucket screenshot pixels to the bible 3.1 families and compare the
 * shares with the coverage target (paper 55 / red 28 / ink 10 / violet 5 / gold 2). The CLI that decodes
 * PNGs is scripts/colour-coverage.ts. Brand values come from the `--brand-*` lines of
 * docs/design/tokens.css at run time, never a second copy.
 */
import { parseHex, type Rgb } from "../../src/lib/color";

export type Bucket = "paper" | "red" | "ink" | "violet" | "gold" | "other";
export type Shares = Record<Bucket, number>;
export type Candidate = { rgb: Rgb; bucket: Bucket };

export const BUCKETS: readonly Bucket[] = ["paper", "red", "ink", "violet", "gold", "other"];
export const TARGET = { paper: 55, red: 28, ink: 10, violet: 5, gold: 2 } as const;
/** sRGB Euclidean distance under which a pixel counts as its nearest brand colour. */
export const MAX_DISTANCE = 48;

/** `--brand-<name>: <hex>;` lines of tokens.css to channels. */
export function parseBrand(tokensCss: string): Record<string, Rgb> {
  const out: Record<string, Rgb> = {};
  for (const m of tokensCss.matchAll(/--brand-([\w-]+)\s*:\s*([^;\s]+)\s*;/g)) {
    if (m[1] && m[2]) out[m[1]] = parseHex(m[2]);
  }
  return out;
}

// brand value -> bucket; the night ink pair counts as ink only on Night shift screenshots
const LIGHT: Record<string, Bucket> = {
  paper: "paper",
  newsprint: "paper",
  "tape-paper": "paper",
  night: "paper",
  "night-panel": "paper",
  "agit-red": "red",
  banner: "red",
  "press-ink": "ink",
  "ribbon-violet": "violet",
  "medal-gold": "gold",
  "backroom-grey": "other",
  phosphor: "other",
  nixie: "other",
};
const DARK_ONLY: Record<string, Bucket> = { "night-ink": "ink", "night-muted": "ink" };

export function candidates(brand: Record<string, Rgb>, dark: boolean): Candidate[] {
  const map = dark ? { ...LIGHT, ...DARK_ONLY } : LIGHT;
  return Object.entries(map).flatMap(([name, bucket]) => {
    const rgb = brand[name];
    if (!rgb) throw new Error(`tokens.css has no --brand-${name}`);
    return [{ rgb, bucket }];
  });
}

export function classify(px: Rgb, palette: readonly Candidate[]): Bucket {
  let best: Bucket = "other";
  let bestD = MAX_DISTANCE * MAX_DISTANCE;
  for (const c of palette) {
    const d = (px[0] - c.rgb[0]) ** 2 + (px[1] - c.rgb[1]) ** 2 + (px[2] - c.rgb[2]) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = c.bucket;
    }
  }
  return best;
}

/** Shares in percent of the pixels of a raw interleaved buffer (`channels` per pixel, RGB first). */
export function summarize(
  data: Uint8Array,
  channels: number,
  palette: readonly Candidate[],
): Shares {
  const counts: Shares = { paper: 0, red: 0, ink: 0, violet: 0, gold: 0, other: 0 };
  const cache = new Map<number, Bucket>();
  const total = Math.floor(data.length / channels);
  for (let i = 0; i + channels <= data.length; i += channels) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const bl = data[i + 2]!;
    const key = (r << 16) | (g << 8) | bl;
    let bucket = cache.get(key);
    if (bucket === undefined) {
      bucket = classify([r, g, bl], palette);
      cache.set(key, bucket);
    }
    counts[bucket]++;
  }
  for (const k of BUCKETS) counts[k] = total ? (counts[k] * 100) / total : 0;
  return counts;
}

/** Roles that drift: red or paper more than 15 points off target, gold above 6 points. */
export function warn(s: Shares): Bucket[] {
  const out: Bucket[] = [];
  if (Math.abs(s.paper - TARGET.paper) > 15) out.push("paper");
  if (Math.abs(s.red - TARGET.red) > 15) out.push("red");
  if (s.gold > 6) out.push("gold");
  return out;
}

export function formatLine(file: string, s: Shares): string {
  const parts = BUCKETS.map((k) => `${k} ${Math.round(s[k])}%`).join(" ");
  const flags = warn(s).map((r) => ` WARN ${r}`);
  return `${file} ${parts}${flags.join("")}`;
}
