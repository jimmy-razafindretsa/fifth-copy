/**
 * The plinth clerk embed's half of the embedding protocol (bible 13, 14.4, 15; #300 C4, #688 C2-C3):
 * page -> embed messages and the guards this side applies. The served page (`public/3d/podium-clerk.html`,
 * generated from `docs/design/embeds/Fifth Copy Podium Clerk.html`) runs the same checks in plain JS.
 * Hand-written, not zod: this module is imported by a client leaf, and zod classic costs ~91 kB gzip in a
 * first load (#626). The outfit type is identity's, re-exported so the leaf never imports a feature.
 */
import type { Outfit } from "@/features/identity";
import { MEDAL_VARIANTS, type MedalVariant } from "./view/dawn-report";

export type { Outfit };

/** The served embed (bible 16 app embeds, scripts/embeds.ts). */
export const PODIUM_CLERK_EMBED = "/3d/podium-clerk.html";

/** page -> medal: swap the metal (gold, silver, bronze: one model, bible 13). */
export type MedalVariantMessage = { type: "fc-medal-variant"; variant: MedalVariant };
/** page -> medal: the page's motion setting (bible 8: `data-motion` crosses the iframe here). */
export type MotionMessage = { type: "fc-motion"; reduce: boolean };
/** page -> clerk: wear this outfit (a change rebuilds the clerk with the `tryon` bounce, bible 10.2). */
export type SetCfgMessage = { type: "fc-setcfg"; cfg: Outfit };
/** clerk -> page: the outfit just drawn; the first one is the plinth's ready signal (#688 C4). */
export type ClerkReadyMessage = { type: "fc-clerk"; cfg: Outfit };

export const medalVariantMessage = (variant: MedalVariant): MedalVariantMessage => ({
  type: "fc-medal-variant",
  variant,
});
export const motionMessage = (reduce: boolean): MotionMessage => ({ type: "fc-motion", reduce });
export const setCfgMessage = (cfg: Outfit): SetCfgMessage => ({ type: "fc-setcfg", cfg });

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** An `fc-medal-variant` with a known variant, or `null`. */
export function parseMedalVariantMessage(data: unknown): MedalVariantMessage | null {
  if (!isRecord(data) || data.type !== "fc-medal-variant") return null;
  const variant = MEDAL_VARIANTS.find((v) => v === data.variant);
  return variant ? medalVariantMessage(variant) : null;
}

/** An `fc-motion` with a boolean `reduce`, or `null`. */
export function parseMotionMessage(data: unknown): MotionMessage | null {
  if (!isRecord(data) || data.type !== "fc-motion" || typeof data.reduce !== "boolean") return null;
  return motionMessage(data.reduce);
}

/** The outfit keys (bible 10.1), restated: the identity barrel is server-only at runtime. */
const OUTFIT_KEYS = [
  "hair",
  "glasses",
  "hat",
  "clothes",
  "face",
  "hairCol",
] as const satisfies readonly (keyof Outfit)[];

/**
 * An `fc-clerk` carrying the six outfit strings, with only those kept, or `null`. Shape only: the ids are
 * the embed's business (it built them), the page only needs the signal.
 */
export function parseClerkReady(data: unknown): ClerkReadyMessage | null {
  if (!isRecord(data) || data.type !== "fc-clerk" || !isRecord(data.cfg)) return null;
  const cfg = {} as Outfit;
  for (const key of OUTFIT_KEYS) {
    const id = data.cfg[key];
    if (typeof id !== "string") return null;
    cfg[key] = id;
  }
  return { type: "fc-clerk", cfg };
}

/**
 * The plinth clerk's URL: `?variant=` and `?cfg=` give the right medal and outfit on the first frame (the
 * messages only arrive once the frame has loaded), `?embed=1` caps the pixel ratio at 1 (three clerks on
 * one phone).
 */
export const podiumClerkSrc = (variant: MedalVariant, outfit: Outfit) =>
  `${PODIUM_CLERK_EMBED}?embed=1&variant=${variant}&cfg=${encodeURIComponent(JSON.stringify(outfit))}`;
