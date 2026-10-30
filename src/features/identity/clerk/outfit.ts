/**
 * The clerk outfit of bible 10.1: one config object `{hair, glasses, hat, clothes, face, hairCol}`, read
 * and written whole (#687). Pure data and functions, no imports, safe in any bundle.
 * Single source of the ids: the reference page `docs/design/bible/Fifth Copy Your Clerk.html` (`CATS`,
 * `HAIRCOL`); `outfit.test.ts` fails on any drift, and on any drift of the i18n item names.
 */

export const OUTFIT_CATEGORIES = ["hair", "glasses", "hat", "clothes", "face"] as const;
export type OutfitCategory = (typeof OUTFIT_CATEGORIES)[number];

/** Ids are stable API (bible 10.1): never rename one, only add. */
export const OUTFIT_CATALOGUE = {
  hair: ["side", "buzz", "quiff", "bowl", "bald"],
  glasses: ["round", "dark", "square", "monocle", "none"],
  hat: ["none", "ushanka", "kepka", "eyeshade", "beret"],
  clothes: ["vest", "cardigan", "jacket", "sweater", "braces"],
  face: ["stache", "clean", "beard"],
  hairCol: ["#4A3526", "#1E1A17", "#A4552A", "#C9A465", "#8C8A84"],
} as const satisfies Record<OutfitCategory | "hairCol", readonly string[]>;

export type Outfit = Record<OutfitCategory, string> & { hairCol: string };

const OUTFIT_KEYS = [...OUTFIT_CATEGORIES, "hairCol"] as const;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The outfit in `value` with only its six known keys, or null when a key is missing or an id is not in
 * the catalogue. Used on every read, so a stored value the current catalogue rejects reads as "none".
 */
export function parseOutfit(value: unknown): Outfit | null {
  if (!isRecord(value)) return null;
  const outfit = {} as Outfit;
  for (const key of OUTFIT_KEYS) {
    const id = value[key];
    const allowed: readonly string[] = OUTFIT_CATALOGUE[key];
    if (typeof id !== "string" || !allowed.includes(id)) return null;
    outfit[key] = id;
  }
  return outfit;
}

/** The Full Lobby reference page's `hash(n)` (bible 16): a deterministic value in [0, 1). */
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * The fixed outfit of desk `desk` (>= 1): the Full Lobby reference's `randCfg(i)`, for bots and players
 * with nothing saved. Pure and deterministic.
 */
export function outfitForDesk(desk: number): Outfit {
  const outfit = {} as Outfit;
  OUTFIT_CATEGORIES.forEach((category, j) => {
    const opts = OUTFIT_CATALOGUE[category];
    outfit[category] = opts[Math.floor(hash(desk * 7.3 + j) * opts.length)]!;
  });
  const colours = OUTFIT_CATALOGUE.hairCol;
  outfit.hairCol = colours[Math.floor(hash(desk * 3.1) * colours.length)]!;
  return outfit;
}
