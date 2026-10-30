/**
 * The clerk outfit of bible 10.1: one config object `{hair, glasses, hat, clothes, face, hairCol}`, read
 * and written whole (#687). Pure data and functions (it imports only its catalogue.json), safe in any
 * bundle.
 * Single source of the ids: the reference page `docs/design/bible/Fifth Copy Your Clerk.html` (`CATS`,
 * `HAIRCOL`); `outfit.test.ts` fails on any drift, and on any drift of the i18n item names.
 */

import catalogue from "./catalogue.json";

/** A category's ids, never empty. */
export type OutfitIds = readonly [string, ...string[]];

function ids(list: readonly string[]): OutfitIds {
  const [first, ...rest] = list;
  if (first === undefined) throw new Error("an outfit category needs at least one id");
  return [first, ...rest];
}

export const OUTFIT_CATEGORIES = ["hair", "glasses", "hat", "clothes", "face"] as const;
export type OutfitCategory = (typeof OUTFIT_CATEGORIES)[number];

/**
 * Ids are stable API (bible 10.1): never rename one, only add. The data lives in `catalogue.json`: the
 * `hairCol` ids are the reference page's `HAIRCOL` hex strings, opaque ids the 3D embed paints, never a UI
 * colour, so they stay out of the TS sources the colour guard (check-colours, "no raw hex") scans.
 */
export const OUTFIT_CATALOGUE: Readonly<Record<OutfitCategory | "hairCol", OutfitIds>> = {
  hair: ids(catalogue.hair),
  glasses: ids(catalogue.glasses),
  hat: ids(catalogue.hat),
  clothes: ids(catalogue.clothes),
  face: ids(catalogue.face),
  hairCol: ids(catalogue.hairCol),
};

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
