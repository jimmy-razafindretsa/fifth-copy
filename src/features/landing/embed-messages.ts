/**
 * The embedding protocol (bible 15) as parsed at the edge. The clerk and lobby pages post with `'*'`;
 * the page only listens to its own origin and its own iframes (use-embed-bridge.ts).
 * The guards are hand-written, not zod: zod classic costs ~91 kB gzip in the landing first load (#626).
 */
import type { Outfit, OutfitCategory } from "@/features/identity";

export type { Outfit, OutfitCategory };

/**
 * identity's `OUTFIT_CATEGORIES` (bible 10.1), restated here because the identity barrel is server-only at
 * runtime; `embed-messages.test.ts` asserts the two are equal, and `satisfies` keeps every entry an id.
 */
export const OUTFIT_CATEGORIES = [
  "hair",
  "glasses",
  "hat",
  "clothes",
  "face",
] as const satisfies readonly OutfitCategory[];

export const VIEWS = ["over", "pov"] as const;
export type View = (typeof VIEWS)[number];

/** clerk -> page: the outfit the clerk is wearing now. */
export type ClerkMessage = { type: "fc-clerk"; cfg: Outfit };
/** lobby -> page: the camera the lobby is showing. */
export type ViewMessage = { type: "fc-view"; view: View };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Shape only (six strings): the ids are checked against the catalogue by the server (`outfitSchema`) on save.
function parseOutfit(v: unknown): Outfit | null {
  if (!isRecord(v)) return null;
  const outfit = {} as Outfit;
  for (const key of [...OUTFIT_CATEGORIES, "hairCol"] as const) {
    const slot = v[key];
    if (typeof slot !== "string") return null;
    outfit[key] = slot;
  }
  return outfit;
}

/** Same six slots (an echo of the saved outfit is not saved again, #687). */
export function sameOutfit(a: Outfit, b: Outfit | null): boolean {
  return b !== null && [...OUTFIT_CATEGORIES, "hairCol" as const].every((k) => a[k] === b[k]);
}

/** An `fc-clerk` message with only its known fields, or `null`. */
export function parseClerkMessage(data: unknown): ClerkMessage | null {
  if (!isRecord(data) || data.type !== "fc-clerk") return null;
  const cfg = parseOutfit(data.cfg);
  return cfg ? { type: "fc-clerk", cfg } : null;
}

/** An `fc-view` message, or `null`. */
export function parseViewMessage(data: unknown): ViewMessage | null {
  if (!isRecord(data) || data.type !== "fc-view") return null;
  const view = VIEWS.find((v) => v === data.view);
  return view ? { type: "fc-view", view } : null;
}

export const FEED_VIEWS = ["over", "pov", "auto"] as const;
export type FeedView = (typeof FEED_VIEWS)[number];

/** page -> embeds */
export const lookMessage = (x: number, y: number) => ({ type: "fc-look", x, y }) as const;
export const reissueMessage = () => ({ type: "fc-reissue" }) as const;
export const setViewMessage = (view: FeedView) => ({ type: "fc-setview", view }) as const;
