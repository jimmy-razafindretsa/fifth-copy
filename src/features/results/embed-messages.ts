/**
 * The medal embed's half of the embedding protocol (bible 13, 15; #300 C4): page -> medal messages and
 * the guard both sides apply. The served page (`public/3d/medal.html`, generated from the bible's
 * `Fifth Copy Medal.html`) runs the same check in plain JS. Hand-written, not zod: this module is
 * imported by a client leaf, and zod classic costs ~91 kB gzip in a first load (#626).
 */
import { MEDAL_VARIANTS, type MedalVariant } from "./view/dawn-report";

/** The served embed (bible 14.1 extensions, scripts/embeds.ts). */
export const MEDAL_EMBED = "/3d/medal.html";

/** page -> medal: swap the metal (gold, silver, bronze: one model, bible 13). */
export type MedalVariantMessage = { type: "fc-medal-variant"; variant: MedalVariant };
/** page -> medal: the page's motion setting (bible 8: `data-motion` crosses the iframe here). */
export type MotionMessage = { type: "fc-motion"; reduce: boolean };

export const medalVariantMessage = (variant: MedalVariant): MedalVariantMessage => ({
  type: "fc-medal-variant",
  variant,
});
export const motionMessage = (reduce: boolean): MotionMessage => ({ type: "fc-motion", reduce });

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

/**
 * The embed's URL for a variant: `?variant=` gives the right metal on the first frame (the message only
 * arrives once the frame has loaded), `?embed=1` caps the pixel ratio at 1 (three medals on one phone).
 */
export const medalEmbedSrc = (variant: MedalVariant) =>
  `${MEDAL_EMBED}?embed=1&variant=${variant}`;
